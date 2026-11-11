package bootstrap

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
)

// PartState records what a finished download looks like.
type PartState struct {
	// Expected is the checksum the download has to match. An empty value
	// means the archive is trusted as it was fetched.
	Expected string `json:"expected,omitempty"`
	// SHA256 is the checksum of the finished archive.
	SHA256 string `json:"sha256,omitempty"`
	Size   int64  `json:"size,omitempty"`
	At     string `json:"at,omitempty"`
}

// State is the bootstrap bookkeeping file. It survives a crash and tells the
// next launch which archives are already on disk.
type State struct {
	Version string               `json:"version,omitempty"`
	Parts   map[string]PartState `json:"parts,omitempty"`
}

// loadState reads the state file. A missing or damaged file only costs a
// re-download, so it never fails the run.
func loadState(path string) (*State, error) {
	empty := &State{Parts: map[string]PartState{}}
	data, err := os.ReadFile(path)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return empty, nil
		}
		return nil, err
	}
	state := &State{}
	if err := json.Unmarshal(data, state); err != nil {
		return empty, nil
	}
	if state.Parts == nil {
		state.Parts = map[string]PartState{}
	}
	return state, nil
}

// save writes the state file atomically.
func (s *State) save(path string) error {
	data, err := json.MarshalIndent(s, "", "  ")
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, data, 0o644); err != nil {
		return err
	}
	return os.Rename(tmp, path)
}
