const video = document.getElementById("video");
const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d");

const startBtn = document.getElementById("startBtn");
const stopBtn = document.getElementById("stopBtn");
const mirrorToggle = document.getElementById("mirrorToggle");

const stateText = document.getElementById("stateText");
const repCountText = document.getElementById("repCount");
const lastVerdictText = document.getElementById("verdict");

let pose = null;
let cameraHelper = null;
let stream = null;
let running = false;

function setState(s) {
  stateText.textContent = s;
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
  if (!running) return;
  draw(results);
  setState(results.poseLandmarks ? "tracking" : "no pose");
}

function makePose() {
  const p = new Pose.Pose({
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

async function startWithGetUserMedia() {
  stream = await navigator.mediaDevices.getUserMedia({
    video: { width: { ideal: 1280 }, height: { ideal: 720 } },
    audio: false,
  });

  video.srcObject = stream;

  await new Promise((resolve) => {
    video.onloadedmetadata = () => resolve();
  });

  await video.play();

  const tick = async () => {
    if (!running) return;
    await pose.send({ image: video });
    requestAnimationFrame(tick);
  };

  requestAnimationFrame(tick);
}

async function startWithMediaPipeCameraHelper() {
  cameraHelper = new Camera.Camera(video, {
    onFrame: async () => {
      await pose.send({ image: video });
    },
    width: 1280,
    height: 720,
  });

  await cameraHelper.start();
}

async function start() {
  if (running) return;

  setState("starting...");
  lastVerdictText.textContent = "—";

  try {
    if (!window.isSecureContext) {
      throw new Error("Not a secure context. Use HTTPS or http://localhost.");
    }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new Error("getUserMedia not available in this browser/context.");
    }

    pose = makePose();
    running = true;

    if (typeof Camera !== "undefined" && Camera.Camera) {
      await startWithMediaPipeCameraHelper();
    } else {
      await startWithGetUserMedia();
    }

    startBtn.disabled = true;
    stopBtn.disabled = false;
    setState("tracking");
  } catch (e) {
    running = false;
    setState(`error: ${e && e.message ? e.message : String(e)}`);
    startBtn.disabled = false;
    stopBtn.disabled = true;

    if (pose) {
      try { pose.close(); } catch {}
      pose = null;
    }
  }
}

async function stop() {
  running = false;
  setState("stopped");

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

  if (pose) {
    try { pose.close(); } catch {}
    pose = null;
  }

  startBtn.disabled = false;
  stopBtn.disabled = true;
}

startBtn.addEventListener("click", start);
stopBtn.addEventListener("click", stop);

repCountText.textContent = "0";
setState("idle");
