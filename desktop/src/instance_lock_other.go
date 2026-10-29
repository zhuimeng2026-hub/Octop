//go:build !linux && !windows

package main

import "errors"

// macOS enforces single-instance through Wails and never reports this error here.
var errInstanceRunning = errors.New("Octop desktop is already running")

type instanceLock struct{}

// acquireInstanceLock is a no-op on macOS: Wails already refuses a second
// instance and hands the launch arguments to the running one.
func acquireInstanceLock() (*instanceLock, error) {
	return &instanceLock{}, nil
}

func (l *instanceLock) listen(onLaunch func()) {}

func (l *instanceLock) Close() error {
	return nil
}
