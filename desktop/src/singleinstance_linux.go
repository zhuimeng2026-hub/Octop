//go:build linux

package main

import "github.com/wailsapp/wails/v3/pkg/application"

// singleInstanceOptions disables Wails' single-instance support on Linux.
//
// Wails' Linux implementation needs a D-Bus session bus; when it is absent the
// start-up fails hard instead of falling back, which would break the desktop
// shell on headless hosts and containers. The flock-based lock in
// instance_lock_linux.go covers Linux instead.
func singleInstanceOptions(api *App) *application.SingleInstanceOptions {
	return nil
}
