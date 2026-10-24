package main

import (
	"archive/zip"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"
)

func init() {
	if os.Getenv("OCTOP_TEST_VIDEO_WORKER") != "1" {
		return
	}
	var out string
	for i := 0; i+1 < len(os.Args); i++ {
		if os.Args[i] == "--out" {
			out = os.Args[i+1]
		}
	}
	if out == "" {
		os.Exit(91)
	}
	_, _ = fmt.Fprintln(os.Stdout, `{"type":"stage","stage":"rendering"}`)
	_, _ = fmt.Fprintln(os.Stdout, `{"type":"progress","progress":0.75}`)
	if os.MkdirAll(filepath.Dir(out), 0700) != nil || os.WriteFile(out, []byte("0000ftypisom-fake-mp4"), 0600) != nil {
		os.Exit(92)
	}
	_, _ = fmt.Fprintf(os.Stdout, "{\"type\":\"complete\",\"output\":%q,\"bytes\":21,\"duration\":1}\n", out)
	os.Exit(0)
}

func TestVideoPipelineAgainstHTTPAndFakeWorker(t *testing.T) {
	project := "project_123"
	script := []byte(`{"title":"Demo product","scenes":[{"type":"title"}]}`)
	sum := sha256.Sum256(script)
	manifest, _ := json.Marshal(map[string]any{"schema": "octop-remotion-package/1", "template_version": "1", "project_id": project, "project_name": "Project name", "script_sha256": hex.EncodeToString(sum[:]), "assets": []any{}})
	var packageBuf strings.Builder
	zw := zip.NewWriter(writerAdapter{&packageBuf})
	for name, data := range map[string][]byte{"assets/": {}, "manifest.json": manifest, "script.json": script, "launcher.sh": []byte("must never run"), "renderer/package.json": []byte("untrusted")} {
		w, e := zw.Create(name)
		if e != nil {
			t.Fatal(e)
		}
		if _, e = w.Write(data); e != nil {
			t.Fatal(e)
		}
	}
	if e := zw.Close(); e != nil {
		t.Fatal(e)
	}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer secret" {
			http.Error(w, "auth", 401)
			return
		}
		switch r.URL.Path {
		case "/api/auth/me":
			_, _ = io.WriteString(w, `{"id":42}`)
		case "/api/product-library/projects/" + project + "/storyboard":
			_, _ = fmt.Fprintf(w, `{"confirmed":true,"script":%s}`, script)
		case "/api/product-library/projects/" + project + "/storyboard-package":
			w.Header().Set("Content-Type", "application/zip")
			_, _ = io.WriteString(w, packageBuf.String())
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()
	root := t.TempDir()
	runtimeDir := filepath.Join(root, "video-runtime")
	if e := os.MkdirAll(runtimeDir, 0700); e != nil {
		t.Fatal(e)
	}
	if e := os.WriteFile(filepath.Join(runtimeDir, "runtime.json"), []byte(`{"schema":"octop-desktop-video-runtime/1","templateVersion":1}`), 0600); e != nil {
		t.Fatal(e)
	}
	if e := os.WriteFile(filepath.Join(runtimeDir, "desktop-worker.mjs"), []byte("// ignored by fake node"), 0600); e != nil {
		t.Fatal(e)
	}
	node := "node"
	if strings.Contains(runtime.GOOS, "windows") {
		node = "node.exe"
	}
	exe, e := os.Executable()
	if e != nil {
		t.Fatal(e)
	}
	binary, e := os.ReadFile(exe)
	if e != nil {
		t.Fatal(e)
	}
	if e = os.WriteFile(filepath.Join(runtimeDir, node), binary, 0700); e != nil {
		t.Fatal(e)
	}
	t.Setenv("OCTOP_DESKTOP_VIDEO_RUNTIME", runtimeDir)
	t.Setenv("OCTOP_TEST_VIDEO_WORKER", "1")
	m := newVideoManager(server.URL)
	m.root = filepath.Join(root, "jobs")
	job, e := m.start("secret", project)
	if e != nil {
		t.Fatal(e)
	}
	deadline := time.Now().Add(10 * time.Second)
	for time.Now().Before(deadline) {
		got, err := m.get("secret", job.ID)
		if err == nil && got.State == "completed" {
			if got.Name != "Demo product" || got.VideoURL == "" {
				t.Fatalf("unexpected result: %+v", got)
			}
			req, _ := http.NewRequest(http.MethodGet, got.VideoURL, nil)
			req.Header.Set("Range", "bytes=4-7")
			resp, err := http.DefaultClient.Do(req)
			if err != nil {
				t.Fatal(err)
			}
			data, _ := io.ReadAll(resp.Body)
			resp.Body.Close()
			if resp.StatusCode != http.StatusPartialContent || string(data) != "ftyp" {
				t.Fatalf("range response: %d %q", resp.StatusCode, data)
			}
			return
		}
		if got.State == "failed" {
			t.Fatalf("pipeline failed with %s", got.ErrorCode)
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatal("render job did not complete")
}

type writerAdapter struct{ b *strings.Builder }

func (w writerAdapter) Write(p []byte) (int, error) { return w.b.Write(p) }

func TestVideoPackageRejectsTraversalAndBadHash(t *testing.T) {
	for _, name := range []string{"../escape", "assets/../escape"} {
		t.Run(name, func(t *testing.T) {
			buf := new(strings.Builder)
			zw := zip.NewWriter(writerAdapter{buf})
			w, _ := zw.Create(name)
			_, _ = w.Write([]byte("x"))
			_ = zw.Close()
			p := filepath.Join(t.TempDir(), "x.zip")
			_ = os.WriteFile(p, []byte(buf.String()), 0600)
			if _, e := extractVideoPackage(p, filepath.Join(t.TempDir(), "data"), "p"); e == nil {
				t.Fatal("expected invalid ZIP")
			}
		})
	}
}

func TestVideoBridgeJSParses(t *testing.T) {
	node, err := exec.LookPath("node")
	if err != nil {
		t.Skip("node is unavailable")
	}
	script := videoBridgeJS("https://example.test/videogen", "0123456789abcdef")
	cmd := exec.Command(node, "-e", "new (require('node:vm').Script)(process.argv[1])", script)
	if output, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("bridge JavaScript syntax: %v: %s", err, output)
	}
}

func TestSafeVideoNameAndSameFileCopy(t *testing.T) {
	if got := safeVideoName(`bad<>:"/\\|?*name... `); got != "badname" {
		t.Fatalf("safe filename = %q", got)
	}
	path := filepath.Join(t.TempDir(), "movie.mp4")
	want := []byte("keep this video")
	if err := os.WriteFile(path, want, 0600); err != nil {
		t.Fatal(err)
	}
	if err := copyVideo(path, path); err != nil {
		t.Fatal(err)
	}
	got, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if string(got) != string(want) {
		t.Fatalf("same-file copy changed contents: %q", got)
	}
}

func TestVideoRealRuntimeSmoke(t *testing.T) {
	base, token, project := os.Getenv("OCTOP_VIDEO_SMOKE_BASE"), os.Getenv("OCTOP_VIDEO_SMOKE_TOKEN"), os.Getenv("OCTOP_VIDEO_SMOKE_PROJECT")
	if base == "" || token == "" || project == "" {
		t.Skip("set OCTOP_VIDEO_SMOKE_BASE, OCTOP_VIDEO_SMOKE_TOKEN, and OCTOP_VIDEO_SMOKE_PROJECT")
	}
	m := newVideoManager(base)
	job, err := m.start(token, project)
	if err != nil {
		t.Fatalf("start video job: %v", err)
	}
	defer m.interrupt()
	deadline := time.Now().Add(120 * time.Second)
	for time.Now().Before(deadline) {
		current, err := m.get(token, job.ID)
		if err != nil {
			t.Fatalf("get video job: %v", err)
		}
		switch current.State {
		case "completed":
			req, err := http.NewRequest(http.MethodGet, current.VideoURL, nil)
			if err != nil {
				t.Fatal(err)
			}
			req.Header.Set("Range", "bytes=0-11")
			resp, err := http.DefaultClient.Do(req)
			if err != nil {
				t.Fatal(err)
			}
			_ = resp.Body.Close()
			if resp.StatusCode != http.StatusPartialContent {
				t.Fatalf("video stream returned %s", resp.Status)
			}
			m.mu.Lock()
			output := m.jobs[job.ID].Output
			m.mu.Unlock()
			t.Logf("native runtime rendered %s", output)
			return
		case "failed":
			t.Fatalf("native runtime failed with %s", current.ErrorCode)
		case "cancelled", "interrupted":
			t.Fatalf("native runtime ended in %s", current.State)
		}
		time.Sleep(500 * time.Millisecond)
	}
	t.Fatal("native runtime smoke timed out after 120 seconds")
}
