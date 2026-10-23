//go:build linux

package main

import (
	"errors"
	"testing"
)

// TestDesktopSingleInstanceLock exercises the flock-based lock. Windows and
// macOS enforce single-instance through Wails and their lock is a no-op, so
// this test only applies to Linux.
func TestDesktopSingleInstanceLock(t *testing.T) {
	t.Setenv("OCTOP_HOME", t.TempDir())
	first, err := acquireInstanceLock()
	if err != nil {
		t.Fatalf("first lock: %v", err)
	}
	defer first.Close()

	second, err := acquireInstanceLock()
	if second != nil {
		defer second.Close()
		t.Fatal("second instance acquired lock")
	}
	if !errors.Is(err, errInstanceRunning) {
		t.Fatalf("second lock: got %v, want errInstanceRunning", err)
	}

	if err := first.Close(); err != nil {
		t.Fatalf("release: %v", err)
	}
	third, err := acquireInstanceLock()
	if err != nil {
		t.Fatalf("reacquire after exit: %v", err)
	}
	defer third.Close()
}
