# AGENTS.md

This project ships agent context: skills under `.agents/skills/` and MCP servers in `.mcp.json`. Load them before writing code.

**Setting the project up in someone's Fabric tenant?** Follow `README.md` → "Setup guide for an AI agent" step by step.
Ask the user for their Fabric workspace name first; never guess it and never reuse IDs from another tenant.

## Project

React + TypeScript (Vite) medical image viewer ("Rayfin Imaging") backed by **Project Rayfin**, with six tabs:
Overview, Pathology (OpenSeadragon deep zoom of H&E and multiplex immunofluorescence slides) and 3D and 4D imaging
(NiiVue volume rendering, MPR, fusion, 4D cine, tractography, plus a sprite-based rotating MIP), Pathology (OHIF) and
3D/4D (OHIF) (the original DICOM files in the OHIF Viewer, read straight from OneLake without a DICOMweb server), and a
plain-language Guide for non-clinical viewers. The repository contains no image data: `pipeline/` downloads it from
public sources.
Images live in a Fabric Lakehouse; `getSlideCatalog`, `getVolumeCatalog` and `getDicomAccess` read from OneLake as the
app identity and sign read-only, folder-scoped SAS tokens so the browser streams directly from OneLake. Shared pins
are stored in the `SlidePin` entity. Production auth is Fabric Entra SSO; local dev uses a mock sign-in flow.

## Repo map

- `src/` – React UI
- `src/components/ui/` – Radix-based UI components (shadcn)
- `src/components/` – App components (AppShell, SlideViewer, VolumeViewer, MipViewer, Panel, LakehouseImage, AuthPage)
- `src/hooks/` – React hooks (useCatalog / useVolumeCatalog, usePins, useTheme, AuthContext)
- `src/pages/` – Tabs (Overview, Pathology, Volumes, OhifViewer, Guide) and AuthCallback
- `ohif/` – OHIF Viewer for the Pathology (OHIF) and 3D/4D (OHIF) tabs: `node ohif/build.mjs` (Node 24+) clones
  OHIF v3.13.13 into `ohif/.build/`, adds `extension-rayfin/`, applies `patches/`, builds to `public/ohif/` (git-ignored)
- `pipeline/dicom/` – original DICOM from IDC for the OHIF tabs: `download_dicom.py`, `build_dicom.py` (index, DICOM
  JSON, thumbnails, slide tile byte offsets), `upload_dicom.sh` → `Files/dicom`
- `src/content/caseGuide.ts` – Plain-language notes for TCGA case data (genes, staging, AI layers); genes without a
  note fall back to a generic line
- `src/components/pathology/` – Case UI: patient banner, filmstrip, Case tab, AI layers, report pane (PDF.js)
- `pipeline/build_cases.py` – Per-case data from GDC (clinical, genomics, report, other slides) and IDC AI overlays;
  writes `slides/<id>/case.json`, merged into the manifest by `generate_tiles.py`. `generate_tiles.py` and
  `pipeline/volumes/build_manifest.py` also add `study` (patient, date, type of the matching study in
  `work/dicom/{pathology,radiology}/studies.json`, via `pipeline/dicom/study_refs.py`), which the Pathology and 3D and
  4D lists show (`src/components/OhifStudyRow.tsx`) so a case can be found in the OHIF tabs; rerun both after
  `build_dicom.py` (`generate_tiles.py --only none` skips tiling)
- `src/content/guide.ts` – Plain-language notes for laypeople, keyed by slide/study/layer/marker id; add an entry when a
  catalog item is added (missing ids fall back to the catalog description). Shown in the Guide tab, the "In plain
  words" panel section and control tooltips
- `scripts/setup_fabric.py` – finds/creates the workspace and Lakehouse, writes `fabric.env` and the
  `<lakehouse-config>` block in `rayfin/functions/src/function_app.ts`
- `pipeline/` – Python image pipeline: `download_slides.py` (TCGA), `download_data.py` (all other public sources),
  DZI tiling, multiplex IF, OneLake upload; `pipeline/volumes/` has one `build_*.py` per study (NIfTI, 4D NIfTI, TRK,
  MIP sprites), then `build_manifest.py` and `upload_volumes.sh`. IDs come from `fabric.env` via `fabric_config.py` /
  `fabric_env.sh`
- `src/services/` – Service layer (ServiceContainer, Rayfin services, auth services)
- `rayfin/rayfin.yml` – Rayfin configuration (auth, data, functions, static hosting)
- `rayfin/functions/` – Functions (`getSlideCatalog`, `getVolumeCatalog`, `getTiles`)
- `rayfin/data/` – Entities (export from `rayfin/data/schema.ts`)

## UI (Radix-based shadcn/ui)

This project uses **Radix-based UI components** styled with **Tailwind CSS v4**.

- UI components live in `src/components/ui/`
- Utility helper lives in `src/lib/utils.ts` (`cn`)
- Add a component: `npx shadcn@latest add <component>`

Key config/files:

- Global styles + Tailwind import: `src/styles/theme.css`
- Path alias `@/*` → `src/*`: `tsconfig.json`
- Vite plugins + alias: `vite.config.ts`
- shadcn registry/config: `components.json`

## Architecture

### Service Layer

- **ServiceContainer**: Singleton that initializes and provides access to services; auto-detects local vs. production and selects the appropriate auth service
- **RayfinClientService**: Manages the RayfinClient singleton instance
- **lib/catalog.ts**: Calls `getSlideCatalog`, builds OneLake tile URLs, batches `getTiles` proxy calls
- **lib/volumes.ts**: Calls `getVolumeCatalog`, builds signed OneLake URLs for NIfTI layers and timeline frames
- **usePins**: `SlidePin` CRUD via the DataApi fluent interface

### Auth Service Layer

- **RayfinAuthService**: Fabric Entra authentication operations (production)
- **RayfinFabricAuthService**: Delegates to `@microsoft/rayfin-auth-provider-fabric` SDK for Entra flows
- **MockAuthService**: Local development mock authentication (email/password via local backend)
- **AuthContext**: React context for auth state management

### Routing

- `/auth` – Public auth page (Fabric sign-in or mock sign-in; redirects to `/` if authenticated)
- `/auth/callback` – Fabric Entra OAuth callback
- `/` – Overview (legacy `/?slide=` links redirect to `/pathology`)
- `/pathology?slide=<id>` – slide list + viewer (optional `x`, `y`, `z` deep-link view)
- `/volumes?study=<id>&t=<frame>` – volume list + 3D/4D viewer
- `/pathology-ohif`, `/imaging-ohif` – the OHIF Viewer (`src/pages/OhifViewer.tsx`) for the Pathology (OHIF) and
  3D/4D (OHIF) tabs; `?route=<mode>&StudyInstanceUIDs=<uid>` opens a study directly
- Local data mode: `npm run dev:local` (`.env.localdata`, `VITE_LOCAL_DATA=1`) serves `work/` at `/local-data/` from the
  Vite dev server and reads manifests directly (`src/lib/localData.ts`, `LocalDataAuthService`, browser-stored pins).
  No Fabric, backend or database; production builds are unaffected
- `/guide#<section>` – plain-language guide (sections: pathology, markers, pathology-controls, views, volume-controls,
  images, licences, glossary)

### Key files

- `rayfin/data/SlidePin.ts` – Shared pin entity; authenticated read, author-only create/update/delete
- `rayfin/functions/src/function_app.ts` – OneLake catalog + SAS signing (app identity) and tile proxy. Workspace and
  Lakehouse IDs live only in its `<lakehouse-config>` block, which `scripts/setup_fabric.py` rewrites
- `src/components/SlideViewer.tsx` – OpenSeadragon viewer, tour, pins overlays; multiplex slides add one tiled image
  per marker (`compositeOperation: 'lighter'`, canvas drawer)
- `src/components/VolumeViewer.tsx` – NiiVue wrapper; studies are data-driven from `Files/volumes/manifest.json`.
  Layers with `frames4d` are one 4D NIfTI switched with `setFrame4D`; `tracts` layers load as meshes; colour presets
  may set `glass` (gradient opacity + silhouette)
- `src/components/MipViewer.tsx` – rotating MIP from the study's `mip` sprite sheet (NiiVue has no MIP mode)
- `src/services/ServiceContainer.ts` – Service initialization with auth-mode detection

## Case data notes

- A TCGA slide's `caseInfo.images[0]` is the catalog slide (`key: main`); other images live under
  `slides/<id>/case/<key>/` and AI overlays under `<image folder>/overlays/`. All are inside the signed
  `Files/slides` scope; `getTiles` allow-lists the same paths for proxy mode.
- Overlay pyramids write a 1x1 transparent PNG for empty tiles so the viewer never requests a missing file.
- PDF.js needs its `wasm`, `standard_fonts` and `cmaps` folders at `/pdfjs/` (`pdfjsAssetsPlugin` in vite.config.ts).
- Display switches (banner, filmstrip, AI buttons, report, Case tab) are stored in `localStorage` `atlas.casePrefs`.

## OHIF notes

- The OHIF tabs frame `/ohif/index.html?route=<mode>/<data source>&...`; `ohif/config/rayfin.js` rewrites that to
  the real client-side route before OHIF starts, so hosting needs no fallback routes for `/ohif/`.
- OHIF asks the parent page for access: `window.parent.rayfinDicom.getAccess()` (`src/lib/dicom.ts`), which calls the
  `getDicomAccess` function (read-only SAS for `Files/dicom`) or returns `/local-data/dicom` in local mode.
- Data sources `rayfin-pathology` and `rayfin-radiology` read `Files/dicom/<dataset>/`. Instances get a hidden
  `imageId`/`url` (`dicomweb:<signed URL>`) and no `wadoRoot`: with a `wadoRoot`, OHIF tries DICOMweb for
  RTSTRUCT/SR.
- Slides: the microscopy extension patch (`ohif/patches/`) lets `retrieve.microscopyClient()` supply the tile
  client; tiles are HTTP range reads using `files/<series>/<sop>.frames` (float64 offset/length pairs).
  `retrieve.getWadoDicomWebClient()` returns the same client for Cornerstone's whole-slide viewport, and
  `modesConfiguration` in `ohif/config/rayfin.js` excludes SM from the Cornerstone modes so slides open in Microscopy.
- BulkDataURIs are made absolute (`https://.../x.dcm#offset,length`) so OHIF's BulkDataURI fixer leaves them alone.
- `build_dicom.py` also turns binary values nested in sequences into BulkDataURIs. pydicom gives nested offsets
  relative to the sequence value, so `to_json` adds the sequence's file offset. Without this, the nucleus annotation
  (ANN) coordinates go inline as base64 and each `metadata.json` grows to 100–350 MB.
- Only genuine DICOM goes in the OHIF tabs; never convert NIfTI or PNG into DICOM for them.
- Fluorescence colours match the Pathology tab only because `fluorescence.ts` replaces dicom-microscopy-viewer's
  channel blend (`SRC_COLOR, ONE` squares each colour) with plain additive blending and the tiles' gamma curve. Each
  channel's window and gamma come from `build_multiplex.py` (label.json) via `build_dicom.py` (display.json), so run
  `build_dicom.py` after `build_multiplex.py`.
- Toolbar additions use the app config's phased `customizationService` (`global` `$push` onto
  `cornerstone.toolbarButtons` / `cornerstone.toolbarSections`), not OHIF patches. Crop 3D (`crop3d.ts`) registers
  Cornerstone3D's `VolumeCroppingTool` (on `volume3d`, replacing 3D Rotate while on) and `VolumeCroppingControlTool`
  (on `mpr`, activated then set passive so its lines stay draggable without taking the left button).

## NiiVue notes

- Per-label alpha in a label colour table is ignored in 3D renders; use layer opacity or a CT transfer function.
- Label maps must be integer NIfTI, or 3D renders draw a box.
- An opaque background volume hides meshes (tracts) in 3D; such studies hide the T1 by default.
- The built-in `gray` colour map is only half opaque, so a clip shows a blurred blend of tissue behind the cut; the
  `mri_solid` map (MRI "Solid" preset) gives sharp cut faces. `isClipAllVolumes` is on so clips cut overlays too.
- Catalog data is cached per session; `VolumeViewer` reloads when a study's layer files change, not just its id.

## Environment

- `.env` – Default Fabric API configuration
- `.env.local` – Local overrides (git-ignored, generated by `rayfin dev`)
- `rayfin/.env` – Runtime + deployment env (managed by Rayfin CLI)
- `rayfin/.deployments.json` – Registry of all Fabric workspace deployments (managed by Rayfin CLI)

## Code conventions

- Data: never commit images or derived data (`work/` is git-ignored). Add only datasets that are public and whose
  licence allows reuse including commercial use (CC0, public domain, CC BY, CC BY-SA); no non-commercial (NC) or
  no-derivatives (ND) licences, nothing behind a login or data-use agreement. Credit each source in its `study.json`
  and in the README.
- Code: only open-source dependencies with permissive or weak-copyleft licences; nothing proprietary.
- Never commit tenant-specific values (workspace/lakehouse IDs, hosting URLs, keys). `fabric.env`, `rayfin/.env*` and
  `rayfin/.deployments.json` are git-ignored; reset the `<lakehouse-config>` block to its zero GUIDs before committing.
- TypeScript strict mode; prefer small functional React components.
- Keep UI logic in `src/`; keep data model code in `rayfin/data/`.
- Services follow the singleton pattern via `ServiceContainer`.
- `ServiceContainer` auto-selects `MockAuthService` for localhost backends and `RayfinAuthService` for production.

## Generated files (do not edit)

- `rayfin/.temp/` – Rayfin/DAB config generation output
- `dist/` – Vite build output
- `.env.local` – Local environment overrides (git-ignored, script-managed)
- `fabric.env` – Workspace/Lakehouse IDs written by `scripts/setup_fabric.py` (git-ignored)
