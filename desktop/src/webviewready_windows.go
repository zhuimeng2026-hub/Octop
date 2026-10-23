//go:build windows

package main

import (
	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/events"
)

// armWebviewReady registers the listener that reports the webview becoming
// usable.
//
// It has to be registered before the first navigation finishes: boot()
// resolves the dashboard URL asynchronously (it health-probes the target
// first) and a remote deployment usually answers long after the embedded
// shell page has completed its own load. Registering from inside boot()
// therefore misses that completion, and since NavigationCompleted only fires
// per navigation the window would never leave the shell page.
//
// NavigationCompleted fires for *every* load, so onReady may run more than
// once — callers have to keep it idempotent.
func armWebviewReady(win *application.WebviewWindow, onReady func()) {
	win.OnWindowEvent(events.Windows.WebViewNavigationCompleted, func(_ *application.WindowEvent) {
		onReady()
	})
}
