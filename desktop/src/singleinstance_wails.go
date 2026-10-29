//go:build windows || darwin

package main

import "github.com/wailsapp/wails/v3/pkg/application"

// macOS uses Wails' lock and distributed notification to focus the first window.
// Windows rejects new duplicate launches through its early named event, while
// retaining Wails' mutex and notification for compatibility with older binaries.
func singleInstanceOptions(api *App) *application.SingleInstanceOptions {
	return &application.SingleInstanceOptions{
		UniqueID: "com.octop.desktop",
		ExitCode: 0,
		OnSecondInstanceLaunch: func(data application.SecondInstanceData) {
			api.showWindow()
		},
	}
}
