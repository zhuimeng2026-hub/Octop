//go:build !windows

package main

import "github.com/wailsapp/wails/v3/pkg/application"

type devSsoBridge struct{}

func attachDevSsoListener(*application.App, *App) {}

func (*App) installDevSsoBridge() {}
