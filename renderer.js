const dropZone = document.getElementById('dropZone');
const dropLabel = document.getElementById('dropLabel');
const controls = document.getElementById('controls');
const runButton = document.getElementById('runButton');
const waveformSection = document.getElementById('waveformSection');
const waveformFill = document.getElementById('waveformFill');
const statusMessage = document.getElementById('statusMessage');
const statusPercent = document.getElementById('statusPercent');
const resultSection = document.getElementById('resultSection');
const resultRemoved = document.getElementById('resultRemoved');
const resultPath = document.getElementById('resultPath');
const resetButton = document.getElementById('resetButton');
const errorMessage = document.getElementById('errorMessage');

const silenceDbInput = document.getElementById('silenceDb');
const minDurationInput = document.getElementById('minDuration');
const paddingInput = document.getElementById('padding');
const silenceDbValue = document.getElementById('silenceDbValue');
const minDurationValue = document.getElementById('minDurationValue');
const paddingValue = document.getElementById('paddingValue');

let selectedInputPath = null;

// ---------- Slider labels ----------

silenceDbInput.addEventListener('input', () => {
  silenceDbValue.textContent = `${silenceDbInput.value} dB`;
});
minDurationInput.addEventListener('input', () => {
  minDurationValue.textContent = `${parseFloat(minDurationInput.value).toFixed(1)} s`;
});
paddingInput.addEventListener('input', () => {
  paddingValue.textContent = `${parseFloat(paddingInput.value).toFixed(2)} s`;
});

// ---------- File selection ----------

dropZone.addEventListener('click', async () => {
  const filePath = await window.api.pickInputFile();
  if (filePath) setSelectedFile(filePath);
});

dropZone.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') dropZone.click();
});

['dragenter', 'dragover'].forEach((evt) => {
  dropZone.addEventListener(evt, (e) => {
    e.preventDefault();
    dropZone.classList.add('is-dragover');
  });
});

['dragleave', 'drop'].forEach((evt) => {
  dropZone.addEventListener(evt, (e) => {
    e.preventDefault();
    dropZone.classList.remove('is-dragover');
  });
});

dropZone.addEventListener('drop', (e) => {
  const file = e.dataTransfer.files[0];
  if (file && file.path) setSelectedFile(file.path);
});

function setSelectedFile(filePath) {
  selectedInputPath = filePath;
  const name = filePath.split(/[\\/]/).pop();
  dropLabel.textContent = name;
  controls.hidden = false;
  resultSection.hidden = true;
  errorMessage.hidden = true;
}

// ---------- Run ----------

runButton.addEventListener('click', async () => {
  if (!selectedInputPath) return;

  const inputName = selectedInputPath.split(/[\\/]/).pop();
  const dotIndex = inputName.lastIndexOf('.');
  const baseName = dotIndex > 0 ? inputName.slice(0, dotIndex) : inputName;
  const suggested = `${baseName}-trimmed.mp4`;

  const outputPath = await window.api.pickOutputPath(suggested);
  if (!outputPath) return;

  errorMessage.hidden = true;
  resultSection.hidden = true;
  controls.hidden = true;
  waveformSection.hidden = false;
  waveformFill.style.width = '0%';
  statusMessage.textContent = 'Starting…';
  statusPercent.textContent = '0%';

  const options = {
    inputPath: selectedInputPath,
    outputPath,
    noiseDb: parseInt(silenceDbInput.value, 10),
    minDurationSec: parseFloat(minDurationInput.value),
    paddingSec: parseFloat(paddingInput.value)
  };

  const result = await window.api.processVideo(options);
  if (!result.ok) {
    showError(result.error);
  }
});

window.api.onStatus((payload) => {
  if (payload.stage === 'error') {
    showError(payload.message);
    return;
  }

  statusMessage.textContent = payload.message;

  if (payload.stage === 'cutting' && payload.totalDuration && payload.secondsDone != null) {
    const pct = Math.min(100, Math.round((payload.secondsDone / payload.totalDuration) * 100));
    waveformFill.style.width = `${pct}%`;
    statusPercent.textContent = `${pct}%`;
  } else if (payload.stage === 'detecting') {
    waveformFill.style.width = '15%';
    statusPercent.textContent = '…';
  } else if (payload.stage === 'probing') {
    waveformFill.style.width = '5%';
    statusPercent.textContent = '…';
  }

  if (payload.stage === 'done') {
    waveformFill.style.width = '100%';
    statusPercent.textContent = '100%';
    waveformSection.hidden = true;
    resultSection.hidden = false;
    resultRemoved.textContent = `${payload.removedSeconds.toFixed(1)}s`;
    resultPath.textContent = payload.outputPath;
  }
});

function showError(message) {
  waveformSection.hidden = true;
  controls.hidden = false;
  errorMessage.hidden = false;
  errorMessage.textContent = message;
}

resetButton.addEventListener('click', () => {
  selectedInputPath = null;
  dropLabel.textContent = 'Drop a video file here, or click to choose one';
  controls.hidden = true;
  resultSection.hidden = true;
  errorMessage.hidden = true;
});
