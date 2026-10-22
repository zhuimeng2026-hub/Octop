//go:build !windows

package main

import "github.com/wailsapp/wails/v3/pkg/application"

// armWebviewReady runs onReady immediately.
//
// Wails only emits WebViewNavigationCompleted on Windows, so there is no
// equivalent readiness signal to wait for on macOS / Linux — and the nil
// controller that motivated webviewready_windows.go is specific to the
// WebView2 binding. Keep the previous behaviour rather than inventing a
// timing guess.
func armWebviewReady(_ *application.WebviewWindow, onReady func()) {
	onReady()
}
