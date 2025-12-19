const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d");

const cameraVideo = document.getElementById("cameraVideo");
const playbackVideo = document.getElementById("playbackVideo");

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

let activeVideo = cameraVideo;

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
let rafId = null;

let repCount = 0;

function setState(s) {
  stateText.textContent = s;
}

function resetSession() {
  repCount = 0;
  repCountText.textContent = "0";
  verdictText.textContent = "—";
}

function setActive(which) {
  if (which === "camera") {
    activeVideo = cameraVideo;
    cameraVideo.classList.remove("hidden");
    playbackVideo.classList.add("hidden");
  } else {
    activeVideo = playbackVideo;
    playbackVideo.classList.remove("hidden");
    cameraVideo.classList.add("hidden");
  }
}

function resizeCanvas() {
  if (!activeVideo.videoWidth || !activeVideo.videoHeight) return;
  canvas.width = activeVideo.videoWidth;
  canvas.height = activeVideo.videoHeight;
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

function stopRaf() {
  if (rafId != null) {
    cancelAnimationFrame(rafId);
    rafId = null;
  }
}

function stopStreamTracks(s) {
  if (!s) return;
  try { s.getTracks().forEach((t) => t.stop()); } catch {}
}

function clearPlaybackVideo() {
  try { playbackVideo.pause(); } catch {}
  playbackVideo.controls = false;
  playbackVideo.removeAttribute("src");
  playbackVideo.load();
}

function clearCameraVideo() {
  if (cameraVideo.srcObject) {
    stopStreamTracks(cameraVideo.srcObject);
    cameraVideo.srcObject = null;
  }
  try { cameraVideo.pause(); } catch {}
}

function pickMimeType() {
  const types = [
    "video/webm;codecs=vp9",
    "video/webm;codecs=vp8",
    "video/webm",
    "video/mp4",
  ];
  for (const t of types) {
    if (window.MediaRecorder && MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(t)) return t;
  }
  return "";
}

async function stopAllVideo() {
  analyzingPlayback = false;
  stopRaf();

  if (mediaRecorder && mediaRecorder.state !== "inactive") {
    try { mediaRecorder.stop(); } catch {}
  }
  mediaRecorder = null;

  cameraHelper = null;

  if (stream) {
    stopStreamTracks(stream);
    stream = null;
  }

  clearCameraVideo();
  clearPlaybackVideo();

  runningLive = false;
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

    await stopAllVideo();
    await ensurePose();

    setActive("camera");

    runningLive = true;

    if (typeof Camera !== "undefined" && Camera.Camera) {
      cameraHelper = new Camera.Camera(cameraVideo, {
        onFrame: async () => {
          if (!runningLive) return;
          await pose.send({ image: cameraVideo });
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
      cameraVideo.srcObject = stream;
      await cameraVideo.play();

      const loop = async () => {
        if (!runningLive) return;
        await pose.send({ image: cameraVideo });
        rafId = requestAnimationFrame(loop);
      };
      rafId = requestAnimationFrame(loop);
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

    analyzingPlayback = false;
    stopRaf();

    await stopAllVideo();
    await ensurePose();

    setActive("camera");

    stream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false,
    });

    cameraVideo.srcObject = stream;
    await cameraVideo.play();

    startPreviewBtn.disabled = true;
    stopPreviewBtn.disabled = false;
    startRecBtn.disabled = false;
    stopRecBtn.disabled = true;

    analyzeBtn.disabled = true;
    stopAnalyzeBtn.disabled = true;

    playbackControls.style.display = recordedBlobUrl ? "" : "none";
    clearClipBtn.disabled = !recordedBlobUrl;

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

  analyzeBtn.disabled = !recordedBlobUrl;
  stopAnalyzeBtn.disabled = true;
  clearClipBtn.disabled = !recordedBlobUrl;

  playbackControls.style.display = recordedBlobUrl ? "" : "none";
  setState("stopped");
}

async function startRecording() {
  try {
    if (!stream) throw new Error("Start Preview first.");

    analyzingPlayback = false;
    stopRaf();

    recordedChunks = [];

    const mimeType = pickMimeType();
    mediaRecorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);

    mediaRecorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) recordedChunks.push(e.data);
    };

    mediaRecorder.onstop = async () => {
      const blob = new Blob(recordedChunks, { type: mediaRecorder.mimeType || "video/webm" });

      if (recordedBlobUrl) {
        try { URL.revokeObjectURL(recordedBlobUrl); } catch {}
        recordedBlobUrl = null;
      }
      recordedBlobUrl = URL.createObjectURL(blob);

      if (stream) {
        stopStreamTracks(stream);
        stream = null;
      }
      clearCameraVideo();

      setActive("playback");

      clearPlaybackVideo();
      playbackVideo.src = recordedBlobUrl;
      playbackVideo.controls = true;

      await playbackVideo.play().catch(() => {});
      playbackControls.style.display = "";
      analyzeBtn.disabled = false;
      stopAnalyzeBtn.disabled = true;
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

function getPlaybackDur() {
  return Number.isFinite(playbackVideo.duration) ? playbackVideo.duration : 0;
}

function updateScrubUi() {
  const dur = getPlaybackDur();
  playbackDur.textContent = dur.toFixed(2);
  playbackTime.textContent = (playbackVideo.currentTime || 0).toFixed(2);
  scrub.value = dur > 0 ? Math.round((playbackVideo.currentTime / dur) * 1000) : 0;
}

function scrubToValue(v) {
  const dur = getPlaybackDur();
  if (!dur) return;
  const t = (Number(v) / 1000) * dur;
  playbackVideo.currentTime = Math.max(0, Math.min(dur, t));
  updateScrubUi();
}

async function analyzePlayback() {
  try {
    if (!recordedBlobUrl) throw new Error("Record a clip first.");
    await ensurePose();

    setActive("playback");

    analyzingPlayback = true;
    analyzeBtn.disabled = true;
    stopAnalyzeBtn.disabled = false;

    setState("analyzing");

    const loop = async () => {
      if (!analyzingPlayback) return;
      await pose.send({ image: playbackVideo });
      updateScrubUi();
      rafId = requestAnimationFrame(loop);
    };

    if (playbackVideo.paused) {
      await playbackVideo.play().catch(() => {});
    }

    rafId = requestAnimationFrame(loop);
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
  analyzingPlayback = false;
  stopRaf();

  if (recordedBlobUrl) {
    try { URL.revokeObjectURL(recordedBlobUrl); } catch {}
    recordedBlobUrl = null;
  }
  recordedChunks = [];

  playbackControls.style.display = "none";
  analyzeBtn.disabled = true;
  stopAnalyzeBtn.disabled = true;
  clearClipBtn.disabled = true;

  clearPlaybackVideo();
  setActive("camera");
  setState("idle");
}

exerciseSelect.addEventListener("change", () => {
  setExercise(exerciseSelect.value);
  resetSession();
});

modeSelect.addEventListener("change", async () => {
  await stopAllVideo();
  setUiForMode(modeSelect.value);

  startLiveBtn.disabled = false;
  stopLiveBtn.disabled = true;

  startPreviewBtn.disabled = false;
  stopPreviewBtn.disabled = true;
  startRecBtn.disabled = true;
  stopRecBtn.disabled = true;

  analyzeBtn.disabled = !recordedBlobUrl;
  stopAnalyzeBtn.disabled = true;
  clearClipBtn.disabled = !recordedBlobUrl;

  playbackControls.style.display = recordedBlobUrl ? "" : "none";
  setActive("camera");
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

playbackVideo.addEventListener("timeupdate", () => {
  if (currentMode === "recorded") updateScrubUi();
});

playbackVideo.addEventListener("loadedmetadata", () => {
  if (currentMode === "recorded") updateScrubUi();
});

setExercise(exerciseSelect.value);
setUiForMode(modeSelect.value);
setActive("camera");
setState("idle");
resetSession();
