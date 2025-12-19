const video = document.getElementById("video");
const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d");

const startBtn = document.getElementById("startBtn");
const stopBtn = document.getElementById("stopBtn");
const mirrorToggle = document.getElementById("mirrorToggle");

const stateText = document.getElementById("stateText");

let camera = null;
let pose = null;
let running = false;

function resizeCanvas() {
  if (!video.videoWidth) return;
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
  stateText.textContent = results.poseLandmarks ? "tracking" : "no pose";
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

async function start() {
  if (running) return;
  running = true;

  stateText.textContent = "starting...";
  pose = makePose();

  camera = new Camera.Camera(video, {
    onFrame: async () => {
      await pose.send({ image: video });
    },
    width: 1280,
    height: 720,
  });

  await camera.start();

  startBtn.disabled = true;
  stopBtn.disabled = false;
}

async function stop() {
  running = false;
  stateText.textContent = "stopped";

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
