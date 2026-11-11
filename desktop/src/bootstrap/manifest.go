package bootstrap

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
)

// manifestLimit caps the manifest body. A manifest is a few kilobytes; the
// cap only guards against a wrong URL returning something huge.
const manifestLimit = 4 << 20

// LoadManifest fetches the manifest from the first URL that answers. The
// checksum, when given, is verified against the raw body.
func LoadManifest(urls []string, client *http.Client, checksum string, log func(format string, args ...any)) (Manifest, error) {
	if client == nil {
		client = DefaultClient()
	}
	if log == nil {
		log = func(string, ...any) {}
	}
	var lastErr error
	for _, url := range urls {
		manifest, err := fetchManifest(url, client, checksum)
		if err == nil {
			return manifest, nil
		}
		log("bootstrap: manifest fetch failed for %s: %v", url, err)
		lastErr = err
	}
	if lastErr == nil {
		lastErr = fmt.Errorf("bootstrap: no manifest url was given")
	}
	return Manifest{}, lastErr
}

// fetchManifest downloads and parses one manifest.
func fetchManifest(url string, client *http.Client, checksum string) (Manifest, error) {
	resp, err := client.Get(url)
	if err != nil {
		return Manifest{}, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return Manifest{}, fmt.Errorf("bootstrap: manifest request failed: HTTP %d", resp.StatusCode)
	}
	data, err := io.ReadAll(io.LimitReader(resp.Body, manifestLimit))
	if err != nil {
		return Manifest{}, err
	}
	if checksum != "" {
		digest := sha256.Sum256(data)
		sum := hex.EncodeToString(digest[:])
		if !strings.EqualFold(sum, checksum) {
			return Manifest{}, fmt.Errorf("%w: the manifest does not match the expected checksum", ErrChecksumMismatch)
		}
	}
	var manifest Manifest
	if err := json.Unmarshal(data, &manifest); err != nil {
		return Manifest{}, fmt.Errorf("bootstrap: unreadable manifest: %w", err)
	}
	if len(manifest.Parts) == 0 {
		return Manifest{}, fmt.Errorf("bootstrap: the manifest lists no parts")
	}
	return manifest, nil
}
