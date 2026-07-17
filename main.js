const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const fs = require('fs');

// ffmpeg-static / ffprobe-static give us real native binaries bundled with
// the app, so this runs at full hardware speed with no browser sandbox and
// no internet connection required at runtime.
let ffmpegPath = require('ffmpeg-static');
let ffprobePath = require('ffprobe-static').path;

// When packaged, these paths point inside the asar archive; unpack them.
if (app.isPackaged) {
  ffmpegPath = ffmpegPath.replace('app.asar', 'app.asar.unpacked');
  ffprobePath = ffprobePath.replace('app.asar', 'app.asar.unpacked');
}

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 760,
    minWidth: 820,
    minHeight: 600,
    backgroundColor: '#0b0d12',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    },
    autoHideMenuBar: true
  });

  mainWindow.loadFile('index.html');
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

// ---------- File pickers ----------

ipcMain.handle('pick-input-file', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Choose a video file',
    properties: ['openFile'],
    filters: [
      { name: 'Video', extensions: ['mp4', 'mov', 'mkv', 'avi', 'webm', 'm4v'] }
    ]
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});

ipcMain.handle('pick-output-path', async (event, suggestedName) => {
  const result = await dialog.showSaveDialog(mainWindow, {
    title: 'Save processed video as',
    defaultPath: suggestedName || 'output.mp4',
    filters: [{ name: 'MP4 Video', extensions: ['mp4'] }]
  });
  if (result.canceled || !result.filePath) return null;
  return result.filePath;
});

// ---------- Helpers ----------

function runFFprobeDuration(inputPath) {
  return new Promise((resolve, reject) => {
    const args = [
      '-v', 'error',
      '-show_entries', 'format=duration',
      '-of', 'default=noprint_wrappers=1:nokey=1',
      inputPath
    ];
    const proc = spawn(ffprobePath, args);
    let out = '';
    proc.stdout.on('data', (d) => (out += d.toString()));
    proc.on('close', (code) => {
      const dur = parseFloat(out.trim());
      if (code === 0 && !Number.isNaN(dur)) resolve(dur);
      else reject(new Error('Could not read video duration.'));
    });
    proc.on('error', reject);
  });
}

// Runs ffmpeg's silencedetect filter and parses silence_start / silence_end
// pairs from stderr (ffmpeg logs filter output to stderr, not stdout).
function detectSilence(inputPath, noiseDb, minDurationSec, onProgress) {
  return new Promise((resolve, reject) => {
    const args = [
      '-i', inputPath,
      '-af', `silencedetect=noise=${noiseDb}dB:d=${minDurationSec}`,
      '-f', 'null',
      '-'
    ];
    const proc = spawn(ffmpegPath, args);
    let stderrBuf = '';
    const silences = [];
    let pendingStart = null;

    proc.stderr.on('data', (chunk) => {
      const text = chunk.toString();
      stderrBuf += text;
      onProgress && onProgress('Scanning for silence…');

      const startMatches = text.matchAll(/silence_start:\s*([\d.]+)/g);
      for (const m of startMatches) pendingStart = parseFloat(m[1]);

      const endMatches = text.matchAll(/silence_end:\s*([\d.]+)\s*\|\s*silence_duration:\s*([\d.]+)/g);
      for (const m of endMatches) {
        const end = parseFloat(m[1]);
        const start = pendingStart !== null ? pendingStart : end - parseFloat(m[2]);
        silences.push({ start, end });
        pendingStart = null;
      }
    });

    proc.on('close', () => resolve(silences));
    proc.on('error', reject);
  });
}

// Turns silence intervals into the segments we want to KEEP, applying
// padding so cuts don't feel jarring.
function computeKeepSegments(silences, duration, paddingSec) {
  const keep = [];
  let cursor = 0;

  for (const s of silences) {
    const cutStart = Math.max(0, s.start + paddingSec);
    const cutEnd = Math.min(duration, s.end - paddingSec);
    if (cutStart > cursor) {
      keep.push({ start: cursor, end: Math.min(cutStart, duration) });
    }
    cursor = Math.max(cursor, cutEnd);
  }

  if (cursor < duration) {
    keep.push({ start: cursor, end: duration });
  }

  // Drop degenerate/near-zero segments.
  return keep.filter((seg) => seg.end - seg.start > 0.05);
}

function buildSelectExpr(segments) {
  return segments
    .map((seg) => `between(t,${seg.start.toFixed(3)},${seg.end.toFixed(3)})`)
    .join('+');
}

function runCut(inputPath, outputPath, segments, onProgress) {
  return new Promise((resolve, reject) => {
    if (segments.length === 0) {
      reject(new Error('No non-silent segments were found — try lowering the silence threshold.'));
      return;
    }

    const expr = buildSelectExpr(segments);
    const args = [
      '-y',
      '-i', inputPath,
      '-vf', `select='${expr}',setpts=N/FRAME_RATE/TB`,
      '-af', `aselect='${expr}',asetpts=N/SR/TB`,
      outputPath
    ];

    const proc = spawn(ffmpegPath, args);
    proc.stderr.on('data', (chunk) => {
      const text = chunk.toString();
      const timeMatch = text.match(/time=(\d+):(\d+):(\d+\.\d+)/);
      if (timeMatch) {
        const seconds =
          parseInt(timeMatch[1], 10) * 3600 +
          parseInt(timeMatch[2], 10) * 60 +
          parseFloat(timeMatch[3]);
        onProgress && onProgress(seconds);
      }
    });
    proc.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error('ffmpeg exited with an error while cutting the video.'));
    });
    proc.on('error', reject);
  });
}

// ---------- Main processing pipeline, exposed to renderer ----------

ipcMain.handle('process-video', async (event, options) => {
  const { inputPath, outputPath, noiseDb, minDurationSec, paddingSec } = options;
  const send = (payload) => event.sender.send('process-status', payload);

  try {
    if (!fs.existsSync(inputPath)) throw new Error('Input file not found.');

    send({ stage: 'probing', message: 'Reading video info…' });
    const duration = await runFFprobeDuration(inputPath);

    send({ stage: 'detecting', message: 'Scanning audio for silence…' });
    const silences = await detectSilence(inputPath, noiseDb, minDurationSec, (msg) =>
      send({ stage: 'detecting', message: msg })
    );

    const keepSegments = computeKeepSegments(silences, duration, paddingSec);
    const removedSeconds = silences.reduce(
      (sum, s) => sum + Math.max(0, s.end - s.start - 2 * paddingSec),
      0
    );

    send({
      stage: 'cutting',
      message: `Removing ${removedSeconds.toFixed(1)}s of dead air across ${silences.length} gaps…`,
      totalDuration: duration
    });

    await runCut(inputPath, outputPath, keepSegments, (secondsDone) => {
      send({
        stage: 'cutting',
        message: 'Rendering trimmed video…',
        totalDuration: duration,
        secondsDone
      });
    });

    send({
      stage: 'done',
      message: 'Done!',
      outputPath,
      originalDuration: duration,
      removedSeconds
    });
    return { ok: true };
  } catch (err) {
    send({ stage: 'error', message: err.message });
    return { ok: false, error: err.message };
  }
});
