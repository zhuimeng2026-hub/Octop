//go:build linux

package main

import (
	"errors"
	"os"
	"path/filepath"
	"syscall"
)

var errInstanceRunning = errors.New("Octop desktop is already running")

type instanceLock struct{ file *os.File }

// acquireInstanceLock takes an exclusive flock on {octopHome}/desktop-instance.lock.
//
// Linux is the only platform that relies on this file lock: Wails' own
// SingleInstance support needs a D-Bus session bus, which is not guaranteed to
// exist (headless hosts, containers, plain SSH sessions), and a failed D-Bus
// connect makes Wails abort the whole start-up instead of degrading.
func acquireInstanceLock() (*instanceLock, error) {
	if err := os.MkdirAll(octopHome(), 0700); err != nil {
		return nil, err
	}
	f, err := os.OpenFile(filepath.Join(octopHome(), "desktop-instance.lock"), os.O_CREATE|os.O_RDWR, 0600)
	if err != nil {
		return nil, err
	}
	if err := syscall.Flock(int(f.Fd()), syscall.LOCK_EX|syscall.LOCK_NB); err != nil {
		_ = f.Close()
		if errors.Is(err, syscall.EWOULDBLOCK) || errors.Is(err, syscall.EAGAIN) {
			return nil, errInstanceRunning
		}
		return nil, err
	}
	return &instanceLock{file: f}, nil
}

func (l *instanceLock) Close() error {
	if l == nil || l.file == nil {
		return nil
	}
	err := syscall.Flock(int(l.file.Fd()), syscall.LOCK_UN)
	closeErr := l.file.Close()
	if err != nil {
		return err
	}
	return closeErr
}
