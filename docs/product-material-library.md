# Product material library

The dashboard's **Products** page (`/product-library`) is a per-user product and asset library. It stores product name, model, category, confirmed selling points, parameters, expression limits, and uploaded files. Product metadata is in SQLite or PostgreSQL; file bytes are stored under `~/.octop/product-library/<user_id>/` and are not inserted into the database. All API reads and writes are scoped to the authenticated user.

Back up the local `~/.octop/product-library/` files together with the Octop database; the database stores the metadata and paths, not file contents.

## Guided product video creation

Choose **Make a product video** on the Products page to open `/product-library/video-wizard`. The five steps select an owned product and scene assets, collect business requirements, generate an AI storyboard, edit and confirm scene cards, and download the confirmed ZIP for local Studio preview and MP4 rendering. Existing projects offer **Continue video** to restore their saved storyboard. The page reuses Dashboard authentication, themes and translations; it does not require a running agent.

Generation uses the existing backend LLM planner. If that service is unavailable, the wizard retains the project and requirements for an explicit retry. It does not substitute the deterministic template for a successful AI response. Text, media and duration edits must be saved and confirmed before the storyboard-specific package can be downloaded; editing a confirmed plan requires confirmation again. Product snapshots remain immutable, so additional media requires a new project.

See the [UI and interaction specification](design/product-video-wizard/README.md) for the selected design, interface contracts and verification boundaries. The original template-package and expert-workspace actions remain available in the library.

## Assets and snapshots

Upload raster images (`png`, `jpg`, `jpeg`, `gif`, `webp`, `bmp`, `avif`), video (`mp4`, `webm`, `mov`, `m4v`), and common documents (`pdf`, text/markdown, Office documents, CSV, and RTF). SVG and HTML are not accepted. Each file can be marked as scene media, understanding reference, or style reference; assets can be prioritized or disabled. Search and type filters narrow the current product's asset list.

Creating a video project stores an immutable snapshot of the selected product fields and asset IDs, file hashes, paths, and usage. Later product edits or asset deactivation do not rewrite earlier snapshots. The initial generated script is a straightforward Remotion `script.json`: product title, selling-point bullets, selected scene images/videos, and an end card. Reference and style files are retained in the snapshot but are not inserted into playable scenes.

## Preparing an existing Remotion job

Choose one of your own running agents on the project and select **Prepare render job**. Octop verifies agent ownership, then writes assets and finally `script.json` through `BackendWorkspace` to `render-jobs/<project_id>/`. The job is marked prepared only after those writes succeed; this step does not render a video.

The existing local synchronizer can then poll the selected agent workspace and render it:

```bash
cd remotion
node sync.mjs --server https://your-octop.example --agent <agent_id> --token <dashboard-jwt> --queue render-jobs
```

See [Remotion's local rendering guide](../remotion/README.md) for setup and output behavior. The product library currently has no embedded Remotion Player, automatic LLM product extraction, PDF parsing, video-duration extraction, or video editor. Product facts and usage labels are entered by the user; uploaded reference documents are stored and downloadable but are not automatically parsed.
