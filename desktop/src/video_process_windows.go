//go:build windows

package main

import "os/exec"

func configureVideoProcess(cmd *exec.Cmd) { hideConsole(cmd) }
func killVideoProcessTree(cmd *exec.Cmd)  { killProcessTree(cmd) }
