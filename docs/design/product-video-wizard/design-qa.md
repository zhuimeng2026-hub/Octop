# Product Video Wizard — Design QA

final result: passed

## Visual target and evidence

- Source: `docs/design/product-video-wizard/concept-a.png`, PNG, 1487 × 1058 pixels.
- Final implementation: `docs/design/product-video-wizard/implementation-desktop.jpg`, JPEG, 1487 × 1058 pixels, captured from the production bundle using local Vite preview and an isolated mock API.
- Final CSS viewport: 1487 × 1058; devicePixelRatio: 1. Source and implementation were opened together at native size in the same comparison input. No scaling or resizing was needed.
- State: fourth step, saved but unconfirmed storyboard, seven fixture scenes, editable cards and confirmation action.
- Other captures: `implementation-download.jpg` (production download state); `implementation-narrow.jpg` and `implementation-narrow-scrolled.jpg` (final source, 900 × 800 CSS/pixels, DPR 1); `review-initial.jpg` (first iteration).
- Captures use a fictitious user and a generated sample bracelet photograph served only by the local mock API. Demo photographs are not bundled into the production application.

## Comparison history

### Iteration 1 — blocked

Opened the source and `review-initial.jpg` together. That first capture was 1488 × 1056; the source was 1487 × 1058. The small frame difference was not treated as a typography defect; the final comparison uses exactly matching dimensions.

- [P2] Step connectors crossed labels. Fixed label stacking/background and connector spacing.
- [P2] Blank fields and approximately 380-pixel cards hid too much of the second row. Tightened padding and removed renderer-unused inputs, including the duplicate end-card subtitle.
- [P2] Summary exposed 1080:1920 and ZH. Replaced with 9:16 and localized 中文.
- [P2] Saved and confirmed states were insufficiently distinct. Added pending-confirmation status and invalidated export after edits.
- [P3] Replaced text status glyphs with the existing icon library.

### Interaction and responsive review — blocked, then fixed

- [P2] Scrolling hid step navigation. Made it sticky; the final narrow scrolled capture shows navigation and footer while editing the last scene.
- [P2] At 900 pixels with the sidebar expanded, horizontal step labels collided with adjacent circles. Steps now align vertically below 1100 pixels. Final narrow captures show separated labels.
- [P2] Refresh flattened requirements into additional notes and could retain conflicting platforms. A versioned internal brief encoder/decoder now restores each business field. Browser verification restored audience/platform and replaced 抖音 with 小红书 without retaining the old platform in the saved brief. Legacy unstructured notes remain available.
- Disabled controls during pending saves/uploads to prevent keyboard edits being overwritten by an earlier save response; covered by component tests.

### Final comparison — passed

Opened the source, final production desktop capture and final scrolled narrow capture together after fixes. No actionable P0/P1/P2 findings remain.

Intentional adaptations: reuse the current repository Dashboard shell rather than reconstructing the older shell in the concept. Scene count/content are data-driven: this fixture has title/text/end-card scenes and four photographs; the concept illustrates six photographic cards. Text scenes show real text, not invented photographs. Extra rows scroll internally while actions and navigation stay available. Saving is explicit; the interface does not claim automatic persistence before the server responds.

## Required fidelity surfaces

| Surface              | Result                                                                                                                                                                                                                           |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Fonts and typography | Dashboard system font and heading hierarchy retained; captions, duration controls and labels are readable. No new font dependency.                                                                                               |
| Spacing and layout   | Desktop three-column and narrow two-column grids verified. Tighter cards; visible footer and sticky steps. No document-level horizontal overflow at 1487 × 1058 or 900 × 800. Sidebar collapse/expansion retains usable actions. |
| Colors and tokens    | Dashboard rose accent and semantic states reuse theme tokens. Dark mode was not separately captured.                                                                                                                             |
| Images and assets    | All sample images loaded. Production previews use authenticated blobs and snapshot media/export names. Actual text appears on text cards. No generated demo image is installed into a real product library.                      |
| Copy and content     | Business-facing zh/en copy, familiar language/aspect ratio, internal brief JSON hidden. Scene illustration, ZIP download and local MP4 rendering are clearly distinguished.                                                      |

Full-view labels are readable at native desktop size. Additional focused checks used browser DOM/accessibility inspection for input values, disabled states, navigation and footer bounds; a separate magnified crop was not needed to resolve the findings.

## Verification evidence

- `cd dashboard && npx tsc -b` — exit 0.
- `cd dashboard && npx vitest run src/pages/ProductVideoWizard/brief.test.ts src/pages/ProductVideoWizard/index.test.tsx` — 2 files, 6 tests passed. Covers roundtrip/legacy/length limits, generation failure retaining the project, restored draft editing/confirmation/export, replacing restored platform requirements, disabled inputs during save, and snapshot media.
- `cd dashboard && npm run build` — exit 0, TypeScript plus production Vite/PWA build. Final Vite build completed in 2m 36s. Existing chunk-size and mixed static/dynamic import warnings are non-fatal.
- Fresh production-preview browser: successful confirmation and real browser download event for the mocked ZIP; no console error entries.
- Other mock-browser checks: product selection, back navigation retaining inputs, generation loading/failure/retry, project ID in URL, refresh restoring draft and structured requirements, caption/duration save, edit invalidating export, and responsive navigation/footer.
- `git diff --check` — clean.

## Scope and residual gaps

Only frontend checks were run, as requested. No make all, backend tests, real model call, cross-user server-security acceptance, WeChat live login or local Remotion/MP4 render was performed. The downloaded mock ZIP contains a test-only README, not a renderer package. Existing backend MVP acceptance remains separate. The desktop M1 checkout was not modified.

## Implementation checklist

- [x] Compare selected visual and implementation together.
- [x] Resolve and recapture P0/P1/P2 issues.
- [x] Verify critical interactions with mock data.
- [x] Inspect final production bundle and console.
- [x] Save desktop/download/narrow evidence.
- [x] Record test scope and unverified integrations.
