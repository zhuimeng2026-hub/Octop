package main

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// slimInstall builds the state a slim installer starts in: no embedded
// payload, no package beside the executable, and a runtime URL to fetch.
func slimInstall(t *testing.T, version string) *httptest.Server {
	t.Helper()
	home := t.TempDir()
	t.Setenv("OCTOP_HOME", home)
	t.Setenv("OCTOP_DESKTOP_PORTABLE_ZIP", "")

	zipPath := filepath.Join(t.TempDir(), "remote.zip")
	writeTestGreenZip(t, zipPath, version)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.ServeFile(w, r, zipPath)
	}))
	t.Cleanup(server.Close)

	prevURL, prevVersion := portableRuntimeURL, portableRuntimeVersion
	portableRuntimeURL = server.URL + "/Octop-portable.zip"
	portableRuntimeVersion = version
	t.Cleanup(func() { portableRuntimeURL, portableRuntimeVersion = prevURL, prevVersion })

	prevEmbedded := embeddedPortable
	embeddedPortable = nil
	t.Cleanup(func() { embeddedPortable = prevEmbedded })

	return server
}

func TestEnsurePortableDownloadsRuntimeWhenNoneIsBundled(t *testing.T) {
	slimInstall(t, "1.2.0")

	var statuses []string
	if err := ensurePortable(LocaleZH, func(status string) {
		statuses = append(statuses, status)
	}); err != nil {
		t.Fatal(err)
	}
	if !launchReady(portableDir()) {
		t.Fatal("downloaded runtime was not extracted into the portable directory")
	}
	if got := portableVersion(portableDir()); got != "1.2.0" {
		t.Fatalf("portable version = %q, want 1.2.0", got)
	}
	if !containsStatus(statuses, "正在下载运行环境") {
		t.Fatalf("no download progress was reported: %v", statuses)
	}
	// The downloaded archive is a cache, not a permanent copy.
	if _, err := os.Stat(filepath.Join(octopHome(), "portable-runtime.zip")); err == nil {
		t.Fatal("downloaded archive was not cleaned up")
	}
}

func TestEnsurePortableKeepsRuntimeWhenItMatchesTheDownload(t *testing.T) {
	slimInstall(t, "1.2.0")
	if err := ensurePortable(LocaleZH, func(string) {}); err != nil {
		t.Fatal(err)
	}
	before := portableVersion(portableDir())

	var statuses []string
	if err := ensurePortable(LocaleZH, func(status string) {
		statuses = append(statuses, status)
	}); err != nil {
		t.Fatal(err)
	}
	if got := portableVersion(portableDir()); got != before {
		t.Fatalf("portable version changed from %q to %q", before, got)
	}
	if containsStatus(statuses, "正在下载运行环境") {
		t.Fatalf("runtime was downloaded again although it matches: %v", statuses)
	}
}

func TestEnsurePortableRefreshesRuntimeWhenTheDownloadIsNewer(t *testing.T) {
	slimInstall(t, "1.2.0")
	if err := ensurePortable(LocaleZH, func(string) {}); err != nil {
		t.Fatal(err)
	}

	// A newer installer ships a newer runtime URL.
	prevVersion := portableRuntimeVersion
	portableRuntimeVersion = "1.3.0"
	t.Cleanup(func() { portableRuntimeVersion = prevVersion })

	var statuses []string
	if err := ensurePortable(LocaleZH, func(status string) {
		statuses = append(statuses, status)
	}); err != nil {
		t.Fatal(err)
	}
	if !containsStatus(statuses, "正在下载运行环境") {
		t.Fatalf("newer runtime was not downloaded: %v", statuses)
	}
}

func TestEnsurePortableFailsWhenTheRuntimeDownloadFails(t *testing.T) {
	slimInstall(t, "1.2.0")
	portableRuntimeURL = "http://127.0.0.1:1/Octop-portable.zip"

	err := ensurePortable(LocaleZH, func(string) {})
	if err == nil {
		t.Fatal("expected an error when the runtime download fails")
	}
	if !strings.Contains(err.Error(), "运行环境下载失败") {
		t.Fatalf("error is not localized: %v", err)
	}
}

func TestEnsurePortableFallsBackToTheNextMirror(t *testing.T) {
	slimInstall(t, "1.2.0")

	// The first mirror is unreachable; the second one serves the runtime.
	zipPath := filepath.Join(t.TempDir(), "mirror.zip")
	writeTestGreenZip(t, zipPath, "1.2.0")
	mirror := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.ServeFile(w, r, zipPath)
	}))
	defer mirror.Close()

	portableRuntimeURL = "http://127.0.0.1:1/missing.zip," + mirror.URL + "/Octop-portable.zip"

	if err := ensurePortable(LocaleZH, func(string) {}); err != nil {
		t.Fatal(err)
	}
	if !launchReady(portableDir()) {
		t.Fatal("the fallback mirror was not used")
	}
}

func containsStatus(statuses []string, want string) bool {
	for _, status := range statuses {
		if strings.Contains(status, want) {
			return true
		}
	}
	return false
}
