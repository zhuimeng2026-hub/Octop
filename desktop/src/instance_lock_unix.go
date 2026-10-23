//go:build !windows

package main

import (
	"errors"
	"os"
	"path/filepath"
	"syscall"
)

var errInstanceRunning = errors.New("Octop desktop is already running")

type instanceLock struct { file *os.File }

func acquireInstanceLock() (*instanceLock, error) {
	if err := os.MkdirAll(octopHome(), 0700); err != nil { return nil, err }
	f, err := os.OpenFile(filepath.Join(octopHome(), "desktop-instance.lock"), os.O_CREATE|os.O_RDWR, 0600)
	if err != nil { return nil, err }
	if err := syscall.Flock(int(f.Fd()), syscall.LOCK_EX|syscall.LOCK_NB); err != nil {
		_ = f.Close()
		if errors.Is(err, syscall.EWOULDBLOCK) || errors.Is(err, syscall.EAGAIN) { return nil, errInstanceRunning }
		return nil, err
	}
	return &instanceLock{file: f}, nil
}

func (l *instanceLock) Close() error {
	if l == nil || l.file == nil { return nil }
	err := syscall.Flock(int(l.file.Fd()), syscall.LOCK_UN)
	closeErr := l.file.Close()
	if err != nil { return err }
	return closeErr
}
