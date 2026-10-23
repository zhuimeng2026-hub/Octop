//go:build windows

package main

import (
	"errors"
	"os"
	"path/filepath"

	"golang.org/x/sys/windows"
)

var errInstanceRunning = errors.New("Octop desktop is already running")

type instanceLock struct {
	file *os.File
	overlapped windows.Overlapped
}

func acquireInstanceLock() (*instanceLock, error) {
	if err := os.MkdirAll(octopHome(), 0700); err != nil { return nil, err }
	f, err := os.OpenFile(filepath.Join(octopHome(), "desktop-instance.lock"), os.O_CREATE|os.O_RDWR, 0600)
	if err != nil { return nil, err }
	l := &instanceLock{file: f}
	err = windows.LockFileEx(windows.Handle(f.Fd()), windows.LOCKFILE_EXCLUSIVE_LOCK|windows.LOCKFILE_FAIL_IMMEDIATELY, 0, 1, 0, &l.overlapped)
	if err != nil {
		_ = f.Close()
		if errors.Is(err, windows.ERROR_LOCK_VIOLATION) { return nil, errInstanceRunning }
		return nil, err
	}
	return l, nil
}

func (l *instanceLock) Close() error {
	if l == nil || l.file == nil { return nil }
	err := windows.UnlockFileEx(windows.Handle(l.file.Fd()), 0, 1, 0, &l.overlapped)
	closeErr := l.file.Close()
	if err != nil { return err }
	return closeErr
}
