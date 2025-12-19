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

const liveToggleBtn = document.getElementById("liveToggleBtn");
const recordToggleBtn = document.getElementById("recordToggleBtn");
const newClipBtn = document.getElementById("newClipBtn");

const scrub = document.getElementById("scrub");
const playbackTime = document.getElementById("playbackTime");
const playbackDur = document.getElementById("playbackDur");

let currentExercise = "squat";
let currentMode = "live";

let pose = null;

let stream = null;
let rafId = null;

let mediaRecorder = null;
let recordedChunks = [];
let recordedBlobUrl = null;

let state = "idle";

function setState(s) {
  state = s;
  stateText.textContent = s;
}

function resetSession() {
  repCountText.textContent = "0";
  verdictText.textContent = "—";
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

function showCamera() {
  cameraVideo.style.display = "";
  playbackVideo.style.display = "none";
}

function showPlayback() {
  playbackVideo.style.display = "";
  cameraVideo.style.display = "none";
}

function resizeCanvasFrom(videoEl) {
  if (!videoEl.videoWidth || !videoEl.videoHeight) return;
  if (canvas.width === videoEl.videoWidth && canvas.height === videoEl.videoHeight) return;
  canvas.width = videoEl.videoWidth;
  canvas.height = videoEl.videoHeight;
}

function draw(results) {
  const img = results.image;
  const w = canvas.width;
  const h = canvas.height;

  ctx.save();
  ctx.clearRect(0, 0, w, h);

  if (mirrorToggle.checked) {
    ctx.translate(w, 0);
    ctx.scale(-1, 1);
  }

  ctx.drawImage(img, 0, 0, w, h);

  if (results.poseLandmarks) {
    drawConnectors(ctx, results.poseLandmarks, POSE_CONNECTIONS, { lineWidth: 3 });
    drawLandmarks(ctx, results.poseLandmarks, { radius: 3 });
  }

  ctx.restore();
}

async function onResults(results) {
  draw(results);
}

function ensurePose() {
  if (pose) return;
  pose = new Pose({
    locateFile: (f) => `https://cdn.jsdelivr.net/npm/@mediapipe/pose/${f}`,
  });
  pose.setOptions({
    modelComplexity: 1,
    smoothLandmarks: true,
    minDetectionConfidence: 0.6,
    minTrackingConfidence: 0.6,
  });
  pose.onResults(onResults);
}

async function stopEverything() {
  stopRaf();

  if (mediaRecorder && mediaRecorder.state !== "inactive") {
    try { mediaRecorder.stop(); } catch {}
  }
  mediaRecorder = null;

  if (stream) {
    stopStreamTracks(stream);
    stream = null;
  }

  if (cameraVideo.srcObject) {
    try { cameraVideo.pause(); } catch {}
    stopStreamTracks(cameraVideo.srcObject);
    cameraVideo.srcObject = null;
  }

  try { playbackVideo.pause(); } catch {}
  playbackVideo.removeAttribute("src");
  playbackVideo.load();

  if (pose) {
    try { pose.close(); } catch {}
    pose = null;
  }
}

async function startCameraPreview() {
  if (!window.isSecureContext) throw new Error("Not secure. Use https:// (or localhost).");
  if (!navigator.mediaDevices?.getUserMedia) throw new Error("getUserMedia unavailable.");

  ensurePose();

  stream = await navigator.mediaDevices.getUserMedia({
    video: { width: { ideal: 1280 }, height: { ideal: 720 } },
    audio: false,
  });

  cameraVideo.srcObject = stream;
  await cameraVideo.play();

  showCamera();
}

function startPoseLoopOn(videoEl, modeLabel) {
  stopRaf();
  setState(modeLabel);

  const loop = async () => {
    if (state !== modeLabel) return;
    resizeCanvasFrom(videoEl);
    await pose.send({ image: videoEl });
    rafId = requestAnimationFrame(loop);
  };

  rafId = requestAnimationFrame(loop);
}

function updateScrubUi() {
  const dur = Number.isFinite(playbackVideo.duration) ? playbackVideo.duration : 0;
  playbackDur.textContent = dur.toFixed(2);
  playbackTime.textContent = (playbackVideo.currentTime || 0).toFixed(2);
  scrub.value = dur > 0 ? Math.round((playbackVideo.currentTime / dur) * 1000) : 0;
}

function scrubToValue(v) {
  const dur = Number.isFinite(playbackVideo.duration) ? playbackVideo.duration : 0;
  if (!dur) return;
  const t = (Number(v) / 1000) * dur;
  playbackVideo.currentTime = Math.max(0, Math.min(dur, t));
  updateScrubUi();
}

function pickMimeType() {
  const types = [
    "video/webm;codecs=vp9",
    "video/webm;codecs=vp8",
    "video/webm",
  ];
  for (const t of types) {
    if (window.MediaRecorder && MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(t)) return t;
  }
  return "";
}

async function liveToggle() {
  if (state === "live") {
    await stopEverything();
    liveToggleBtn.textContent = "Start";
    setState("idle");
    return;
  }

  try {
    await stopEverything();
    resetSession();

    await startCameraPreview();
    startPoseLoopOn(cameraVideo, "live");

    liveToggleBtn.textContent = "Stop";
  } catch (e) {
    await stopEverything();
    liveToggleBtn.textContent = "Start";
    setState(`error: ${e && e.message ? e.message : String(e)}`);
  }
}

async function enterRecordedMode() {
  await stopEverything();
  resetSession();

  recordToggleBtn.textContent = "Record";
  recordToggleBtn.classList.add("btnPrimary");
  recordToggleBtn.classList.remove("btnDanger");
  newClipBtn.disabled = true;

  playbackControls.style.display = "none";

  try {
    await startCameraPreview();
    startPoseLoopOn(cameraVideo, "preview");
  } catch (e) {
    await stopEverything();
    setState(`error: ${e && e.message ? e.message : String(e)}`);
  }
}

async function startRecording() {
  if (!stream) throw new Error("No preview stream.");

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

    stopRaf();

    if (cameraVideo.srcObject) {
      try { cameraVideo.pause(); } catch {}
      stopStreamTracks(cameraVideo.srcObject);
      cameraVideo.srcObject = null;
    }
    if (stream) {
      stopStreamTracks(stream);
      stream = null;
    }

    playbackVideo.src = recordedBlobUrl;
    playbackVideo.controls = true;

    showPlayback();
    playbackControls.style.display = "flex";

    await playbackVideo.play().catch(() => {});
    updateScrubUi();

    newClipBtn.disabled = false;

    ensurePose();
    startPoseLoopOn(playbackVideo, "analyzing");
  };

  mediaRecorder.start(200);
  recordToggleBtn.textContent = "Stop";
  recordToggleBtn.classList.remove("btnPrimary");
  recordToggleBtn.classList.add("btnDanger");
  setState("recording");
}

async function stopRecording() {
  if (!mediaRecorder) return;
  if (mediaRecorder.state !== "inactive") mediaRecorder.stop();
  setState("processing...");
}

async function recordToggle() {
  try {
    if (state === "recording") {
      await stopRecording();
      return;
    }

    if (state === "analyzing") {
      await enterRecordedMode();
      return;
    }

    if (state === "preview") {
      await startRecording();
      return;
    }

    if (state === "idle" || state.startsWith("error")) {
      await enterRecordedMode();
      return;
    }
  } catch (e) {
    setState(`error: ${e && e.message ? e.message : String(e)}`);
  }
}

async function newClip() {
  if (recordedBlobUrl) {
    try { URL.revokeObjectURL(recordedBlobUrl); } catch {}
    recordedBlobUrl = null;
  }
  await enterRecordedMode();
}

function setUiForMode(mode) {
  currentMode = mode;
  modeBadge.textContent = mode === "live" ? "Live" : "Record + Review";

  if (mode === "live") {
    liveControls.style.display = "";
    recordControls.style.display = "none";
    playbackControls.style.display = "none";
    showCamera();
    liveToggleBtn.textContent = "Start";
    setState("idle");
  } else {
    liveControls.style.display = "none";
    recordControls.style.display = "";
    showCamera();
    setState("idle");
  }

  resetSession();
}

function setExercise(ex) {
  currentExercise = ex;
  exerciseBadge.textContent = ex === "bench" ? "Bench" : ex === "deadlift" ? "Deadlift" : "Squat";
  resetSession();
}

exerciseSelect.addEventListener("change", () => setExercise(exerciseSelect.value));

modeSelect.addEventListener("change", async () => {
  await stopEverything();
  setUiForMode(modeSelect.value);
  if (modeSelect.value === "recorded") {
    await enterRecordedMode();
  }
});

liveToggleBtn.addEventListener("click", liveToggle);
recordToggleBtn.addEventListener("click", recordToggle);
newClipBtn.addEventListener("click", newClip);

scrub.addEventListener("input", (e) => scrubToValue(e.target.value));
playbackVideo.addEventListener("timeupdate", () => updateScrubUi());
playbackVideo.addEventListener("loadedmetadata", () => updateScrubUi());

setExercise(exerciseSelect.value);
setUiForMode(modeSelect.value);
setState("idle");
resetSession();
