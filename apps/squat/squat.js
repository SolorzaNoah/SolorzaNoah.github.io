const video = document.getElementById("video");
const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d");

const mirrorToggle = document.getElementById("mirrorToggle");
const stateText = document.getElementById("stateText");

const exerciseSelect = document.getElementById("exerciseSelect");
const modeSelect = document.getElementById("modeSelect");
const exerciseBadge = document.getElementById("exerciseBadge");
const modeBadge = document.getElementById("modeBadge");

const repCountText = document.getElementById("repCount");
const verdictText = document.getElementById("verdict");

const liveControls = document.getElementById("liveControls");
const recordControls = document.getElementById("recordControls");
const playbackControls = document.getElementById("playbackControls");

const startLiveBtn = document.getElementById("startLiveBtn");
const stopLiveBtn = document.getElementById("stopLiveBtn");

const startPreviewBtn = document.getElementById("startPreviewBtn");
const startRecBtn = document.getElementById("startRecBtn");
const stopRecBtn = document.getElementById("stopRecBtn");
const stopPreviewBtn = document.getElementById("stopPreviewBtn");

const analyzeBtn = document.getElementById("analyzeBtn");
const stopAnalyzeBtn = document.getElementById("stopAnalyzeBtn");
const clearClipBtn = document.getElementById("clearClipBtn");

const scrub = document.getElementById("scrub");
const playbackTime = document.getElementById("playbackTime");
const playbackDur = document.getElementById("playbackDur");

let currentExercise = "squat";
let currentMode = "live";

let pose = null;

let stream = null;
let cameraHelper = null;

let runningLive = false;

let mediaRecorder = null;
let recordedChunks = [];
let recordedBlobUrl = null;

let analyzingPlayback = false;
let playbackLoopHandle = null;

let repCount = 0;

function setState(s) {
  stateText.textContent = s;
}

function resetSession() {
  repCount = 0;
  repCountText.textContent = "0";
  verdictText.textContent = "—";
}

function resizeCanvas() {
  if (!video.videoWidth || !video.videoHeight) return;
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
}

function draw(results) {
  resizeCanvas();

  ctx.save();
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  if (mirrorToggle.checked) {
    ctx.translate(canvas.width, 0);
    ctx.scale(-1, 1);
  }

  ctx.drawImage(results.image, 0, 0, canvas.width, canvas.height);

  if (results.poseLandmarks) {
    drawConnectors(ctx, results.poseLandmarks, POSE_CONNECTIONS, { lineWidth: 3 });
    drawLandmarks(ctx, results.poseLandmarks, { radius: 3 });
  }

  ctx.restore();
}

async function onResults(results) {
  if (currentMode === "live" && !runningLive) return;
  if (currentMode === "recorded" && !analyzingPlayback && !stream) return;

  draw(results);
}

function makePose() {
  const p = new Pose({
    locateFile: (f) => `https://cdn.jsdelivr.net/npm/@mediapipe/pose/${f}`,
  });

  p.setOptions({
    modelComplexity: 1,
    smoothLandmarks: true,
    minDetectionConfidence: 0.6,
    minTrackingConfidence: 0.6,
  });

  p.onResults(onResults);
  return p;
}

async function ensurePose() {
  if (!pose) pose = makePose();
}

async function stopAllVideo() {
  analyzingPlayback = false;

  if (playbackLoopHandle) {
    cancelAnimationFrame(playbackLoopHandle);
    playbackLoopHandle = null;
  }

  if (cameraHelper) {
    cameraHelper = null;
  }

  if (stream) {
    stream.getTracks().forEach((t) => t.stop());
    stream = null;
  }

  if (video.srcObject) {
    video.srcObject.getTracks().forEach((t) => t.stop());
    video.srcObject = null;
  }

  try {
    video.pause();
  } catch {}

  if (pose) {
    try { pose.close(); } catch {}
    pose = null;
  }
}

function setUiForMode(mode) {
  currentMode = mode;

  modeBadge.textContent = mode === "live" ? "Live" : "Record + Review";

  if (mode === "live") {
    liveControls.style.display = "";
    recordControls.style.display = "none";
    playbackControls.style.display = "none";
  } else {
    liveControls.style.display = "none";
    recordControls.style.display = "";
    playbackControls.style.display = recordedBlobUrl ? "" : "none";
  }

  setState("idle");
  resetSession();
}

function setExercise(ex) {
  currentExercise = ex;
  const label = ex === "bench" ? "Bench" : ex === "deadlift" ? "Deadlift" : "Squat";
  exerciseBadge.textContent = label;
}

async function startLive() {
  try {
    setState("starting...");
    resetSession();

    if (!window.isSecureContext) throw new Error("Not secure. Use https:// (or localhost).");
    if (!navigator.mediaDevices?.getUserMedia) throw new Error("getUserMedia unavailable.");

    await ensurePose();

    runningLive = true;

    if (typeof Camera !== "undefined" && Camera.Camera) {
      cameraHelper = new Camera.Camera(video, {
        onFrame: async () => {
          if (!runningLive) return;
          await pose.send({ image: video });
        },
        width: 1280,
        height: 720,
      });
      await cameraHelper.start();
    } else {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
      video.srcObject = stream;
      await video.play();

      const loop = async () => {
        if (!runningLive) return;
        await pose.send({ image: video });
        requestAnimationFrame(loop);
      };
      requestAnimationFrame(loop);
    }

    startLiveBtn.disabled = true;
    stopLiveBtn.disabled = false;
    setState("tracking");
  } catch (e) {
    runningLive = false;
    setState(`error: ${e && e.message ? e.message : String(e)}`);
    startLiveBtn.disabled = false;
    stopLiveBtn.disabled = true;
    await stopAllVideo();
  }
}

async function stopLive() {
  runningLive = false;
  setState("stopped");
  startLiveBtn.disabled = false;
  stopLiveBtn.disabled = true;
  await stopAllVideo();
}

async function startPreview() {
  try {
    setState("starting...");
    resetSession();

    if (!window.isSecureContext) throw new Error("Not secure. Use https:// (or localhost).");
    if (!navigator.mediaDevices?.getUserMedia) throw new Error("getUserMedia unavailable.");

    await ensurePose();

    stream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false,
    });

    video.srcObject = stream;
    await video.play();

    startPreviewBtn.disabled = true;
    stopPreviewBtn.disabled = false;
    startRecBtn.disabled = false;
    stopRecBtn.disabled = true;

    playbackControls.style.display = recordedBlobUrl ? "" : "none";
    setState("preview");
  } catch (e) {
    setState(`error: ${e && e.message ? e.message : String(e)}`);
    await stopAllVideo();
    startPreviewBtn.disabled = false;
    stopPreviewBtn.disabled = true;
    startRecBtn.disabled = true;
    stopRecBtn.disabled = true;
  }
}

async function stopPreview() {
  if (mediaRecorder && mediaRecorder.state !== "inactive") {
    try { mediaRecorder.stop(); } catch {}
  }

  await stopAllVideo();

  startPreviewBtn.disabled = false;
  stopPreviewBtn.disabled = true;
  startRecBtn.disabled = true;
  stopRecBtn.disabled = true;

  setState("stopped");
}

function pickMimeType() {
  const types = [
    "video/webm;codecs=vp9",
    "video/webm;codecs=vp8",
    "video/webm",
    "video/mp4"
  ];
  for (const t of types) {
    if (window.MediaRecorder && MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(t)) return t;
  }
  return "";
}

async function startRecording() {
  try {
    if (!stream) throw new Error("Start Preview first.");

    if (recordedBlobUrl) {
      URL.revokeObjectURL(recordedBlobUrl);
      recordedBlobUrl = null;
    }
    recordedChunks = [];

    const mimeType = pickMimeType();
    mediaRecorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);

    mediaRecorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) recordedChunks.push(e.data);
    };

    mediaRecorder.onstop = async () => {
      const blob = new Blob(recordedChunks, { type: mediaRecorder.mimeType || "video/webm" });
      recordedBlobUrl = URL.createObjectURL(blob);

      video.pause();
      video.srcObject = null;
      video.src = recordedBlobUrl;
      video.controls = true;

      await video.play().catch(() => {});

      playbackControls.style.display = "";
      analyzeBtn.disabled = false;
      clearClipBtn.disabled = false;

      startRecBtn.disabled = false;
      stopRecBtn.disabled = true;

      updateScrubUi();
      setState("recorded");
    };

    mediaRecorder.start(200);

    startRecBtn.disabled = true;
    stopRecBtn.disabled = false;

    analyzeBtn.disabled = true;
    clearClipBtn.disabled = true;

    setState("recording");
  } catch (e) {
    setState(`error: ${e && e.message ? e.message : String(e)}`);
  }
}

function stopRecording() {
  try {
    if (!mediaRecorder) return;
    if (mediaRecorder.state !== "inactive") mediaRecorder.stop();
    setState("processing...");
  } catch (e) {
    setState(`error: ${e && e.message ? e.message : String(e)}`);
  }
}

function updateScrubUi() {
  const dur = Number.isFinite(video.duration) ? video.duration : 0;
  playbackDur.textContent = dur.toFixed(2);
  playbackTime.textContent = (video.currentTime || 0).toFixed(2);
  scrub.value = dur > 0 ? Math.round((video.currentTime / dur) * 1000) : 0;
}

function scrubToValue(v) {
  const dur = Number.isFinite(video.duration) ? video.duration : 0;
  if (!dur) return;
  const t = (Number(v) / 1000) * dur;
  video.currentTime = Math.max(0, Math.min(dur, t));
  updateScrubUi();
}

async function analyzePlayback() {
  try {
    if (!recordedBlobUrl) throw new Error("Record a clip first.");
    await ensurePose();

    analyzingPlayback = true;
    analyzeBtn.disabled = true;
    stopAnalyzeBtn.disabled = false;

    setState("analyzing");

    const loop = async () => {
      if (!analyzingPlayback) return;

      await pose.send({ image: video });
      updateScrubUi();

      playbackLoopHandle = requestAnimationFrame(loop);
    };

    if (video.paused) {
      await video.play().catch(() => {});
    }

    requestAnimationFrame(loop);
  } catch (e) {
    analyzingPlayback = false;
    analyzeBtn.disabled = false;
    stopAnalyzeBtn.disabled = true;
    setState(`error: ${e && e.message ? e.message : String(e)}`);
  }
}

function stopAnalyze() {
  analyzingPlayback = false;
  analyzeBtn.disabled = false;
  stopAnalyzeBtn.disabled = true;
  setState("recorded");
}

async function clearClip() {
  stopAnalyze();

  if (recordedBlobUrl) {
    try { URL.revokeObjectURL(recordedBlobUrl); } catch {}
    recordedBlobUrl = null;
  }
  recordedChunks = [];

  analyzeBtn.disabled = true;
  stopAnalyzeBtn.disabled = true;
  clearClipBtn.disabled = true;

  playbackControls.style.display = "none";

  video.controls = false;
  video.removeAttribute("src");
  video.load();

  setState("idle");
}

function refreshModeUi() {
  if (currentMode === "live") {
    startLiveBtn.disabled = false;
    stopLiveBtn.disabled = true;
  } else {
    startPreviewBtn.disabled = false;
    stopPreviewBtn.disabled = true;
    startRecBtn.disabled = true;
    stopRecBtn.disabled = true;
    analyzeBtn.disabled = !recordedBlobUrl;
    stopAnalyzeBtn.disabled = true;
    clearClipBtn.disabled = !recordedBlobUrl;
    playbackControls.style.display = recordedBlobUrl ? "" : "none";
  }
}

exerciseSelect.addEventListener("change", () => {
  setExercise(exerciseSelect.value);
  resetSession();
});

modeSelect.addEventListener("change", async () => {
  await stopAllVideo();
  setUiForMode(modeSelect.value);
  refreshModeUi();
});

mirrorToggle.addEventListener("change", () => {
  if (currentMode === "recorded") {
    updateScrubUi();
  }
});

startLiveBtn.addEventListener("click", startLive);
stopLiveBtn.addEventListener("click", stopLive);

startPreviewBtn.addEventListener("click", startPreview);
stopPreviewBtn.addEventListener("click", stopPreview);
startRecBtn.addEventListener("click", startRecording);
stopRecBtn.addEventListener("click", stopRecording);

analyzeBtn.addEventListener("click", analyzePlayback);
stopAnalyzeBtn.addEventListener("click", stopAnalyze);
clearClipBtn.addEventListener("click", clearClip);

scrub.addEventListener("input", (e) => {
  scrubToValue(e.target.value);
});

video.addEventListener("timeupdate", () => {
  if (currentMode === "recorded") updateScrubUi();
});

video.addEventListener("loadedmetadata", () => {
  if (currentMode === "recorded") updateScrubUi();
});

setExercise(exerciseSelect.value);
setUiForMode(modeSelect.value);
refreshModeUi();
setState("idle");
resetSession();
