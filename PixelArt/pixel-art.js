/* ── Pixel Art Converter ─────────────────────────────────────────────
   Change this value to set the pixel art grid resolution (NxN).
   For example, 14 means the output will be a 14×14 pixel grid.       */
const PIXEL_GRID_SIZE = 14;

/* ── Colour palette ───────────────────────────────────────────────── */
const PALETTE = [
  { name: "Brown", hex: "#ab7863", r: 171, g: 120, b: 99 },
  { name: "Gold", hex: "#FFD700", r: 255, g: 215, b: 0 },
  { name: "Green", hex: "#537954", r: 83, g: 121, b: 84 },
  { name: "Grey", hex: "#8b9596", r: 139, g: 149, b: 150 },
  { name: "Iridescent green", hex: "#8db5b5", r: 141, g: 181, b: 181 },
  { name: "Iridescent purple", hex: "#c86cab", r: 200, g: 108, b: 171 },
  { name: "Light blue", hex: "#62b3c4", r: 98, g: 179, b: 196 },
  { name: "White", hex: "#ced4d0", r: 206, g: 212, b: 208 },
  { name: "Light green", hex: "#699f6d", r: 105, g: 159, b: 109 },
  { name: "Navy blue", hex: "#141f57", r: 20, g: 31, b: 87 },
  { name: "Orange", hex: "#f08e21", r: 240, g: 142, b: 33 },
  { name: "Pink", hex: "#f7e1d6", r: 247, g: 225, b: 214 },
  { name: "Purple", hex: "#d7a1c1", r: 215, g: 161, b: 193 },
  { name: "Red", hex: "#ee3847", r: 238, g: 56, b: 71 },
  { name: "Yellow", hex: "#ffec94", r: 255, g: 236, b: 148 },
  { name: "Silver", hex: "#C0C0C0", r: 255, g: 236, b: 148 },
];

const ERASER_COLOR = { name: "Eraser", hex: "#1b1f22", r: 27, g: 31, b: 34 };

function nearestPaletteColor(r, g, b) {
  let best = PALETTE[0], bestDist = Infinity;
  for (const c of PALETTE) {
    const dr = r - c.r, dg = g - c.g, db = b - c.b;
    const d = dr * dr + dg * dg + db * db;
    if (d < bestDist) { bestDist = d; best = c; }
  }
  return best;
}

function quantize(canvas) {
  const ctx = canvas.getContext("2d");
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const c = nearestPaletteColor(d[i], d[i + 1], d[i + 2]);
    d[i] = c.r; d[i + 1] = c.g; d[i + 2] = c.b;
  }
  ctx.putImageData(img, 0, 0);
}

/* ── DOM refs ─────────────────────────────────────────────────────── */
const dropZone = document.getElementById("dropZone");
const fileInput = document.getElementById("fileInput");
const cropCanvas = document.getElementById("cropCanvas");
const resultCanvas = document.getElementById("resultCanvas");
const drawCanvas = document.getElementById("drawCanvas");
const paletteBar = document.getElementById("paletteBar");

const stepChoice = document.getElementById("step-choice");
const stepUpload = document.getElementById("step-upload");
const stepCrop = document.getElementById("step-crop");
const stepDraw = document.getElementById("step-draw");
const stepResult = document.getElementById("step-result");

const btnModeUpload = document.getElementById("btnModeUpload");
const btnModeDraw = document.getElementById("btnModeDraw");
const btnReUpload = document.getElementById("btnReUpload");
const btnCrop = document.getElementById("btnCrop");
const btnDrawClear = document.getElementById("btnDrawClear");
const btnDrawDone = document.getElementById("btnDrawDone");
const btnDownload = document.getElementById("btnDownload");
const btnStartOver = document.getElementById("btnStartOver");

const cropCtx = cropCanvas.getContext("2d");
const resultCtx = resultCanvas.getContext("2d");
const drawCtx = drawCanvas.getContext("2d");

const ALL_STEPS = [stepChoice, stepUpload, stepCrop, stepDraw, stepResult];

/* ── State ────────────────────────────────────────────────────────── */
let sourceImg = null;
let crop = { x: 0, y: 0, size: 0 };
let dragState = null;
let imgScale = 1;
let currentMode = null;          // "upload" | "draw"
let selectedPaletteIdx = 0;
let drawGrid = [];               // 2D array [row][col] of palette indices (-1 = empty)
let drawCellSize = 0;
let isDrawing = false;
let drawButton = 0;              // 0 = left (paint), 2 = right (erase)

const HANDLE_RADIUS = 10;

/* ── Helpers ──────────────────────────────────────────────────────── */
function showStep(step) {
  ALL_STEPS.forEach(s => s.style.display = "none");
  step.style.display = "";
}

function goHome() {
  fileInput.value = "";
  sourceImg = null;
  currentMode = null;
  showStep(stepChoice);
}

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

/* ── Mode choice ──────────────────────────────────────────────────── */
btnModeUpload.addEventListener("click", () => {
  currentMode = "upload";
  showStep(stepUpload);
});

btnModeDraw.addEventListener("click", () => {
  currentMode = "draw";
  showStep(stepDraw);
  initDrawGrid();
});

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
  handleFile(e.dataTransfer.files[0]);
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
  cropCanvas.style.width = dispW + "px";
  cropCanvas.style.height = dispH + "px";

  imgScale = 1 / scale;

  const minDim = Math.min(dispW, dispH);
  const initSize = Math.round(minDim * 0.7);
  crop.size = initSize;
  crop.x = Math.round((dispW - initSize) / 2);
  crop.y = Math.round((dispH - initSize) / 2);

  drawCropOverlay();
}

function drawCropOverlay() {
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

  cropCtx.fillStyle = "#6b9bd1";
  for (const c of getCorners()) {
    cropCtx.beginPath();
    cropCtx.arc(c.x, c.y, HANDLE_RADIUS, 0, Math.PI * 2);
    cropCtx.fill();
  }
}

function getCorners() {
  return [
    { x: crop.x, y: crop.y, id: "tl" },
    { x: crop.x + crop.size, y: crop.y, id: "tr" },
    { x: crop.x, y: crop.y + crop.size, id: "bl" },
    { x: crop.x + crop.size, y: crop.y + crop.size, id: "br" },
  ];
}

function getCropPointer(e) {
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

function onCropDown(e) {
  e.preventDefault();
  const p = getCropPointer(e);
  const hit = hitTest(p.x, p.y);
  if (!hit) return;
  dragState = { type: hit, startX: p.x, startY: p.y, origCrop: { ...crop } };
}

function onCropMove(e) {
  if (!dragState) {
    const p = getCropPointer(e);
    const hit = hitTest(p.x, p.y);
    cropCanvas.style.cursor = hit ? (hit === "move" ? "grab" : "nwse-resize") : "default";
    return;
  }
  e.preventDefault();
  const p = getCropPointer(e);
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
    const delta = (Math.abs(dx) > Math.abs(dy)) ? dx : dy;
    if (dragState.type === "br") {
      crop.size = clamp(o.size + delta, MIN_SIZE, Math.min(W - o.x, H - o.y));
    } else if (dragState.type === "tl") {
      const ns = clamp(o.size - delta, MIN_SIZE, Math.min(o.x + o.size, o.y + o.size));
      crop.size = ns; crop.x = o.x + o.size - ns; crop.y = o.y + o.size - ns;
    } else if (dragState.type === "tr") {
      const d2 = (Math.abs(dx) > Math.abs(dy)) ? dx : -dy;
      const ns = clamp(o.size + d2, MIN_SIZE, Math.min(W - o.x, o.y + o.size));
      crop.size = ns; crop.y = o.y + o.size - ns;
    } else if (dragState.type === "bl") {
      const d2 = (Math.abs(dx) > Math.abs(dy)) ? -dx : dy;
      const ns = clamp(o.size + d2, MIN_SIZE, Math.min(o.x + o.size, H - o.y));
      crop.size = ns; crop.x = o.x + o.size - ns;
    }
  }
  drawCropOverlay();
}

function onCropUp() { dragState = null; }

cropCanvas.addEventListener("mousedown", onCropDown);
window.addEventListener("mousemove", onCropMove);
window.addEventListener("mouseup", onCropUp);
cropCanvas.addEventListener("touchstart", onCropDown, { passive: false });
window.addEventListener("touchmove", onCropMove, { passive: false });
window.addEventListener("touchend", onCropUp);

/* ── Draw mode ────────────────────────────────────────────────────── */
function buildPaletteUI() {
  paletteBar.innerHTML = "";
  PALETTE.forEach((c, i) => {
    const sw = document.createElement("div");
    sw.className = "palette-swatch" + (i === selectedPaletteIdx ? " active" : "");
    sw.style.background = c.hex;
    sw.title = c.name;
    sw.addEventListener("click", () => {
      selectedPaletteIdx = i;
      paletteBar.querySelectorAll(".palette-swatch").forEach((el, j) => {
        el.classList.toggle("active", j === i);
      });
    });
    paletteBar.appendChild(sw);
  });
}
buildPaletteUI();

function initDrawGrid() {
  drawGrid = [];
  for (let r = 0; r < PIXEL_GRID_SIZE; r++) {
    drawGrid[r] = [];
    for (let c = 0; c < PIXEL_GRID_SIZE; c++) {
      drawGrid[r][c] = -1;
    }
  }
  requestAnimationFrame(() => {
    sizeDrawCanvas();
    renderDrawGrid();
  });
}

if (typeof ResizeObserver !== "undefined") {
  const wrap = document.querySelector(".draw-grid-wrap");
  if (wrap) {
    const ro = new ResizeObserver(() => {
      if (currentMode === "draw" && drawGrid.length) {
        sizeDrawCanvas();
        renderDrawGrid();
      }
    });
    ro.observe(wrap);
  }
}

function sizeDrawCanvas() {
  const container = drawCanvas.parentElement;
  const avail = container.clientWidth - 24;
  const maxPx = Math.min(Math.max(avail, 280), 560);
  drawCellSize = Math.floor(maxPx / PIXEL_GRID_SIZE);
  if (drawCellSize < 1) drawCellSize = 1;
  const total = drawCellSize * PIXEL_GRID_SIZE;
  drawCanvas.width = total;
  drawCanvas.height = total;
  drawCanvas.style.width = total + "px";
  drawCanvas.style.height = total + "px";
}

function renderDrawGrid() {
  const N = PIXEL_GRID_SIZE;
  const cs = drawCellSize;
  drawCtx.clearRect(0, 0, drawCanvas.width, drawCanvas.height);

  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) {
      const idx = drawGrid[r][c];
      drawCtx.fillStyle = idx >= 0 ? PALETTE[idx].hex : ERASER_COLOR.hex;
      drawCtx.fillRect(c * cs, r * cs, cs, cs);
    }
  }

  drawCtx.strokeStyle = "rgba(255,255,255,0.08)";
  drawCtx.lineWidth = 1;
  const edge = N * cs;
  for (let i = 0; i <= N; i++) {
    const pos = i < N ? i * cs + 0.5 : edge - 0.5;
    drawCtx.beginPath();
    drawCtx.moveTo(pos, 0);
    drawCtx.lineTo(pos, edge);
    drawCtx.stroke();
    drawCtx.beginPath();
    drawCtx.moveTo(0, pos);
    drawCtx.lineTo(edge, pos);
    drawCtx.stroke();
  }
}

function getDrawCell(e) {
  const rect = drawCanvas.getBoundingClientRect();
  const touch = e.touches ? e.touches[0] : e;
  const x = touch.clientX - rect.left;
  const y = touch.clientY - rect.top;
  const scaleX = drawCanvas.width / rect.width;
  const scaleY = drawCanvas.height / rect.height;
  const col = Math.floor((x * scaleX) / drawCellSize);
  const row = Math.floor((y * scaleY) / drawCellSize);
  if (row < 0 || row >= PIXEL_GRID_SIZE || col < 0 || col >= PIXEL_GRID_SIZE) return null;
  return { row, col };
}

function paintCell(cell, button) {
  if (!cell) return;
  drawGrid[cell.row][cell.col] = (button === 2) ? -1 : selectedPaletteIdx;
  renderDrawGrid();
}

drawCanvas.addEventListener("mousedown", (e) => {
  e.preventDefault();
  isDrawing = true;
  drawButton = e.button;
  paintCell(getDrawCell(e), drawButton);
});
window.addEventListener("mousemove", (e) => {
  if (!isDrawing) return;
  paintCell(getDrawCell(e), drawButton);
});
window.addEventListener("mouseup", () => { isDrawing = false; });
drawCanvas.addEventListener("contextmenu", (e) => e.preventDefault());

let longPressTimer = null;
let touchIsErasing = false;

drawCanvas.addEventListener("touchstart", (e) => {
  e.preventDefault();
  isDrawing = true;
  touchIsErasing = false;
  const cell = getDrawCell(e);
  longPressTimer = setTimeout(() => { touchIsErasing = true; paintCell(cell, 2); }, 300);
  paintCell(cell, 0);
}, { passive: false });

drawCanvas.addEventListener("touchmove", (e) => {
  e.preventDefault();
  clearTimeout(longPressTimer);
  if (!isDrawing) return;
  paintCell(getDrawCell(e), touchIsErasing ? 2 : 0);
}, { passive: false });

window.addEventListener("touchend", () => {
  isDrawing = false;
  clearTimeout(longPressTimer);
  touchIsErasing = false;
});

/* ── Pixelation (from image) ──────────────────────────────────────── */
function buildTinyFromImage() {
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
  quantize(tiny);
  return tiny;
}

/* ── Pixelation (from draw grid) ──────────────────────────────────── */
function buildTinyFromGrid() {
  const tiny = document.createElement("canvas");
  tiny.width = PIXEL_GRID_SIZE;
  tiny.height = PIXEL_GRID_SIZE;
  const tctx = tiny.getContext("2d");
  const img = tctx.createImageData(PIXEL_GRID_SIZE, PIXEL_GRID_SIZE);
  const d = img.data;
  for (let r = 0; r < PIXEL_GRID_SIZE; r++) {
    for (let c = 0; c < PIXEL_GRID_SIZE; c++) {
      const idx = drawGrid[r][c];
      const color = idx >= 0 ? PALETTE[idx] : ERASER_COLOR;
      const off = (r * PIXEL_GRID_SIZE + c) * 4;
      d[off] = color.r; d[off + 1] = color.g; d[off + 2] = color.b; d[off + 3] = 255;
    }
  }
  tctx.putImageData(img, 0, 0);
  return tiny;
}

function buildTiny() {
  return currentMode === "draw" ? buildTinyFromGrid() : buildTinyFromImage();
}

/* ── Show result ──────────────────────────────────────────────────── */
function showResult() {
  const tiny = buildTiny();
  const displaySize = Math.min(560, window.innerWidth - 80);
  resultCanvas.width = displaySize;
  resultCanvas.height = displaySize;
  resultCtx.imageSmoothingEnabled = false;
  resultCtx.drawImage(tiny, 0, 0, displaySize, displaySize);
  showStep(stepResult);
}

/* ── Download ─────────────────────────────────────────────────────── */
function downloadPNG() {
  const tiny = buildTiny();
  const exportSize = PIXEL_GRID_SIZE * 40;
  const exportCanvas = document.createElement("canvas");
  exportCanvas.width = exportSize;
  exportCanvas.height = exportSize;
  const ectx = exportCanvas.getContext("2d");
  ectx.imageSmoothingEnabled = false;
  ectx.drawImage(tiny, 0, 0, exportSize, exportSize);

  const link = document.createElement("a");
  link.download = `pixel-art-${PIXEL_GRID_SIZE}x${PIXEL_GRID_SIZE}.png`;
  link.href = exportCanvas.toDataURL("image/png");
  link.click();
}

/* ── Button handlers ──────────────────────────────────────────────── */
btnCrop.addEventListener("click", showResult);
btnDrawDone.addEventListener("click", showResult);
btnDownload.addEventListener("click", downloadPNG);

btnDrawClear.addEventListener("click", () => {
  initDrawGrid();
});

btnReUpload.addEventListener("click", () => {
  fileInput.value = "";
  sourceImg = null;
  showStep(stepUpload);
});

btnStartOver.addEventListener("click", goHome);

document.getElementById("backToStart").addEventListener("click", (e) => {
  e.preventDefault();
  goHome();
});
