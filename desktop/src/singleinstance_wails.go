//go:build windows || darwin

package main

import "github.com/wailsapp/wails/v3/pkg/application"

// singleInstanceOptions enables Wails' single-instance support.
//
// Windows uses a named mutex plus a hidden message window, macOS a lock file
// plus a distributed notification; both hand the launch arguments of the
// second process to the running one, which then focuses its window instead of
// opening a second shell.
//
// Linux is excluded on purpose: Wails implements it on top of the D-Bus
// session bus, and when that bus is missing the start-up is aborted instead
// of degrading gracefully — Linux therefore uses the flock-based lock in
// instance_lock_linux.go.
func singleInstanceOptions(api *App) *application.SingleInstanceOptions {
	return &application.SingleInstanceOptions{
		UniqueID: "com.octop.desktop",
		ExitCode: 0,
		OnSecondInstanceLaunch: func(data application.SecondInstanceData) {
			api.showWindow()
		},
	}
}
