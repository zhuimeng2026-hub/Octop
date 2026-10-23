//go:build !linux

package main

import "errors"

// errInstanceRunning is kept for parity with the Linux build; the non-Linux
// platforms enforce single-instance through Wails' SingleInstance support
// (see singleinstance_windows.go / singleinstance_darwin.go) and never report
// this error here.
var errInstanceRunning = errors.New("Octop desktop is already running")

type instanceLock struct{}

// acquireInstanceLock is a no-op outside Linux: Wails already refuses a second
// instance and hands the launch arguments to the running one.
func acquireInstanceLock() (*instanceLock, error) {
	return &instanceLock{}, nil
}

func (l *instanceLock) Close() error {
	return nil
}
