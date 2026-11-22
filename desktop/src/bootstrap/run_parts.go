package bootstrap

import (
	"fmt"
	"sort"
)

// RunParts installs exactly the parts named in partIDs and ignores the rest of
// the manifest. It is the on-demand counterpart of Run: Run installs every
// required part and skips the optional ones, RunParts installs what a feature
// asked for, whether the manifest marks it required or not.
//
// The run shares the cache directory and state.json with Run, so an archive a
// previous run downloaded is reused instead of fetched again. Parts are
// installed in manifest order, which keeps the merge-mode contract intact when
// partIDs includes the root part (the root part has to come first because its
// Extract empties the runtime root).
//
// RunParts changes no existing behaviour: Run keeps its "required parts only"
// semantics, and this function is only reached by a caller that names parts.
func RunParts(opts Options, partIDs []string) error {
	wanted := make(map[string]bool, len(partIDs))
	for _, id := range partIDs {
		if id != "" {
			wanted[id] = true
		}
	}
	if len(wanted) == 0 {
		return fmt.Errorf("bootstrap: no part ids were given")
	}

	selected := make([]Part, 0, len(wanted))
	for _, part := range opts.Manifest.Parts {
		if !wanted[part.ID] {
			continue
		}
		delete(wanted, part.ID)
		// Run skips every part that is not required. The caller named this one,
		// so install it regardless of how the manifest classifies it.
		part.Required = true
		selected = append(selected, part)
	}
	if len(wanted) > 0 {
		missing := make([]string, 0, len(wanted))
		for id := range wanted {
			missing = append(missing, id)
		}
		sort.Strings(missing)
		return fmt.Errorf("bootstrap: the manifest does not list parts %v", missing)
	}
	if err := validateSharedTargets(selected, opts.Manifest.Parts); err != nil {
		return err
	}

	opts.Manifest = Manifest{
		Version:  opts.Manifest.Version,
		Platform: opts.Manifest.Platform,
		Parts:    selected,
	}
	return Run(opts)
}

// validateSharedTargets refuses a selection that would let one part delete
// the files of another.
//
// A part without Append owns its Target: Extract empties the directory
// before unpacking, so it wipes whatever an earlier part wrote there. A part
// with Append only adds files. Two parts may therefore share a Target as
// long as the first one owns the directory and the rest append to it — that
// is how the portable runtime layers deps-core, app and the optional
// shards into one packages/ tree.
//
// The selection is checked on its own and against the whole manifest: a
// selection must not contain two owners of the same Target, an owner must
// not come after an appending part, and an owner must not be selected while
// a required part sharing its Target is left out.
func validateSharedTargets(selected, all []Part) error {
	owner := map[string]string{}
	appending := map[string]bool{}
	for _, part := range selected {
		if part.Target == "" {
			// The root part is covered by validateParts (at most one root, and
			// in merge mode it must come first).
			continue
		}
		if part.Append {
			appending[part.Target] = true
			continue
		}
		if other, ok := owner[part.Target]; ok {
			return fmt.Errorf("bootstrap: parts %q and %q own the same target %q", other, part.ID, part.Target)
		}
		if appending[part.Target] {
			return fmt.Errorf("bootstrap: part %q owns the target %q but an appending part comes before it", part.ID, part.Target)
		}
		owner[part.Target] = part.ID
	}
	// A part that is not selected but shares a Target with a selected owner
	// would lose its files when that owner unpacks. Only a required part
	// counts: it is always installed, so its files are on disk. Optional
	// parts may or may not be there and are not worth rejecting over.
	for _, part := range selected {
		if part.Target == "" || part.Append {
			continue
		}
		for _, other := range all {
			if other.ID == part.ID || other.Target != part.Target || !other.Required {
				continue
			}
			if !containsID(selected, other.ID) {
				return fmt.Errorf(
					"bootstrap: part %q owns the target %q and would delete the files of %q",
					part.ID, part.Target, other.ID,
				)
			}
		}
	}
	return nil
}

// containsID reports whether the selection names the given part.
func containsID(parts []Part, id string) bool {
	for _, part := range parts {
		if part.ID == id {
			return true
		}
	}
	return false
}
