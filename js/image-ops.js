"use strict";

// Perceived brightness of an RGB pixel (0..255).
function rgbToLuminance(r, g, b) {
  return 0.299 * r + 0.587 * g + 0.114 * b;
}
window.rgbToLuminance = rgbToLuminance; // exposed for verification

// Mutates the given ImageData's pixels to pure black/white. Returns it.
function applyThreshold(imageData, threshold, invert) {
  const d = imageData.data;
  for (let i = 0; i < d.length; i += 4) {
    const lum = rgbToLuminance(d[i], d[i + 1], d[i + 2]);
    let white = lum >= threshold;
    if (invert) white = !white;
    const v = white ? 255 : 0;
    d[i] = d[i + 1] = d[i + 2] = v;
    d[i + 3] = 255;
  }
  return imageData;
}
window.applyThreshold = applyThreshold;

// Otsu's method: returns the threshold (0..255) maximizing between-class variance.
function computeOtsuThreshold(imageData) {
  const d = imageData.data;
  const hist = new Array(256).fill(0);
  let total = 0;
  for (let i = 0; i < d.length; i += 4) {
    const lum = Math.round(rgbToLuminance(d[i], d[i + 1], d[i + 2]));
    hist[lum]++;
    total++;
  }
  if (total === 0) return 128;
  let sum = 0;
  for (let t = 0; t < 256; t++) sum += t * hist[t];
  let sumB = 0, wB = 0, maxVar = -1, threshold = 128;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (wB === 0) continue;
    const wF = total - wB;
    if (wF === 0) break;
    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    // >= breaks ties toward the upper edge of a flat variance plateau, so the
    // chosen threshold lands strictly inside the valley between two clusters.
    if (between >= maxVar) { maxVar = between; threshold = t; }
  }
  return threshold;
}
window.computeOtsuThreshold = computeOtsuThreshold;

// Removes small color "islands" from an already-binary (0/255) ImageData.
// Any 4-connected region of one color smaller than minSize pixels is recolored
// to the opposite color, so it merges into the surrounding area. Works in both
// directions (black specks in white and white specks in black). Mutates and
// returns the ImageData. minSize <= 0 is a no-op.
function removeSmallIslands(imageData, minSize) {
  if (minSize <= 0) return imageData;
  const { width, height, data } = imageData;
  const n = width * height;
  const visited = new Uint8Array(n);
  const stack = new Int32Array(n);   // pixel indices to expand
  const region = new Int32Array(n);  // pixel indices in the current region
  for (let p = 0; p < n; p++) {
    if (visited[p]) continue;
    const color = data[p * 4]; // 0 or 255
    let sp = 0, count = 0;
    stack[sp++] = p;
    visited[p] = 1;
    while (sp > 0) {
      const q = stack[--sp];
      region[count++] = q;
      const x = q % width;
      const y = (q - x) / width;
      if (x > 0)          { const r = q - 1;     if (!visited[r] && data[r * 4] === color) { visited[r] = 1; stack[sp++] = r; } }
      if (x < width - 1)  { const r = q + 1;     if (!visited[r] && data[r * 4] === color) { visited[r] = 1; stack[sp++] = r; } }
      if (y > 0)          { const r = q - width; if (!visited[r] && data[r * 4] === color) { visited[r] = 1; stack[sp++] = r; } }
      if (y < height - 1) { const r = q + width; if (!visited[r] && data[r * 4] === color) { visited[r] = 1; stack[sp++] = r; } }
    }
    if (count < minSize) {
      const opp = color === 0 ? 255 : 0;
      for (let k = 0; k < count; k++) {
        const idx = region[k] * 4;
        data[idx] = data[idx + 1] = data[idx + 2] = opp;
        data[idx + 3] = 255;
      }
    }
  }
  return imageData;
}
window.removeSmallIslands = removeSmallIslands;

// Posterize: reduce each RGB channel to `levels` evenly-spaced steps, which
// collapses smooth gradients into flat bands. Mutates and returns the ImageData.
function posterize(imageData, levels) {
  if (levels < 2) levels = 2;
  const d = imageData.data;
  const step = 255 / (levels - 1);
  for (let i = 0; i < d.length; i += 4) {
    d[i]     = Math.round(Math.round(d[i]     / step) * step);
    d[i + 1] = Math.round(Math.round(d[i + 1] / step) * step);
    d[i + 2] = Math.round(Math.round(d[i + 2] / step) * step);
  }
  return imageData;
}
window.posterize = posterize;

// Median-cut color quantization: reduce the image to at most `numColors`
// representative flat colors and map every pixel to the nearest one. The
// palette is built from a sample of pixels for speed; mapping covers all
// pixels. Mutates and returns the ImageData.
function quantizeMedianCut(imageData, numColors) {
  const d = imageData.data;
  const n = d.length / 4;
  if (n === 0 || numColors < 1) return imageData;

  // 1. Sample pixels (cap the work for large images).
  const maxSamples = 20000;
  const stepPx = Math.max(1, Math.floor(n / maxSamples));
  const samples = [];
  for (let p = 0; p < n; p += stepPx) {
    const i = p * 4;
    samples.push([d[i], d[i + 1], d[i + 2]]);
  }

  // 2. Repeatedly split the bucket with the widest color range at its median.
  let buckets = [samples];
  while (buckets.length < numColors) {
    let bi = -1, bestRange = -1, bestCh = 0;
    for (let b = 0; b < buckets.length; b++) {
      const bk = buckets[b];
      if (bk.length < 2) continue;
      const min = [255, 255, 255], max = [0, 0, 0];
      for (const s of bk) for (let c = 0; c < 3; c++) {
        if (s[c] < min[c]) min[c] = s[c];
        if (s[c] > max[c]) max[c] = s[c];
      }
      for (let c = 0; c < 3; c++) {
        const r = max[c] - min[c];
        if (r > bestRange) { bestRange = r; bi = b; bestCh = c; }
      }
    }
    if (bi < 0) break; // nothing left to split
    const bk = buckets[bi];
    bk.sort((a, b) => a[bestCh] - b[bestCh]);
    const mid = bk.length >> 1;
    buckets.splice(bi, 1, bk.slice(0, mid), bk.slice(mid));
  }

  // 3. Palette = average color of each bucket.
  const palette = buckets.map(bk => {
    let r = 0, g = 0, b = 0;
    for (const s of bk) { r += s[0]; g += s[1]; b += s[2]; }
    const len = bk.length || 1;
    return [Math.round(r / len), Math.round(g / len), Math.round(b / len)];
  });

  // 4. Map every pixel to its nearest palette color (Euclidean in RGB).
  for (let p = 0; p < n; p++) {
    const i = p * 4;
    const r = d[i], g = d[i + 1], b = d[i + 2];
    let best = 0, bestDist = Infinity;
    for (let k = 0; k < palette.length; k++) {
      const pc = palette[k];
      const dr = r - pc[0], dg = g - pc[1], db = b - pc[2];
      const dist = dr * dr + dg * dg + db * db;
      if (dist < bestDist) { bestDist = dist; best = k; }
    }
    const pc = palette[best];
    d[i] = pc[0]; d[i + 1] = pc[1]; d[i + 2] = pc[2];
  }
  return imageData;
}
window.quantizeMedianCut = quantizeMedianCut;

// Removes small color islands from a flat-color image (any number of colors).
// Each 4-connected region of one exact color smaller than minSize pixels is
// recolored to the color that borders it most, dissolving specks into their
// surroundings. Mutates and returns the ImageData. minSize <= 0 is a no-op.
function removeSmallColorIslands(imageData, minSize) {
  if (minSize <= 0) return imageData;
  const { width, height, data } = imageData;
  const n = width * height;
  const visited = new Uint8Array(n);
  const stack = new Int32Array(n);
  const region = new Int32Array(n);
  const colorOf = (p) => { const i = p * 4; return (data[i] << 16) | (data[i + 1] << 8) | data[i + 2]; };
  for (let p = 0; p < n; p++) {
    if (visited[p]) continue;
    const color = colorOf(p);
    const border = new Map(); // neighboring color -> shared edge count
    let sp = 0, count = 0;
    stack[sp++] = p; visited[p] = 1;
    while (sp > 0) {
      const q = stack[--sp];
      region[count++] = q;
      const x = q % width, y = (q - x) / width;
      const neighbors = [];
      if (x > 0) neighbors.push(q - 1);
      if (x < width - 1) neighbors.push(q + 1);
      if (y > 0) neighbors.push(q - width);
      if (y < height - 1) neighbors.push(q + width);
      for (const r of neighbors) {
        const nc = colorOf(r);
        if (nc === color) {
          if (!visited[r]) { visited[r] = 1; stack[sp++] = r; }
        } else {
          border.set(nc, (border.get(nc) || 0) + 1);
        }
      }
    }
    if (count < minSize && border.size > 0) {
      let bestC = -1, bestN = -1;
      for (const [c, cnt] of border) { if (cnt > bestN) { bestN = cnt; bestC = c; } }
      const r = (bestC >> 16) & 255, g = (bestC >> 8) & 255, b = bestC & 255;
      for (let k = 0; k < count; k++) { const idx = region[k] * 4; data[idx] = r; data[idx + 1] = g; data[idx + 2] = b; }
    }
  }
  return imageData;
}
window.removeSmallColorIslands = removeSmallColorIslands;

// Majority filter: each pixel becomes the most common color in its 3x3
// neighborhood, run `passes` times. Smooths ragged edges and clears isolated
// pixels on flat-color images. Mutates and returns the ImageData. 0 = no-op.
function majorityFilter(imageData, passes) {
  if (passes <= 0) return imageData;
  const { width, height, data } = imageData;
  for (let pass = 0; pass < passes; pass++) {
    const src = new Uint8ClampedArray(data); // read from a stable snapshot
    const counts = new Map();
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        counts.clear();
        let bestC = -1, bestN = -1;
        for (let dy = -1; dy <= 1; dy++) {
          const yy = y + dy; if (yy < 0 || yy >= height) continue;
          for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx; if (xx < 0 || xx >= width) continue;
            const i = (yy * width + xx) * 4;
            const c = (src[i] << 16) | (src[i + 1] << 8) | src[i + 2];
            const v = (counts.get(c) || 0) + 1;
            counts.set(c, v);
            if (v > bestN) { bestN = v; bestC = c; }
          }
        }
        const o = (y * width + x) * 4;
        data[o] = (bestC >> 16) & 255; data[o + 1] = (bestC >> 8) & 255; data[o + 2] = bestC & 255;
      }
    }
  }
  return imageData;
}
window.majorityFilter = majorityFilter;

// Crops the image to a circle centered at (cx, cy) with radius R: paints a ring
// of `thickness` pixels in ringColor ([r,g,b]) just inside the circle's edge,
// fills everything outside the circle (white, or transparent when
// transparentOutside is set), and leaves the inside untouched. Mutates and
// returns the ImageData.
function applyCircleMask(imageData, thickness, ringColor, cx, cy, R, transparentOutside) {
  const { width, height, data } = imageData;
  const inner = Math.max(0, R - Math.max(0, thickness));
  const R2 = R * R, inner2 = inner * inner;
  const [rr, rg, rb] = ringColor;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const dx = x - cx, dy = y - cy;
      const d2 = dx * dx + dy * dy;
      const i = (y * width + x) * 4;
      if (d2 > R2) {                 // outside the circle
        if (transparentOutside) { data[i + 3] = 0; }
        else { data[i] = 255; data[i + 1] = 255; data[i + 2] = 255; data[i + 3] = 255; }
      } else if (d2 > inner2) {      // ring band (always solid)
        data[i] = rr; data[i + 1] = rg; data[i + 2] = rb; data[i + 3] = 255;
      }                              // else: inside, keep the image as-is
    }
  }
  return imageData;
}
window.applyCircleMask = applyCircleMask;

// "#rrggbb" -> [r, g, b]
function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
window.hexToRgb = hexToRgb;
