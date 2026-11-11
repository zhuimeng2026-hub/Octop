package bootstrap

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"
)

// ErrChecksumMismatch reports that a downloaded archive does not match the
// checksum the manifest promised.
var ErrChecksumMismatch = errors.New("checksum mismatch")

// errNotFound reports that a mirror does not have the file at all. It ends
// the attempts on that mirror right away — a different mirror may have it.
var errNotFound = errors.New("not found")

// DefaultClient is the HTTP client the bootstrap uses: no total timeout (a
// runtime download may take a while on a slow link) but no hang on a dead
// connection either.
func DefaultClient() *http.Client {
	return &http.Client{
		Transport: &http.Transport{
			DialContext:           (&net.Dialer{Timeout: 30 * time.Second}).DialContext,
			TLSHandshakeTimeout:   30 * time.Second,
			ResponseHeaderTimeout: 60 * time.Second,
		},
	}
}

// fetcher downloads the parts of a manifest.
type fetcher struct {
	opts Options
	log  func(format string, args ...any)
}

// fetch downloads one part to dest. It tries every mirror in order and
// verifies the result against expected (when expected is set).
func (f *fetcher) fetch(part Part, dest, expected string) error {
	var lastErr error
	for _, url := range part.URLs {
		for attempt := 0; attempt < f.opts.Attempts; attempt++ {
			err := f.download(url, part, dest)
			if err == nil {
				if expected == "" {
					return nil
				}
				sum, sumErr := fileSHA256(dest)
				if sumErr != nil {
					return sumErr
				}
				if strings.EqualFold(sum, expected) {
					return nil
				}
				// The mirror serves the wrong bytes — the file is useless,
				// no matter how often it is asked again.
				_ = os.Remove(dest)
				lastErr = fmt.Errorf("%w: %s does not match the expected checksum", ErrChecksumMismatch, url)
				f.log("bootstrap: %v", lastErr)
				break
			}
			lastErr = err
			if errors.Is(err, errNotFound) {
				f.log("bootstrap: %s has no copy of %s", url, part.ID)
				break
			}
			f.log("bootstrap: %s failed: %v", url, err)
			if attempt+1 < f.opts.Attempts {
				time.Sleep(f.backoff(attempt))
			}
		}
	}
	if lastErr == nil {
		lastErr = errors.New("bootstrap: no mirror served the file")
	}
	return lastErr
}

// backoff is the pause before the next attempt on the same mirror.
func (f *fetcher) backoff(attempt int) time.Duration {
	if attempt < len(f.opts.Backoff) {
		return f.opts.Backoff[attempt]
	}
	return f.opts.Backoff[len(f.opts.Backoff)-1]
}

// download fetches url into dest, resuming a partial file when the server
// supports range requests.
func (f *fetcher) download(url string, part Part, dest string) error {
	offset := int64(0)
	if info, err := os.Stat(dest); err == nil {
		offset = info.Size()
	}
	req, err := http.NewRequest(http.MethodGet, url, nil)
	if err != nil {
		return err
	}
	if offset > 0 {
		req.Header.Set("Range", fmt.Sprintf("bytes=%d-", offset))
	}
	resp, err := f.opts.Client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	switch resp.StatusCode {
	case http.StatusOK:
		// The server ignored the range request — start over.
		offset = 0
	case http.StatusPartialContent:
		start, err := rangeStart(resp.Header.Get("Content-Range"))
		if err != nil {
			return err
		}
		if start != offset {
			return fmt.Errorf("runtime download: server resumed at %d, expected %d", start, offset)
		}
	case http.StatusRequestedRangeNotSatisfiable:
		// The file is already complete.
		return nil
	case http.StatusNotFound, http.StatusGone:
		return errNotFound
	default:
		return fmt.Errorf("runtime download failed: HTTP %d", resp.StatusCode)
	}

	flags := os.O_CREATE | os.O_WRONLY
	if offset > 0 {
		flags |= os.O_APPEND
	} else {
		flags |= os.O_TRUNC
	}
	out, err := os.OpenFile(dest, flags, 0o644)
	if err != nil {
		return err
	}

	total := part.Size
	if total <= 0 {
		total = responseTotal(resp, offset)
	}
	writer := &progressWriter{
		out:     out,
		f:       f,
		part:    part,
		total:   total,
		written: offset,
	}
	buf := make([]byte, 1<<20)
	for {
		n, readErr := resp.Body.Read(buf)
		if n > 0 {
			if _, writeErr := writer.Write(buf[:n]); writeErr != nil {
				out.Close()
				return writeErr
			}
		}
		if readErr == io.EOF {
			break
		}
		if readErr != nil {
			out.Close()
			return readErr
		}
	}
	if err := out.Close(); err != nil {
		return err
	}
	if part.Size > 0 {
		info, statErr := os.Stat(dest)
		if statErr != nil {
			return statErr
		}
		if info.Size() != part.Size {
			// The mirror served the wrong file — drop it, the next attempt
			// must not continue a file that can never be right.
			_ = os.Remove(dest)
			return fmt.Errorf("runtime download: expected %d bytes, got %d", part.Size, info.Size())
		}
	}
	return nil
}

// progressWriter forwards the download to the file while reporting progress
// and enforcing the size cap.
type progressWriter struct {
	out      io.Writer
	f        *fetcher
	part     Part
	total    int64
	written  int64
	last     int
	lastStep int64
}

// Write stores the bytes and reports the progress.
func (p *progressWriter) Write(b []byte) (int, error) {
	if p.f.opts.MaxBytes > 0 && p.written+int64(len(b)) > p.f.opts.MaxBytes {
		return 0, fmt.Errorf("runtime download exceeded %d bytes", p.f.opts.MaxBytes)
	}
	n, err := p.out.Write(b)
	p.written += int64(n)
	if p.f.opts.Progress != nil {
		progress := Progress{PartID: p.part.ID, Received: p.written, Total: p.total}
		if p.total > 0 {
			if percent := progress.Percent(); percent != p.last {
				p.last = percent
				p.f.opts.Progress(progress)
			}
		} else if p.written-p.lastStep >= 4<<20 {
			// The server did not say how big the file is — report every few
			// megabytes instead of every percent.
			p.lastStep = p.written
			p.f.opts.Progress(progress)
		}
	}
	return n, err
}

// rangeStart reads the first offset out of a Content-Range header.
func rangeStart(header string) (int64, error) {
	if header == "" {
		return 0, errors.New("runtime download: the server sent no content range")
	}
	value := strings.TrimPrefix(header, "bytes ")
	if idx := strings.Index(value, "-"); idx >= 0 {
		value = value[:idx]
	}
	start, err := strconv.ParseInt(strings.TrimSpace(value), 10, 64)
	if err != nil {
		return 0, fmt.Errorf("runtime download: unreadable content range %q", header)
	}
	return start, nil
}

// responseTotal is the size of the whole file, as far as the server says.
func responseTotal(resp *http.Response, offset int64) int64 {
	if header := resp.Header.Get("Content-Range"); header != "" {
		if idx := strings.LastIndex(header, "/"); idx >= 0 {
			if total, err := strconv.ParseInt(strings.TrimSpace(header[idx+1:]), 10, 64); err == nil {
				return total
			}
		}
	}
	if resp.ContentLength > 0 {
		return offset + resp.ContentLength
	}
	return 0
}

// fileSHA256 is the checksum of a file on disk.
func fileSHA256(path string) (string, error) {
	file, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer file.Close()
	digest := sha256.New()
	if _, err := io.Copy(digest, file); err != nil {
		return "", err
	}
	return hex.EncodeToString(digest.Sum(nil)), nil
}

// fileExists reports whether path is a regular file.
func fileExists(path string) bool {
	info, err := os.Stat(path)
	return err == nil && info.Mode().IsRegular()
}
