/* ── Pixel Art Converter ─────────────────────────────────────────────
   Change this value to set the pixel art grid resolution (NxN).
   For example, 14 means the output will be a 14×14 pixel grid.       */
const PIXEL_GRID_SIZE = 14;

/* ── DOM refs ─────────────────────────────────────────────────────── */
const dropZone      = document.getElementById("dropZone");
const fileInput     = document.getElementById("fileInput");
const cropCanvas    = document.getElementById("cropCanvas");
const resultCanvas  = document.getElementById("resultCanvas");
const stepUpload    = document.getElementById("step-upload");
const stepCrop      = document.getElementById("step-crop");
const stepResult    = document.getElementById("step-result");
const btnReUpload   = document.getElementById("btnReUpload");
const btnCrop       = document.getElementById("btnCrop");
const btnDownload   = document.getElementById("btnDownload");
const btnStartOver  = document.getElementById("btnStartOver");

const cropCtx   = cropCanvas.getContext("2d");
const resultCtx = resultCanvas.getContext("2d");

/* ── State ────────────────────────────────────────────────────────── */
let sourceImg = null;
let crop = { x: 0, y: 0, size: 0 };
let dragState = null;   // null | { type, startX, startY, origCrop }
let imgScale = 1;       // ratio: canvas CSS pixels → source image pixels

const HANDLE_RADIUS = 10;

/* ── Helpers ──────────────────────────────────────────────────────── */
function showStep(step) {
  [stepUpload, stepCrop, stepResult].forEach(s => s.style.display = "none");
  step.style.display = "";
}

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

/* ── File loading ─────────────────────────────────────────────────── */
function handleFile(file) {
  if (!file || !file.type.startsWith("image/")) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    const img = new Image();
    img.onload = () => {
      sourceImg = img;
      showStep(stepCrop);
      initCrop();
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}

dropZone.addEventListener("click", () => fileInput.click());
fileInput.addEventListener("change", () => { if (fileInput.files[0]) handleFile(fileInput.files[0]); });

dropZone.addEventListener("dragover", (e) => { e.preventDefault(); dropZone.classList.add("dragover"); });
dropZone.addEventListener("dragleave", () => dropZone.classList.remove("dragover"));
dropZone.addEventListener("drop", (e) => {
  e.preventDefault();
  dropZone.classList.remove("dragover");
  const file = e.dataTransfer.files[0];
  handleFile(file);
});

/* ── Crop canvas ──────────────────────────────────────────────────── */
function initCrop() {
  const maxW = cropCanvas.parentElement.clientWidth;
  const maxH = window.innerHeight * 0.6;
  const scale = Math.min(maxW / sourceImg.width, maxH / sourceImg.height, 1);

  const dispW = Math.round(sourceImg.width * scale);
  const dispH = Math.round(sourceImg.height * scale);

  cropCanvas.width = dispW;
  cropCanvas.height = dispH;
  cropCanvas.style.width  = dispW + "px";
  cropCanvas.style.height = dispH + "px";

  imgScale = 1 / scale;

  const minDim = Math.min(dispW, dispH);
  const initSize = Math.round(minDim * 0.7);
  crop.size = initSize;
  crop.x = Math.round((dispW - initSize) / 2);
  crop.y = Math.round((dispH - initSize) / 2);

  drawCrop();
}

function drawCrop() {
  const w = cropCanvas.width;
  const h = cropCanvas.height;
  cropCtx.clearRect(0, 0, w, h);

  cropCtx.drawImage(sourceImg, 0, 0, w, h);

  cropCtx.fillStyle = "rgba(0, 0, 0, 0.55)";
  cropCtx.fillRect(0, 0, w, crop.y);
  cropCtx.fillRect(0, crop.y + crop.size, w, h - crop.y - crop.size);
  cropCtx.fillRect(0, crop.y, crop.x, crop.size);
  cropCtx.fillRect(crop.x + crop.size, crop.y, w - crop.x - crop.size, crop.size);

  cropCtx.strokeStyle = "#6b9bd1";
  cropCtx.lineWidth = 2;
  cropCtx.strokeRect(crop.x, crop.y, crop.size, crop.size);

  const thirds = crop.size / 3;
  cropCtx.strokeStyle = "rgba(107, 155, 209, 0.3)";
  cropCtx.lineWidth = 1;
  for (let i = 1; i <= 2; i++) {
    cropCtx.beginPath();
    cropCtx.moveTo(crop.x + thirds * i, crop.y);
    cropCtx.lineTo(crop.x + thirds * i, crop.y + crop.size);
    cropCtx.stroke();
    cropCtx.beginPath();
    cropCtx.moveTo(crop.x, crop.y + thirds * i);
    cropCtx.lineTo(crop.x + crop.size, crop.y + thirds * i);
    cropCtx.stroke();
  }

  const corners = getCorners();
  cropCtx.fillStyle = "#6b9bd1";
  for (const c of corners) {
    cropCtx.beginPath();
    cropCtx.arc(c.x, c.y, HANDLE_RADIUS, 0, Math.PI * 2);
    cropCtx.fill();
  }
}

function getCorners() {
  return [
    { x: crop.x,             y: crop.y,             id: "tl" },
    { x: crop.x + crop.size, y: crop.y,             id: "tr" },
    { x: crop.x,             y: crop.y + crop.size, id: "bl" },
    { x: crop.x + crop.size, y: crop.y + crop.size, id: "br" },
  ];
}

function getPointer(e) {
  const rect = cropCanvas.getBoundingClientRect();
  const touch = e.touches ? e.touches[0] : e;
  const scaleX = cropCanvas.width / rect.width;
  const scaleY = cropCanvas.height / rect.height;
  return {
    x: (touch.clientX - rect.left) * scaleX,
    y: (touch.clientY - rect.top) * scaleY,
  };
}

function hitTest(px, py) {
  for (const c of getCorners()) {
    if (Math.hypot(px - c.x, py - c.y) <= HANDLE_RADIUS + 4) return c.id;
  }
  if (px >= crop.x && px <= crop.x + crop.size &&
      py >= crop.y && py <= crop.y + crop.size) return "move";
  return null;
}

function onPointerDown(e) {
  e.preventDefault();
  const p = getPointer(e);
  const hit = hitTest(p.x, p.y);
  if (!hit) return;
  dragState = {
    type: hit,
    startX: p.x,
    startY: p.y,
    origCrop: { ...crop },
  };
}

function onPointerMove(e) {
  if (!dragState) {
    const p = getPointer(e);
    const hit = hitTest(p.x, p.y);
    cropCanvas.style.cursor = hit
      ? (hit === "move" ? "grab" : "nwse-resize")
      : "default";
    return;
  }
  e.preventDefault();
  const p = getPointer(e);
  const dx = p.x - dragState.startX;
  const dy = p.y - dragState.startY;
  const o = dragState.origCrop;
  const W = cropCanvas.width;
  const H = cropCanvas.height;
  const MIN_SIZE = 20;

  if (dragState.type === "move") {
    crop.x = clamp(o.x + dx, 0, W - o.size);
    crop.y = clamp(o.y + dy, 0, H - o.size);
  } else {
    let newSize, newX, newY;
    const delta = (Math.abs(dx) > Math.abs(dy)) ? dx : dy;

    if (dragState.type === "br") {
      newSize = clamp(o.size + delta, MIN_SIZE, Math.min(W - o.x, H - o.y));
      crop.size = newSize;
    } else if (dragState.type === "tl") {
      newSize = clamp(o.size - delta, MIN_SIZE, Math.min(o.x + o.size, o.y + o.size));
      crop.size = newSize;
      crop.x = o.x + o.size - newSize;
      crop.y = o.y + o.size - newSize;
    } else if (dragState.type === "tr") {
      const dUse = (Math.abs(dx) > Math.abs(dy)) ? dx : -dy;
      newSize = clamp(o.size + dUse, MIN_SIZE, Math.min(W - o.x, o.y + o.size));
      crop.size = newSize;
      crop.y = o.y + o.size - newSize;
    } else if (dragState.type === "bl") {
      const dUse = (Math.abs(dx) > Math.abs(dy)) ? -dx : dy;
      newSize = clamp(o.size + dUse, MIN_SIZE, Math.min(o.x + o.size, H - o.y));
      crop.size = newSize;
      crop.x = o.x + o.size - newSize;
    }
  }
  drawCrop();
}

function onPointerUp() {
  dragState = null;
}

cropCanvas.addEventListener("mousedown", onPointerDown);
window.addEventListener("mousemove", onPointerMove);
window.addEventListener("mouseup", onPointerUp);
cropCanvas.addEventListener("touchstart", onPointerDown, { passive: false });
window.addEventListener("touchmove", onPointerMove, { passive: false });
window.addEventListener("touchend", onPointerUp);

/* ── Pixelation ───────────────────────────────────────────────────── */
function generatePixelArt() {
  const sx = Math.round(crop.x * imgScale);
  const sy = Math.round(crop.y * imgScale);
  const sSize = Math.round(crop.size * imgScale);

  const tiny = document.createElement("canvas");
  tiny.width = PIXEL_GRID_SIZE;
  tiny.height = PIXEL_GRID_SIZE;
  const tctx = tiny.getContext("2d");
  tctx.imageSmoothingEnabled = true;
  tctx.imageSmoothingQuality = "medium";
  tctx.drawImage(sourceImg, sx, sy, sSize, sSize, 0, 0, PIXEL_GRID_SIZE, PIXEL_GRID_SIZE);

  const displaySize = Math.min(560, window.innerWidth - 80);
  resultCanvas.width = displaySize;
  resultCanvas.height = displaySize;
  resultCtx.imageSmoothingEnabled = false;
  resultCtx.drawImage(tiny, 0, 0, displaySize, displaySize);

  showStep(stepResult);
}

/* ── Download ─────────────────────────────────────────────────────── */
function downloadPNG() {
  const exportSize = PIXEL_GRID_SIZE * 40;
  const exportCanvas = document.createElement("canvas");
  exportCanvas.width = exportSize;
  exportCanvas.height = exportSize;
  const ectx = exportCanvas.getContext("2d");
  ectx.imageSmoothingEnabled = false;

  const tiny = document.createElement("canvas");
  tiny.width = PIXEL_GRID_SIZE;
  tiny.height = PIXEL_GRID_SIZE;
  const tctx = tiny.getContext("2d");
  tctx.imageSmoothingEnabled = true;
  tctx.imageSmoothingQuality = "medium";
  const sx = Math.round(crop.x * imgScale);
  const sy = Math.round(crop.y * imgScale);
  const sSize = Math.round(crop.size * imgScale);
  tctx.drawImage(sourceImg, sx, sy, sSize, sSize, 0, 0, PIXEL_GRID_SIZE, PIXEL_GRID_SIZE);

  ectx.drawImage(tiny, 0, 0, exportSize, exportSize);

  const link = document.createElement("a");
  link.download = `pixel-art-${PIXEL_GRID_SIZE}x${PIXEL_GRID_SIZE}.png`;
  link.href = exportCanvas.toDataURL("image/png");
  link.click();
}

/* ── Button handlers ──────────────────────────────────────────────── */
btnCrop.addEventListener("click", generatePixelArt);
btnDownload.addEventListener("click", downloadPNG);

btnReUpload.addEventListener("click", () => {
  fileInput.value = "";
  sourceImg = null;
  showStep(stepUpload);
});

btnStartOver.addEventListener("click", () => {
  fileInput.value = "";
  sourceImg = null;
  showStep(stepUpload);
});
