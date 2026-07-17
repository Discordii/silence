# Silence Remover

A desktop app that finds dead air in a video and cuts it out automatically.
Everything runs locally through a bundled copy of ffmpeg — no upload, no
account, no server.

## What it does

1. Pick a video (drag-and-drop or file picker).
2. Adjust three sliders:
   - **Silence threshold** — how quiet counts as "silence" (in dB).
   - **Minimum gap length** — how long a quiet stretch has to be before it's
     considered dead air (short pauses in speech are left alone).
   - **Padding** — a small buffer kept around each cut so it doesn't feel abrupt.
3. Click **Remove silence**. The app scans the audio track, works out which
   parts of the video to keep, and renders the trimmed file to a location you
   choose.

## Running it locally (development)

Requires [Node.js](https://nodejs.org) 18+.

```bash
npm install
npm start
```

`ffmpeg-static` and `ffprobe-static` download prebuilt ffmpeg/ffprobe
binaries for your platform as part of `npm install` — no separate ffmpeg
install needed.

## Building the Windows installer

### Option A — GitHub Actions (recommended, no local Windows machine needed)

This repo includes `.github/workflows/build-windows.yml`. Push the repo to
GitHub and either:

- push to `main`, or
- go to **Actions → Build Windows app → Run workflow**,

and GitHub will build `Silence Remover Setup <version>.exe` on a hosted
Windows runner and attach it as a downloadable artifact on the workflow run.

### Option B — Build locally on Windows

```bash
npm install
npm run dist
```

The installer will be in `dist/`.

## Project layout

```
main.js         Electron main process — file dialogs, ffmpeg pipeline
preload.js      Safe bridge between main process and the UI
index.html      App window UI
renderer.js     UI logic, talks to main process via window.api
styles.css      Styling
.github/workflows/build-windows.yml   CI build for the Windows installer
```

## Notes on the silence-removal approach

Rather than running ffmpeg through WebAssembly in a browser sandbox, this
app shells out to a real, native ffmpeg binary bundled with the app. That's
both simpler and considerably faster than the wasm route, since it isn't
constrained by the browser's single-threaded WASM runtime — and because it's
a desktop app rather than a webpage, there's no need for a service worker,
PWA manifest, or offline-caching layer to get "native-feeling" behavior.

The pipeline:

1. `ffprobe` reads the video's duration.
2. `ffmpeg`'s `silencedetect` filter scans the audio track and reports every
   silent interval above/below your threshold.
3. Those intervals are inverted (with padding) into a list of segments to
   *keep*.
4. A single `ffmpeg` pass with `select`/`aselect` filters extracts and
   concatenates only the kept segments into the output file.
