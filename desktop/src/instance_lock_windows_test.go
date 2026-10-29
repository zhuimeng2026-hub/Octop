//go:build windows

package main

import (
	"bufio"
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"sync"
	"testing"
	"time"
)

func instanceTestCommand(t *testing.T, name, mode string) *exec.Cmd {
	t.Helper()
	executable, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	t.Cleanup(cancel)
	cmd := exec.CommandContext(ctx, executable, "-test.run=^TestWindowsInstanceHelperProcess$")
	cmd.Env = append(os.Environ(), "OCTOP_TEST_INSTANCE_NAME="+name, "OCTOP_TEST_INSTANCE_MODE="+mode)
	hideConsole(cmd)
	return cmd
}

func instanceTestName(t *testing.T) string {
	return fmt.Sprintf(`Local\com.octop.desktop.test.%d.%s`, os.Getpid(), t.Name())
}

func TestWindowsInstanceLockRejectsConcurrentLaunchesAndQueuesWake(t *testing.T) {
	name := instanceTestName(t)
	first, err := acquireWindowsInstanceLock(name)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = first.Close() })

	// Simulate repeated launches while the first instance is still starting.
	var launches sync.WaitGroup
	for range 10 {
		cmd := instanceTestCommand(t, name, "duplicate")
		launches.Go(func() {
			if output, err := cmd.CombinedOutput(); err != nil {
				t.Errorf("duplicate launch: %v\n%s", err, output)
			}
		})
	}
	launches.Wait()

	wake := make(chan struct{}, 10)
	first.listen(func() { wake <- struct{}{} })
	select {
	case <-wake:
	case <-time.After(5 * time.Second):
		t.Fatal("launch received before UI readiness was lost")
	}
	select {
	case <-wake:
		t.Fatal("startup clicks were not coalesced")
	default:
	}

	// Once ready, a further launch must still wake the same instance.
	if output, err := instanceTestCommand(t, name, "duplicate").CombinedOutput(); err != nil {
		t.Fatalf("later launch: %v\n%s", err, output)
	}
	select {
	case <-wake:
	case <-time.After(5 * time.Second):
		t.Fatal("running instance did not receive launch")
	}
	if err := first.Close(); err != nil {
		t.Fatal(err)
	}
	next, err := acquireWindowsInstanceLock(name)
	if err != nil {
		t.Fatalf("relaunch after normal exit: %v", err)
	}
	_ = next.Close()
}

func TestWindowsInstanceLockReleasedAfterProcessExit(t *testing.T) {
	name := instanceTestName(t)
	cmd := instanceTestCommand(t, name, "hold")
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		t.Fatal(err)
	}
	if err := cmd.Start(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = cmd.Process.Kill(); _ = cmd.Wait() })
	line, err := bufio.NewReader(stdout).ReadString('\n')
	if err != nil || line != "ready\n" {
		t.Fatalf("holder not ready: %q, %v", line, err)
	}
	lock, err := acquireWindowsInstanceLock(name)
	if lock != nil || !errors.Is(err, errInstanceRunning) {
		if lock != nil {
			_ = lock.Close()
		}
		t.Fatalf("holder did not reject duplicate: %v", err)
	}
	if err := cmd.Process.Kill(); err != nil {
		t.Fatal(err)
	}
	_ = cmd.Wait()
	next, err := acquireWindowsInstanceLock(name)
	if err != nil {
		t.Fatalf("stale instance lock after crash: %v", err)
	}
	_ = next.Close()
}

func TestWindowsInstanceCloseWhileListenerStarts(t *testing.T) {
	for range 20 {
		lock, err := acquireWindowsInstanceLock(instanceTestName(t))
		if err != nil {
			t.Fatal(err)
		}
		started := make(chan struct{})
		go func() {
			lock.listen(func() {})
			close(started)
		}()
		if err := lock.Close(); err != nil {
			t.Fatal(err)
		}
		<-started
		if err := lock.Close(); err != nil {
			t.Fatalf("second close: %v", err)
		}
	}
}

func TestWindowsInstanceHelperProcess(t *testing.T) {
	name := os.Getenv("OCTOP_TEST_INSTANCE_NAME")
	if name == "" {
		return
	}
	lock, err := acquireWindowsInstanceLock(name)
	if os.Getenv("OCTOP_TEST_INSTANCE_MODE") == "duplicate" {
		if lock != nil || !errors.Is(err, errInstanceRunning) {
			t.Fatalf("duplicate could proceed to Wails: %v", err)
		}
		return
	}
	if err != nil {
		t.Fatal(err)
	}
	defer lock.Close()
	fmt.Println("ready")
	time.Sleep(time.Minute) // The parent kills this holder to simulate a crash.
}
