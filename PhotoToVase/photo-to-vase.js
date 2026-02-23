(function () {
  'use strict';

  const video = document.getElementById('video');
  const captureCanvas = document.getElementById('captureCanvas');
  const outlineCanvas = document.getElementById('outlineCanvas');
  const btnStartCamera = document.getElementById('btnStartCamera');
  const btnCapture = document.getElementById('btnCapture');
  const btnUseOutline = document.getElementById('btnUseOutline');
  const toleranceInput = document.getElementById('tolerance');
  const toleranceValue = document.getElementById('toleranceValue');
  const outlinePreview = document.getElementById('outlinePreview');
  const fileInput = document.getElementById('fileInput');
  const btnModeAdd = document.getElementById('btnModeAdd');
  const btnModeSubtract = document.getElementById('btnModeSubtract');
  const btnClearSelection = document.getElementById('btnClearSelection');
  const btnGoExport = document.getElementById('btnGoExport');
  const startGcodeEl = document.getElementById('startGcode');
  const endGcodeEl = document.getElementById('endGcode');
  const backToStart = document.getElementById('backToStart');
  const exportStatus = document.getElementById('exportStatus');

  let stream = null;
  let capturedImageData = null;
  let processedImageData = null; // downscaled for fast flood fill (max 400px)
  let processedW = 0;
  let processedH = 0;
  let contourPoints = [];
  let selectionMask = null; // Uint8Array, 1 = selected (processed size)
  let selectionMode = 'select'; // 'select' | 'add' | 'subtract'
  const STEPS = ['step-capture', 'step-outline', 'step-specs'];
  const PROCESS_MAX_PX = 400;

  function log(msg) {
    if (exportStatus) {
      exportStatus.textContent = msg;
      exportStatus.style.display = 'block';
    }
  }

  function showStep(stepId) {
    STEPS.forEach(id => {
      const el = document.getElementById(id);
      if (el) el.style.display = id === stepId ? 'block' : 'none';
    });
  }

  // ——— Camera ———
  btnStartCamera.addEventListener('click', async function () {
    try {
      if (stream) {
        stream.getTracks().forEach(t => t.stop());
        stream = null;
        btnStartCamera.textContent = 'Start camera';
        btnCapture.disabled = true;
        return;
      }
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
      video.srcObject = stream;
      btnStartCamera.textContent = 'Stop camera';
      btnCapture.disabled = false;
    } catch (e) {
      log('Camera error: ' + e.message);
      btnCapture.disabled = true;
    }
  });

  btnCapture.addEventListener('click', function () {
    if (!stream || !video.videoWidth) return;
    const w = video.videoWidth;
    const h = video.videoHeight;
    captureCanvas.width = w;
    captureCanvas.height = h;
    const ctx = captureCanvas.getContext('2d');
    ctx.drawImage(video, 0, 0);
    capturedImageData = ctx.getImageData(0, 0, w, h);
    processedImageData = createDownscaledImageData(capturedImageData, PROCESS_MAX_PX);
    processedW = processedImageData.width;
    processedH = processedImageData.height;
    outlineCanvas.width = w;
    outlineCanvas.height = h;
    showStep('step-outline');
    enterOutlineStep();
  });

  fileInput.addEventListener('change', function (e) {
    const file = e.target.files && e.target.files[0];
    if (!file || !file.type.startsWith('image/')) return;
    const img = new Image();
    img.onload = function () {
      const w = img.naturalWidth;
      const h = img.naturalHeight;
      captureCanvas.width = w;
      captureCanvas.height = h;
      const ctx = captureCanvas.getContext('2d');
      ctx.drawImage(img, 0, 0);
      capturedImageData = ctx.getImageData(0, 0, w, h);
      processedImageData = createDownscaledImageData(capturedImageData, PROCESS_MAX_PX);
      processedW = processedImageData.width;
      processedH = processedImageData.height;
      outlineCanvas.width = w;
      outlineCanvas.height = h;
      showStep('step-outline');
      enterOutlineStep();
    };
    img.src = URL.createObjectURL(file);
    e.target.value = '';
  });

  function createDownscaledImageData(sourceImageData, maxDim) {
    const sw = sourceImageData.width;
    const sh = sourceImageData.height;
    const scale = maxDim / Math.max(sw, sh);
    if (scale >= 1) return sourceImageData;
    const w = Math.max(1, Math.round(sw * scale));
    const h = Math.max(1, Math.round(sh * scale));
    const canvas = document.createElement('canvas');
    canvas.width = sw;
    canvas.height = sh;
    const ctx = canvas.getContext('2d');
    const imgData = ctx.createImageData(sw, sh);
    imgData.data.set(sourceImageData.data);
    ctx.putImageData(imgData, 0, 0);
    const small = document.createElement('canvas');
    small.width = w;
    small.height = h;
    const smallCtx = small.getContext('2d');
    smallCtx.drawImage(canvas, 0, 0, sw, sh, 0, 0, w, h);
    return smallCtx.getImageData(0, 0, w, h);
  }

  // ——— Grayscale ———
  function toGrayscale(data) {
    const out = new Uint8Array(data.width * data.height);
    for (let i = 0; i < data.data.length; i += 4) {
      out[i / 4] = (0.299 * data.data[i] + 0.587 * data.data[i + 1] + 0.114 * data.data[i + 2]) | 0;
    }
    return out;
  }

  // Flood fill from (sx,sy) with grayscale tolerance; returns binary mask (1 = filled)
  function floodFillAt(data, w, h, sx, sy, tolerance) {
    const gray = toGrayscale(data);
    const key = (x, y) => y * w + x;
    const ref = gray[key(sx, sy)];
    const out = new Uint8Array(w * h);
    const stack = [[sx, sy]];
    const minV = Math.max(0, ref - tolerance);
    const maxV = Math.min(255, ref + tolerance);
    while (stack.length) {
      const [x, y] = stack.pop();
      const k = key(x, y);
      if (out[k] === 1) continue;
      if (x < 0 || x >= w || y < 0 || y >= h) continue;
      const v = gray[k];
      if (v < minV || v > maxV) continue;
      out[k] = 1;
      stack.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
    }
    return out;
  }

  // Find boundary pixels (selected pixels that have at least one unselected neighbor)
  function getBoundaryPixels(binary, w, h) {
    const set = new Set();
    const key = (x, y) => y * w + x;
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        if (binary[key(x, y)] !== 1) continue;
        const hasBg = (
          binary[key(x - 1, y)] === 0 || binary[key(x + 1, y)] === 0 ||
          binary[key(x, y - 1)] === 0 || binary[key(x, y + 1)] === 0
        );
        if (hasBg) set.add(key(x, y));
      }
    }
    return set;
  }

  // Trace one contour from (startX, startY) on binary mask; returns ordered points
  function traceOneContour(binary, w, h, startX, startY) {
    const key = (x, y) => y * w + x;
    const at = (x, y) => (x >= 0 && x < w && y >= 0 && y < h && binary[key(x, y)] === 1);
    const dirs = [[0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1]];
    const contour = [];
    let cx = startX, cy = startY;
    let d = 0;
    const maxSteps = w * h;
    let steps = 0;
    do {
      contour.push([cx, cy]);
      let found = false;
      for (let i = 0; i < 8; i++) {
        const nd = (d + 6 + i) % 8;
        const nx = cx + dirs[nd][0];
        const ny = cy + dirs[nd][1];
        if (at(nx, ny)) {
          cx = nx;
          cy = ny;
          d = nd;
          found = true;
          break;
        }
      }
      if (!found) break;
      steps++;
    } while ((cx !== startX || cy !== startY) && steps < maxSteps);
    return contour;
  }

  // Get all contours from binary mask; returns array of contours (each is array of [x,y])
  function getAllContours(binary, w, h) {
    const boundary = getBoundaryPixels(binary, w, h);
    const key = (x, y) => y * w + x;
    const contours = [];
    const used = new Set();
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (!boundary.has(key(x, y)) || used.has(key(x, y))) continue;
        const contour = traceOneContour(binary, w, h, x, y);
        contour.forEach(([px, py]) => used.add(key(px, py)));
        if (contour.length >= 3) contours.push(contour);
      }
    }
    return contours;
  }

  // Shoelace area (signed)
  function contourArea(pts) {
    let a = 0;
    const n = pts.length;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      a += pts[i][0] * pts[j][1] - pts[j][0] * pts[i][1];
    }
    return Math.abs(a) / 2;
  }

  // Get largest contour by area from binary mask
  function getLargestContour(binary, w, h) {
    const contours = getAllContours(binary, w, h);
    if (contours.length === 0) return [];
    let best = contours[0];
    let bestArea = contourArea(best);
    for (let i = 1; i < contours.length; i++) {
      const area = contourArea(contours[i]);
      if (area > bestArea) {
        best = contours[i];
        bestArea = area;
      }
    }
    return best;
  }

  // Douglas-Peucker simplification
  function simplifyPoints(pts, tolerance) {
    if (pts.length <= 2) return pts;
    let maxD = 0;
    let maxI = 0;
    const a = pts[0];
    const b = pts[pts.length - 1];
    for (let i = 1; i < pts.length - 1; i++) {
      const d = perpendicularDistance(pts[i], a, b);
      if (d > maxD) {
        maxD = d;
        maxI = i;
      }
    }
    if (maxD < tolerance) return [a, b];
    const left = simplifyPoints(pts.slice(0, maxI + 1), tolerance);
    const right = simplifyPoints(pts.slice(maxI), tolerance);
    return left.slice(0, -1).concat(right);
  }

  function perpendicularDistance(p, a, b) {
    const [px, py] = p;
    const [ax, ay] = a;
    const [bx, by] = b;
    const dx = bx - ax;
    const dy = by - ay;
    const len = Math.hypot(dx, dy) || 1e-6;
    return Math.abs(dy * px - dx * py + bx * ay - by * ax) / len;
  }

  // Normalize contour so image vertical becomes Z (base at 0, top at vase_height), uniform scale.
  // Image: x = horizontal -> X, y = vertical (down) -> base at high y, top at low y.
  // Returns points (x_mm, z_mm) with z_mm in [0, vase_height], x_mm centered at 0.
  function normalizeContourUpright(pts, vaseHeightMm) {
    if (pts.length < 3) return [];
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    pts.forEach(([x, y]) => {
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    });
    const rangeX = maxX - minX || 1;
    const rangeY = maxY - minY || 1;
    const scale = vaseHeightMm / rangeY;
    const cx = (minX + maxX) / 2;
    return pts.map(([x, y]) => [
      (x - cx) * scale,
      (maxY - y) * scale
    ]);
  }

  // Slice polygon (points [x, z]) by horizontal line z = zLayer; return [xMin, xMax] or null.
  function slicePolygonAtZ(poly, zLayer) {
    const xs = [];
    const n = poly.length;
    for (let i = 0; i < n; i++) {
      const a = poly[i];
      const b = poly[(i + 1) % n];
      const z1 = a[1], z2 = b[1];
      if (z1 === z2) {
        if (Math.abs(z1 - zLayer) < 1e-6) {
          xs.push(a[0], b[0]);
        }
        continue;
      }
      const t = (zLayer - z1) / (z2 - z1);
      if (t >= 0 && t <= 1) {
        xs.push(a[0] + t * (b[0] - a[0]));
      }
    }
    if (xs.length === 0) return null;
    return [Math.min.apply(null, xs), Math.max.apply(null, xs)];
  }

  function enterOutlineStep() {
    if (!capturedImageData) return;
    selectionMask = null;
    contourPoints = [];
    selectionMode = 'select';
    if (toleranceValue && toleranceInput) toleranceValue.textContent = toleranceInput.value;
    drawOutlineCanvas();
    updateOutlinePreview();
  }

  function canvasToImageCoords(e) {
    const canvas = outlineCanvas;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const x = Math.floor((e.clientX - rect.left) * scaleX);
    const y = Math.floor((e.clientY - rect.top) * scaleY);
    return [x, y];
  }

  function onOutlineCanvasClick(e) {
    if (!capturedImageData || !processedImageData) return;
    const w = capturedImageData.width;
    const h = capturedImageData.height;
    const [px, py] = canvasToImageCoords(e);
    if (px < 0 || px >= w || py < 0 || py >= h) return;
    const sx = Math.min(processedW - 1, Math.max(0, Math.round(px * processedW / w)));
    const sy = Math.min(processedH - 1, Math.max(0, Math.round(py * processedH / h)));
    const tolerance = parseInt(toleranceInput.value, 10) || 32;
    const filled = floodFillAt(processedImageData, processedW, processedH, sx, sy, tolerance);
    if (!selectionMask) {
      selectionMask = new Uint8Array(processedW * processedH);
      selectionMask.set(filled);
      selectionMode = 'select';
    } else if (selectionMode === 'add') {
      for (let i = 0; i < processedW * processedH; i++) selectionMask[i] = selectionMask[i] || filled[i];
    } else if (selectionMode === 'subtract') {
      for (let i = 0; i < processedW * processedH; i++) if (filled[i]) selectionMask[i] = 0;
    }
    let contour = getLargestContour(selectionMask, processedW, processedH);
    if (contour.length > 10) contour = simplifyPoints(contour, 2);
    contourPoints = contour.map(function (p) {
      return [p[0] * w / processedW, p[1] * h / processedH];
    });
    drawOutlineCanvas();
    updateOutlinePreview();
  }

  function updateOutlinePreview() {
    if (!outlinePreview) return;
    if (!selectionMask || contourPoints.length < 3) {
      outlinePreview.textContent = 'Click on the object to select it. Adjust tolerance if needed.';
      return;
    }
    outlinePreview.textContent = 'Selected. Use Add / Remove to refine, or click "Use this outline" to continue.';
  }

  function drawOutlineCanvas() {
    const ctx = outlineCanvas.getContext('2d');
    const w = outlineCanvas.width;
    const h = outlineCanvas.height;
    ctx.drawImage(captureCanvas, 0, 0);
    if (contourPoints.length >= 3) {
      ctx.beginPath();
      ctx.moveTo(contourPoints[0][0], contourPoints[0][1]);
      for (let i = 1; i < contourPoints.length; i++) {
        ctx.lineTo(contourPoints[i][0], contourPoints[i][1]);
      }
      ctx.closePath();
      ctx.fillStyle = 'rgba(107, 155, 209, 0.35)';
      ctx.fill();
      ctx.strokeStyle = '#e07a7a';
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  }

  if (toleranceInput) {
    toleranceInput.addEventListener('input', function () {
      if (toleranceValue) toleranceValue.textContent = this.value;
    });
  }
  if (btnModeAdd) {
    btnModeAdd.addEventListener('click', function () {
      selectionMode = 'add';
      if (outlinePreview) outlinePreview.textContent = 'Now click on the image to add that area to the selection.';
    });
  }
  if (btnModeSubtract) {
    btnModeSubtract.addEventListener('click', function () {
      selectionMode = 'subtract';
      if (outlinePreview) outlinePreview.textContent = 'Now click on the image to remove that area from the selection.';
    });
  }
  if (btnClearSelection) {
    btnClearSelection.addEventListener('click', function () {
      enterOutlineStep();
    });
  }

  outlineCanvas.addEventListener('click', onOutlineCanvasClick);

  btnUseOutline.addEventListener('click', function () {
    if (contourPoints.length < 3) {
      outlinePreview.textContent = 'Need at least 3 points. Click on the object to select it first.';
      return;
    }
    showStep('step-specs');
  });

  // ——— Default start/end g-code (from Sample.gcode) ———
  const DEFAULT_START_GCODE = 'M220 S100 ;Reset Feedrate\nM221 S100 ;Reset Flowrate\n\nM140 S60 ;Set final bed temp\nG28 ;Home\n\nG92 E0 ;Reset Extruder\nG1 Z2.0 F3000 ;Move Z Axis up\nM104 S225 ;Set final nozzle temp\nG1 X-2.0 Y20 Z0.28 F5000.0 ;Move to start position\nM190 S60 ;Wait for bed temp to stabilize\nM109 S225 ;Wait for nozzle temp to stabilize\nG1 X-2.0 Y145.0 Z0.28 F1500.0 E15 ;Draw the first line\nG1 X-1.7 Y145.0 Z0.28 F5000.0 ;Move to side a little\nG1 X-1.7 Y20 Z0.28 F1500.0 E30 ;Draw the second line\nG92 E0 ;Reset Extruder\nG1 E-1.0000 F1800 ;Retract a bit\nG1 Z2.0 F3000 ;Move Z Axis up\nG1 E0.0000 F1800\nG90\nG21\nM83 ; use relative distances for extrusion';
  const DEFAULT_END_GCODE = 'G91 ;Relative positionning\nG1 E-2 F2700 ;Retract a bit\nG1 E-2 Z0.2 F2400 ;Retract and raise Z\nG1 X3 Y3 F3000 ;Wipe out\nG1 Z5 ;Raise Z more\nG90 ;Absolute positionning\n\nG1 X2 Y218 F3000 ;Present print\nM106 S0 ;Turn-off fan\nM104 S0 ;Turn-off hotend\nM140 S0 ;Turn-off bed\n\nM84 X Y E ;Disable steppers';

  function initGcodeDefaults() {
    if (startGcodeEl && !startGcodeEl.value) startGcodeEl.value = DEFAULT_START_GCODE;
    if (endGcodeEl && !endGcodeEl.value) endGcodeEl.value = DEFAULT_END_GCODE;
  }

  function num(id, def) {
    const el = document.getElementById(id);
    return el ? (parseFloat(el.value) || def) : def;
  }
  function int(id, def) {
    const el = document.getElementById(id);
    return el ? (parseInt(el.value, 10) || def) : def;
  }

  // ——— G-code generation (vase mode); defaults from Sample.gcode ———
  // Speed (mm/s) from max volumetric flow: speed = maxVolumetricSpeed / (lineWidth * layerHeight)
  const MAX_LINEAR_SPEED_MM_S = 300;

  function getSpecs() {
    const nozzleSize = num('nozzleSize', 1);
    const filamentDiam = num('filamentDiam', 1.75);
    const filamentDensity = num('filamentDensity', 1.25);
    const layerHeight = num('layerHeight', 0.9);
    const firstLayerHeight = num('firstLayerHeight', 0.8);
    const lineWidth = num('lineWidth', 1.5);
    const maxVolumetricSpeed = num('maxVolumetricSpeed', 8);
    const vaseHeight = num('vaseHeight', 60);
    const maxSizeMm = num('maxSizeMm', 80);
    const bedSizeX = num('bedSizeX', 220);
    const bedSizeY = num('bedSizeY', 220);
    const bedTemp = int('bedTemp', 60);
    const hotendTemp = int('hotendTemp', 225);
    const partCoolingFan = Math.min(100, Math.max(0, int('partCoolingFan', 100)));
    const bottomLayers = Math.max(1, int('bottomLayers', 1));
    const startGcode = (startGcodeEl && startGcodeEl.value.trim()) ? startGcodeEl.value.trim() : DEFAULT_START_GCODE;
    const endGcode = (endGcodeEl && endGcodeEl.value.trim()) ? endGcodeEl.value.trim() : DEFAULT_END_GCODE;
    return {
      nozzleSize, filamentDiam, filamentDensity, layerHeight, firstLayerHeight,
      lineWidth, maxVolumetricSpeed, vaseHeight, maxSizeMm,
      bedSizeX, bedSizeY, bedTemp, hotendTemp, partCoolingFan, bottomLayers, startGcode, endGcode
    };
  }

  function speedFromVolumetric(maxVolMm3PerS, lineWidthMm, layerHeightMm) {
    const crossSection = lineWidthMm * layerHeightMm;
    if (crossSection <= 0) return 60;
    const speed = maxVolMm3PerS / crossSection;
    return Math.min(speed, MAX_LINEAR_SPEED_MM_S);
  }

  function updateDerivedSpeedDisplay() {
    const el = document.getElementById('derivedSpeedDisplay');
    if (!el) return;
    const vol = num('maxVolumetricSpeed', 8);
    const lw = num('lineWidth', 1.5);
    const lh = num('layerHeight', 0.9);
    const flh = num('firstLayerHeight', 0.8);
    const first = speedFromVolumetric(vol, lw, flh);
    const other = speedFromVolumetric(vol, lw, lh);
    el.textContent = 'First: ' + first.toFixed(1) + ' mm/s · Other: ' + other.toFixed(1) + ' mm/s';
  }

  // Build revolved mesh data (layer rings) for preview and G-code. Returns null if no contour.
  function getRevolvedMeshData() {
    if (contourPoints.length < 3) return null;
    const s = getSpecs();
    const offsetX = s.bedSizeX / 2;
    const offsetY = s.bedSizeY / 2;
    const pts = normalizeContourUpright(contourPoints, s.vaseHeight);
    if (pts.length < 3) return null;
    const layerHeight = s.layerHeight;
    const firstLayerHeight = s.firstLayerHeight;
    const numLayers = s.vaseHeight <= firstLayerHeight ? 1 : 1 + Math.floor((s.vaseHeight - firstLayerHeight) / layerHeight);
    const minRadius = s.lineWidth * 0.5;
    const segsPerCircle = 64;
    const layers = [];
    for (let L = 0; L < numLayers; L++) {
      const isFirstLayer = L === 0;
      const layerThickness = isFirstLayer ? firstLayerHeight : layerHeight;
      const zStart = isFirstLayer ? 0 : firstLayerHeight + (L - 1) * layerHeight;
      if (zStart >= s.vaseHeight) break;
      const zMid = zStart + layerThickness * 0.5;
      const slice = slicePolygonAtZ(pts, zMid);
      if (!slice) continue;
      let r = (slice[1] - slice[0]) * 0.5;
      if (r < minRadius) r = minRadius;
      const ring = [];
      for (let i = 0; i <= segsPerCircle; i++) {
        const theta = (i / segsPerCircle) * 2 * Math.PI;
        ring.push({
          x: offsetX + r * Math.cos(theta),
          y: offsetY + r * Math.sin(theta),
          z: zStart
        });
      }
      layers.push(ring);
    }
    return { layers, offsetX, offsetY, vaseHeight: s.vaseHeight };
  }

  function generateGcode() {
    if (contourPoints.length < 3) {
      log('No outline. Go back and capture + detect outline first.');
      return null;
    }
    const s = getSpecs();
    const offsetX = s.bedSizeX / 2;
    const offsetY = s.bedSizeY / 2;
    // Normalize so silhouette stands upright: image vertical -> Z (base at 0, top at vase_height)
    const pts = normalizeContourUpright(contourPoints, s.vaseHeight);
    if (pts.length < 3) return null;

    const layerHeight = s.layerHeight;
    const firstLayerHeight = s.firstLayerHeight;
    const numLayers = s.vaseHeight <= firstLayerHeight ? 1 : 1 + Math.floor((s.vaseHeight - firstLayerHeight) / layerHeight);
    const minRadius = s.lineWidth * 0.5;

    const lines = [];
    lines.push('; Photo to Vase — revolved vase, spiral (continuous Z), optimized for 3D print');
    lines.push('; Centered on bed (X' + offsetX + ' Y' + offsetY + ' mm)');
    lines.push('; First layer height: ' + firstLayerHeight + ' mm, Layer height: ' + layerHeight + ' mm');
    lines.push('; Z height: ' + s.vaseHeight + ' mm, Bottom layers: ' + s.bottomLayers);
    lines.push('; Max volumetric: ' + s.maxVolumetricSpeed + ' mm³/s → speed derived per layer');
    lines.push('');
    lines.push(s.startGcode);
    lines.push('');
    lines.push('; ----- revolved vase: spiral path, no retraction, absolute E -----');
    lines.push('M82 ; absolute extrusion');
    lines.push('G92 E0');
    const fanPwm = Math.round((s.partCoolingFan / 100) * 255);
    lines.push('M106 S' + fanPwm + ' ; part cooling fan ' + s.partCoolingFan + '%');

    let e = 0;
    for (let L = 0; L < numLayers; L++) {
      const isFirstLayer = L === 0;
      const layerThickness = isFirstLayer ? firstLayerHeight : layerHeight;
      const zStart = isFirstLayer ? 0 : firstLayerHeight + (L - 1) * layerHeight;
      const zEnd = zStart + layerThickness;
      if (zStart >= s.vaseHeight) break;
      const zMid = (zStart + zEnd) * 0.5;
      const slice = slicePolygonAtZ(pts, zMid);
      if (!slice) continue;
      const xMin = slice[0];
      const xMax = slice[1];
      let r = (xMax - xMin) * 0.5;
      if (r < minRadius) r = minRadius;
      const extrusionPerMm = (s.lineWidth * layerThickness) / (Math.PI * Math.pow(s.filamentDiam / 2, 2));
      const speedMmS = speedFromVolumetric(s.maxVolumetricSpeed, s.lineWidth, layerThickness);
      const feedrate = Math.round(speedMmS * 60);
      const isBottomLayer = L < s.bottomLayers;

      if (isBottomLayer) {
        lines.push('; Layer ' + (L + 1) + ' Z' + zStart.toFixed(3) + ' bottom (solid floor) R' + r.toFixed(3));
        let rRing = r;
        while (rRing >= minRadius) {
          const circum = 2 * Math.PI * rRing;
          const segs = Math.max(16, Math.min(128, Math.ceil(circum / s.lineWidth)));
          const segLen = circum / segs;
          for (let i = 0; i <= segs; i++) {
            const theta = (i / segs) * 2 * Math.PI;
            const x = offsetX + rRing * Math.cos(theta);
            const y = offsetY + rRing * Math.sin(theta);
            e += segLen * extrusionPerMm;
            lines.push('G1 X' + x.toFixed(3) + ' Y' + y.toFixed(3) + ' Z' + zStart.toFixed(3) + ' E' + e.toFixed(5) + ' F' + feedrate);
          }
          rRing -= s.lineWidth;
        }
      } else {
        const circumference = 2 * Math.PI * r;
        const segsPerCircle = Math.max(32, Math.min(128, Math.ceil(circumference / s.lineWidth)));
        const segLen = circumference / segsPerCircle;
        lines.push('; Layer ' + (L + 1) + ' Z' + zStart.toFixed(3) + '-' + zEnd.toFixed(3) + ' R' + r.toFixed(3) + ' vase');
        for (let i = 0; i <= segsPerCircle; i++) {
          const t = i / segsPerCircle;
          const theta = t * 2 * Math.PI;
          const z = zStart + t * layerThickness;
          const x = offsetX + r * Math.cos(theta);
          const y = offsetY + r * Math.sin(theta);
          e += segLen * extrusionPerMm;
          lines.push('G1 X' + x.toFixed(3) + ' Y' + y.toFixed(3) + ' Z' + z.toFixed(3) + ' E' + e.toFixed(5) + ' F' + feedrate);
        }
      }
      lines.push('');
    }

    lines.push(s.endGcode);
    return lines.join('\n');
  }

  // ——— 3D preview (slicer-style: orbit, zoom, bed) ———
  let previewScene = null;
  let previewCamera = null;
  let previewRenderer = null;
  let previewMesh = null;
  let previewBed = null;
  let previewAnimationId = null;
  let previewOrbit = { radius: 120, theta: 0.6, phi: 0.5 };
  let previewTarget = null;
  let previewPointer = { down: false, lastX: 0, lastY: 0 };

  function buildPreviewMesh() {
    const data = getRevolvedMeshData();
    const wrap = document.getElementById('previewWrap');
    const placeholder = document.getElementById('previewPlaceholder');
    if (!wrap || !placeholder) return;
    if (!data || !data.layers.length) {
      if (previewMesh && previewScene) {
        previewScene.remove(previewMesh);
        previewMesh.geometry.dispose();
        previewMesh.material.dispose();
        previewMesh = null;
      }
      if (previewBed && previewScene) {
        previewScene.remove(previewBed);
        previewBed.geometry.dispose();
        previewBed.material.dispose();
        previewBed = null;
      }
      wrap.classList.remove('has-preview');
      placeholder.textContent = 'Select an outline in step 2 first.';
      return;
    }
    const layers = data.layers;
    const segs = layers[0].length - 1;
    const numLayers = layers.length;
    const positions = [];
    const indices = [];
    const cx = data.offsetX;
    const cy = data.offsetY;
    for (let L = 0; L < numLayers; L++) {
      for (let i = 0; i <= segs; i++) {
        const p = layers[L][i];
        positions.push(p.x - cx, p.z, p.y - cy);
      }
    }
    for (let L = 0; L < numLayers - 1; L++) {
      for (let i = 0; i < segs; i++) {
        const a = L * (segs + 1) + i;
        const b = L * (segs + 1) + i + 1;
        const c = (L + 1) * (segs + 1) + i + 1;
        const d = (L + 1) * (segs + 1) + i;
        indices.push(a, b, c, a, c, d);
      }
    }
    if (typeof THREE === 'undefined') return;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    const material = new THREE.MeshPhongMaterial({
      color: 0x6b9bd1,
      side: THREE.DoubleSide,
      shininess: 30
    });
    const mesh = new THREE.Mesh(geometry, material);
    if (previewMesh && previewScene) {
      previewScene.remove(previewMesh);
      previewMesh.geometry.dispose();
      previewMesh.material.dispose();
    }
    if (previewBed && previewScene) {
      previewScene.remove(previewBed);
      previewBed.geometry.dispose();
      previewBed.material.dispose();
      previewBed = null;
    }
    if (!previewScene) {
      const canvas = document.getElementById('previewCanvas');
      if (!canvas) return;
      previewTarget = new THREE.Vector3(0, 0, 0);
      previewScene = new THREE.Scene();
      previewScene.background = new THREE.Color(0x1e2226);
      previewCamera = new THREE.PerspectiveCamera(50, 1, 1, 1000);
      previewRenderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
      previewRenderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      const light1 = new THREE.DirectionalLight(0xffffff, 0.85);
      light1.position.set(40, 80, 40);
      previewScene.add(light1);
      previewScene.add(new THREE.AmbientLight(0xffffff, 0.35));
      initPreviewOrbit(canvas);
    }
    const h = data.vaseHeight;
    const s = getSpecs();
    const bedW = s.bedSizeX;
    const bedD = s.bedSizeY;
    const bedGeom = new THREE.PlaneGeometry(bedW, bedD);
    bedGeom.rotateX(-Math.PI / 2);
    const bedMat = new THREE.MeshPhongMaterial({
      color: 0x2d3238,
      side: THREE.DoubleSide
    });
    previewBed = new THREE.Mesh(bedGeom, bedMat);
    previewBed.position.set(0, 0, 0);
    previewScene.add(previewBed);
    previewTarget.set(0, h * 0.5, 0);
    previewOrbit.radius = Math.max(60, Math.min(400, h * 1.8));
    previewOrbit.theta = 0.6;
    previewOrbit.phi = 0.5;
    updatePreviewCamera();
    previewScene.add(mesh);
    previewMesh = mesh;
    wrap.classList.add('has-preview');
    placeholder.style.display = 'none';
    resizePreview();
  }

  function updatePreviewCamera() {
    if (!previewCamera || !previewTarget) return;
    const r = previewOrbit.radius;
    const t = previewOrbit.theta;
    const p = previewOrbit.phi;
    previewCamera.position.set(
      previewTarget.x + r * Math.sin(p) * Math.cos(t),
      previewTarget.y + r * Math.cos(p),
      previewTarget.z + r * Math.sin(p) * Math.sin(t)
    );
    previewCamera.lookAt(previewTarget.x, previewTarget.y, previewTarget.z);
    previewCamera.updateProjectionMatrix();
  }

  function initPreviewOrbit(canvas) {
    if (!canvas) return;
    function getClientXY(e) {
      if (e.touches && e.touches.length) return [e.touches[0].clientX, e.touches[0].clientY];
      return [e.clientX, e.clientY];
    }
    function onDown(e) {
      previewPointer.down = true;
      const xy = getClientXY(e);
      previewPointer.lastX = xy[0];
      previewPointer.lastY = xy[1];
    }
    function onUp() { previewPointer.down = false; }
    function onMove(e) {
      if (!previewPointer.down || !previewCamera) return;
      const xy = getClientXY(e);
      const dx = xy[0] - previewPointer.lastX;
      const dy = xy[1] - previewPointer.lastY;
      previewPointer.lastX = xy[0];
      previewPointer.lastY = xy[1];
      previewOrbit.theta -= dx * 0.005;
      previewOrbit.phi = Math.max(0.15, Math.min(Math.PI - 0.15, previewOrbit.phi + dy * 0.005));
      updatePreviewCamera();
    }
    function onWheel(e) {
      e.preventDefault();
      previewOrbit.radius = Math.max(30, Math.min(600, previewOrbit.radius * (e.deltaY > 0 ? 1.1 : 0.9)));
      updatePreviewCamera();
    }
    canvas.addEventListener('mousedown', onDown);
    canvas.addEventListener('touchstart', onDown, { passive: true });
    window.addEventListener('mouseup', onUp);
    window.addEventListener('touchend', onUp);
    window.addEventListener('touchcancel', onUp);
    canvas.addEventListener('mousemove', onMove);
    canvas.addEventListener('touchmove', onMove, { passive: false });
    canvas.addEventListener('wheel', onWheel, { passive: false });
  }

  function resizePreview() {
    if (!previewRenderer || !previewCamera) return;
    const wrap = document.getElementById('previewWrap');
    const canvas = document.getElementById('previewCanvas');
    if (!wrap || !canvas) return;
    const w = wrap.clientWidth;
    const h = wrap.clientHeight || 240;
    if (w <= 0 || h <= 0) return;
    canvas.width = w;
    canvas.height = h;
    previewRenderer.setSize(w, h);
    previewCamera.aspect = w / h;
    previewCamera.updateProjectionMatrix();
    previewRenderer.render(previewScene, previewCamera);
  }

  function animatePreview() {
    if (!previewRenderer || !previewScene || !previewCamera) return;
    previewRenderer.render(previewScene, previewCamera);
    previewAnimationId = requestAnimationFrame(animatePreview);
  }

  function startPreviewLoop() {
    if (previewAnimationId != null) return;
    animatePreview();
  }

  function stopPreviewLoop() {
    if (previewAnimationId != null) {
      cancelAnimationFrame(previewAnimationId);
      previewAnimationId = null;
    }
  }

  function initPreview() {
    const group = document.getElementById('preview-group');
    if (!group) return;
    group.addEventListener('toggle', function () {
      if (group.open) {
        buildPreviewMesh();
        startPreviewLoop();
      } else {
        stopPreviewLoop();
      }
    });
    const resizeObs = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(resizePreview) : null;
    const wrap = document.getElementById('previewWrap');
    if (resizeObs && wrap) resizeObs.observe(wrap);
    window.addEventListener('resize', resizePreview);
    const specIds = ['vaseHeight', 'layerHeight', 'firstLayerHeight', 'lineWidth'];
    specIds.forEach(function (id) {
      const el = document.getElementById(id);
      if (el) el.addEventListener('input', function () {
        if (group.open) buildPreviewMesh();
      });
    });
  }

  function doExport() {
    const gcode = generateGcode();
    if (!gcode) return;
    const blob = new Blob([gcode], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'vase-mode.gcode';
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    log('G-code generated and download started. Check your downloads for vase-mode.gcode.');
  }

  if (btnGoExport) btnGoExport.addEventListener('click', doExport);

  if (backToStart) {
    backToStart.addEventListener('click', function (e) {
      e.preventDefault();
      showStep('step-capture');
    });
  }

  function initSpecsUI() {
    initGcodeDefaults();
    updateDerivedSpeedDisplay();
    ['maxVolumetricSpeed', 'lineWidth', 'layerHeight', 'firstLayerHeight'].forEach(function (id) {
      const el = document.getElementById(id);
      if (el) el.addEventListener('input', updateDerivedSpeedDisplay);
    });
    initPreview();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initSpecsUI);
  } else {
    initSpecsUI();
  }
})();
