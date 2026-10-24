# Desktop automatic video — Design QA

final result: passed

This is a browser-rendered UI result, not an installed Windows-client acceptance. The previous web-wizard report is archived at `docs/design/product-video-wizard/design-qa.md`.

## Target and evidence

- Source: `docs/design/desktop-auto-video/selected-concept.png` (安心制作页), 1487 × 1058 pixels.
- Final implementation: `docs/design/desktop-auto-video/implementation-desktop.jpg`, 1487 × 1058 pixels; CSS viewport 1487 × 1058, DPR 1. Source and implementation were opened together in one comparison input at native size without scaling.
- State: fifth step, confirmed fixture plan, rendering UI at 64%. This percentage is controlled visual-fixture data, not a measured production render.
- Other captures: `implementation-completed.jpg`, `implementation-background.jpg`, `implementation-narrow.jpg` (900 × 800) and `review-initial.jpg`. Final desktop capture is from the production bundle; related interactions were also checked with the same source in development preview.
- Synthetic local account, sample photograph and test-only native bridge stay outside production code and real product libraries.
- Completed player reads the real native-smoke MP4: 360 × 640, duration 3 seconds, readyState 4, no media error; playback reached the end.

## Comparison history

Initial review — blocked:

- [P1, fixed] String native owner ID did not match numeric account ID, hiding jobs. Normalize before filtering and cover the string native ID in the provider test.
- [P2, fixed] Dashboard uses a custom Ant Design prefix, so the card body was not flexed and actions fell below the image. Use explicit Card body/tag/progress classes.
- [P2, fixed] Poster could overlap the footer. Bound height to available space and compact the timeline on shorter windows.
- [P2, fixed] Add the selected concept's three-stage timeline and background primary action; preserve honest stage progress.
- [P2, fixed] Product Library still exposed ZIP/Node instructions. Desktop mode now shows automatic workflow and continue controls; web export is retained.

Final comparison — passed: opened the selected concept and final capture together after fixes. Portrait cover, right-hand heading, rose navigation/actions, three-stage status and disabled edit navigation are visible. No actionable P0/P1/P2 visual finding remains.

Intentional adaptations: existing Dashboard font, standard icons and compact summary/status typography; actual library asset instead of a generated marketing poster; corrected stale ZIP subtitle. Preparation remains indeterminate until measurable progress exists.

## Required fidelity surfaces

| Surface | Result |
| --- | --- |
| Fonts / typography | Existing system font and Dashboard hierarchy; large creation heading and readable stage/status labels. |
| Spacing / layout | Two desktop columns, bounded image, sticky navigation/footer. Narrow content stacks and scrolls to save; no document-level horizontal overflow at 900 × 800. |
| Colors / tokens | Rose primary and progress, semantic completed state, neutral pending state. Dark theme not separately captured. |
| Images / quality | Authenticated asset marked 封面示意; completion replaces it with actual MP4. No custom image approximations or production demo assets. |
| Copy / content | Desktop hides ZIP/JSON/Node/API/renderer details, explains keeping the client running, and localizes zh/en. |

Full-view captures show labels and controls clearly at native density. DOM/accessibility checks verify disabled controls, stage status and video metadata; no magnified crop was needed to resolve findings.

## Interaction checks and limits

- Fixture browser: cancel → retry; background navigation; task status and completion reminder → video page; actual MP4 playback; narrow scrolling to save.
- Focused tests: explicit confirmation starts once, restored confirmation does not start, auth passed to native controls, account changes hide jobs.
- Fresh production preview checked separately for console errors. Development-proxy HMR websocket errors are fixture infrastructure issues.
- Separate native HTTP → validated ZIP → trusted runtime → MP4 → Range smoke passed. Fixture UI alone does not prove native integration.
- Automatic approval rejected native GUI launch without a specific reason. Save dialog, installed client and NSIS remain unverified; see `docs/design/desktop-auto-video/acceptance.md`.

P3 follow-up: refine summary strip and larger stage typography while retaining Dashboard density.

Checklist: selected visual reviewed; initial findings fixed; desktop/background/completed/narrow captured; real media independently verified; native GUI and installation gaps recorded.
