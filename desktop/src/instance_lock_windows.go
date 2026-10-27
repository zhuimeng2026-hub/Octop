//go:build windows

package main

import (
	"errors"
	"log"
	"sync"

	"golang.org/x/sys/windows"
)

var errInstanceRunning = errors.New("Octop desktop is already running")

type instanceLock struct {
	mu     sync.Mutex
	launch windows.Handle
	stop   windows.Handle
	done   chan struct{}
}

func acquireInstanceLock() (*instanceLock, error) {
	return acquireWindowsInstanceLock(`Local\com.octop.desktop.instance`)
}

// The named event is both the instance lock and the request to show its window.
// CreateEvent is atomic, so only its creator may initialise Wails or the tray.
// An auto-reset event retains a launch received before the UI is ready and
// coalesces repeated clicks. Windows releases the handles when a process exits.
func acquireWindowsInstanceLock(name string) (*instanceLock, error) {
	eventName, err := windows.UTF16PtrFromString(name)
	if err != nil {
		return nil, err
	}
	launch, err := windows.CreateEvent(nil, 0, 0, eventName)
	if errors.Is(err, windows.ERROR_ALREADY_EXISTS) {
		defer windows.CloseHandle(launch)
		if err := windows.SetEvent(launch); err != nil {
			return nil, err
		}
		return nil, errInstanceRunning
	}
	if err != nil {
		return nil, err
	}
	stop, err := windows.CreateEvent(nil, 1, 0, nil)
	if err != nil {
		_ = windows.CloseHandle(launch)
		return nil, err
	}
	return &instanceLock{launch: launch, stop: stop}, nil
}

// listen starts only after ApplicationStarted, when the main window can be
// restored. The callback must enqueue UI work without blocking this listener.
func (l *instanceLock) listen(onLaunch func()) {
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.launch == 0 || l.done != nil {
		return
	}
	l.done = make(chan struct{})
	done := l.done
	handles := []windows.Handle{l.stop, l.launch}
	go func() {
		defer close(done)
		for {
			event, err := windows.WaitForMultipleObjects(handles, false, windows.INFINITE)
			if err != nil {
				log.Printf("desktop instance notification: %v", err)
				return
			}
			if event == windows.WAIT_OBJECT_0 {
				return
			}
			onLaunch()
		}
	}()
}

func (l *instanceLock) Close() error {
	if l == nil {
		return nil
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.launch == 0 {
		return nil
	}
	if l.done != nil {
		if err := windows.SetEvent(l.stop); err != nil {
			return err
		}
		<-l.done
	}
	err := errors.Join(windows.CloseHandle(l.stop), windows.CloseHandle(l.launch))
	l.stop, l.launch = 0, 0
	return err
}
