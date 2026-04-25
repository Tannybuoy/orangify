// ─── Public types ─────────────────────────────────────────────────────────────

export interface OrangifyResult {
  originalDataUrl: string;
  orangeDataUrl: string;
  width: number;
  height: number;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const ORANGE_HUE = 25; // degrees — rgb(255,106,0)
const FALLBACK_SIZE = 800;
const MAX_SIZE = 2048;

// ─── Math helpers ─────────────────────────────────────────────────────────────

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Smooth Hermite fade — used for soft threshold transitions. */
function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

// ─── Colour conversions ───────────────────────────────────────────────────────

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const nr = r / 255, ng = g / 255, nb = b / 255;
  const max = Math.max(nr, ng, nb);
  const min = Math.min(nr, ng, nb);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === nr) h = ((ng - nb) / d + (ng < nb ? 6 : 0)) / 6;
  else if (max === ng) h = ((nb - nr) / d + 2) / 6;
  else h = ((nr - ng) / d + 4) / 6;
  return [h * 360, s, l];
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  h = ((h % 360) + 360) % 360;
  if (s === 0) {
    const v = Math.round(clamp(l, 0, 1) * 255);
    return [v, v, v];
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const hue2rgb = (t: number) => {
    t = ((t % 1) + 1) % 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 0.5) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  const hn = h / 360;
  return [
    Math.round(clamp(hue2rgb(hn + 1 / 3), 0, 1) * 255),
    Math.round(clamp(hue2rgb(hn), 0, 1) * 255),
    Math.round(clamp(hue2rgb(hn - 1 / 3), 0, 1) * 255),
  ];
}

/** Perceptual luminance in 0..1 (ITU-R BT.709). */
function perceptualLum(r: number, g: number, b: number): number {
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

/**
 * Shortest signed angular distance from h to target (degrees).
 * Returns a value in (-180, 180].
 */
function hueDelta(h: number, target: number): number {
  let d = target - h;
  if (d > 180) d -= 360;
  if (d < -180) d += 360;
  return d;
}

// ─── Step 1 · Image analysis → feature profile ───────────────────────────────
//
// A single pass through the raw pixel data computes soft probabilities (0–1)
// for each visual characteristic. No pixel is "classified" — every score is
// a continuous weight that will influence the blend in Step 2.

interface FeatureProfile {
  /**
   * Sustained high-frequency local variation → photographic / noisy content.
   * Drives colour-grade (shadow-tinting) over flat replacement.
   */
  photographic: number;
  /**
   * Breadth of distinct hue zones across coloured pixels.
   * Drives palette remapping that respects tonal relationships.
   */
  multiColor: number;
  /**
   * Fraction of opaque pixels with genuine strong colour (s>0.20, mid-range l).
   * Distinguishes true B&W logos (≈0) from single-hue logos like green+black (>0).
   * Guards the near-black → orange mapping so it only fires on achromatic images.
   */
  coloredRatio: number;
  /**
   * Sparse sharp edges against an otherwise flat image → text / glyphs.
   * Drives luminance-preserving transform to keep contrast and readability.
   */
  textDominance: number;
  /**
   * Proportion of coloured pixels already in a warm hue range.
   * Dampens aggressive transforms; favours gentle gradient-aware shifts.
   */
  warmBias: number;
  /**
   * Predominantly achromatic or single-hue content.
   * Drives the direct hue-shift transform.
   */
  flatness: number;
  /**
   * Smooth multi-tone colour variation without texture → gradients.
   * Drives the partial-rotation transform that preserves gradient shape.
   */
  gradientLikely: number;
}

function analyzeImage(
  data: Uint8ClampedArray,
  width: number,
  height: number,
): FeatureProfile {
  const hueHist = new Float32Array(36); // 10° bins, 0..350
  let satSum = 0;
  let edgeSum = 0;
  let highEdgeCount = 0;
  let warmCount = 0;
  let opaqueCount = 0;
  let lowSatCount = 0;
  let coloredCount = 0;
  let strongColorCount = 0;

  const stride = width * 4;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      if (data[i + 3] < 10) continue; // skip transparent

      const r = data[i], g = data[i + 1], b = data[i + 2];
      const [h, s, l] = rgbToHsl(r, g, b);

      opaqueCount++;
      satSum += s;
      if (s < 0.08) lowSatCount++;
      if (s > 0.20 && l > 0.10 && l < 0.90) strongColorCount++;

      // Only pixels with meaningful colour contribute to hue analysis
      if (s > 0.15 && l > 0.05 && l < 0.95) {
        hueHist[Math.floor(h / 10) % 36]++;
        coloredCount++;
        // Warm hues: red through yellow-orange (0–60°) and purple-red (300–360°)
        if (h < 60 || h > 300) warmCount++;
      }

      // Local edge magnitude using the right and bottom neighbours.
      // Reads beyond image bounds are guarded; the result is normalised to 0..1.
      let edgeMag = 0;
      if (x < width - 1) {
        const j = i + 4;
        edgeMag +=
          Math.abs(r - data[j]) +
          Math.abs(g - data[j + 1]) +
          Math.abs(b - data[j + 2]);
      }
      if (y < height - 1) {
        const j = i + stride;
        edgeMag +=
          Math.abs(r - data[j]) +
          Math.abs(g - data[j + 1]) +
          Math.abs(b - data[j + 2]);
      }
      edgeMag /= 255 * 6; // max possible across two directions × three channels
      edgeSum += edgeMag;
      if (edgeMag > 0.25) highEdgeCount++;
    }
  }

  if (opaqueCount === 0) {
    return {
      photographic: 0,
      multiColor: 0,
      textDominance: 0,
      warmBias: 0,
      flatness: 1,
      gradientLikely: 0,
      coloredRatio: 0,
    };
  }

  const meanEdge = edgeSum / opaqueCount;
  const pctHighEdge = highEdgeCount / opaqueCount;

  // Photographic: sustained high mean edge magnitude across the whole image.
  const photographic = smoothstep(0.04, 0.14, meanEdge);

  // Multi-colour: count hue bins that hold >3 % of coloured pixels.
  let significantBins = 0;
  if (coloredCount > 0) {
    for (let bin = 0; bin < 36; bin++) {
      if (hueHist[bin] / coloredCount > 0.03) significantBins++;
    }
  }
  const multiColor = clamp((significantBins - 1) / 7, 0, 1);

  // Text dominance: sparse sharp edges in an otherwise low-edge image.
  // High-edge pixels are text/glyph outlines; a photographic image has
  // edges everywhere, so (1 - photographic) suppresses that case.
  const textDominance = clamp(pctHighEdge * 2 * (1 - photographic), 0, 1);

  // Warm bias: fraction of coloured pixels already in warm hue territory.
  const warmBias = coloredCount > 0 ? warmCount / coloredCount : 0;

  // Flatness: achromatic content + single-hue dominance.
  const flatness = clamp(
    (lowSatCount / opaqueCount) * 0.55 + (1 - multiColor) * 0.45,
    0,
    1,
  );

  // Gradient likely: multiple colours, low texture, not flat.
  // A gradient has hue diversity (multiColor) but small local differences
  // (low photographic / low meanEdge).
  const gradientLikely = clamp(
    (1 - photographic) * (1 - flatness) * multiColor * 2,
    0,
    1,
  );

  const coloredRatio = strongColorCount / opaqueCount;

  return { photographic, multiColor, textDominance, warmBias, flatness, gradientLikely, coloredRatio };
}

// ─── Step 2 · Per-pixel transforms ───────────────────────────────────────────
//
// Five independent transforms, each optimised for a different logo character.
// They are never applied in isolation — Step 3 blends them with weights derived
// from the feature profile and per-pixel local context.

/**
 * A · Hue shift — flat / monochrome logos.
 * Rotates the hue fully to orange, boosts saturation, preserves lightness.
 * Produces the cleanest result on single-colour vector art.
 */
function txHueShift(h: number, s: number, l: number): [number, number, number] {
  const newS = Math.min(1.0, s + (1.0 - s) * 0.85);
  return hslToRgb(ORANGE_HUE, newS, l);
}

/**
 * B · Palette remap — multi-colour logos.
 * Maps perceptual luminance onto an orange tonal range, ignoring the original
 * hue entirely. Dark areas → dark orange; mid-tones → pure orange;
 * light areas → warm cream. Preserves the logo's tonal structure.
 */
function txPaletteRemap(l: number): [number, number, number] {
  if (l < 0.5) {
    const t = l / 0.5;
    return hslToRgb(lerp(18, ORANGE_HUE, t), 1.0, lerp(0.12, 0.50, t));
  }
  const t = (l - 0.5) / 0.5;
  return hslToRgb(lerp(ORANGE_HUE, 38, t), lerp(1.0, 0.10, t), lerp(0.50, 0.95, t));
}

/**
 * C · Gradient-aware — smooth tonal gradients.
 * Partially rotates the hue toward orange (65 %) and moderately boosts
 * saturation while preserving lightness exactly. Keeps smooth transitions
 * smooth rather than snapping them to a single flat colour.
 */
function txGradientAware(h: number, s: number, l: number): [number, number, number] {
  const newH = h + hueDelta(h, ORANGE_HUE) * 0.65;
  const newS = Math.min(1.0, s + (1.0 - s) * 0.55);
  return hslToRgb(newH, newS, l);
}

/**
 * D · Colour grade — photographic / complex imagery.
 * Blends shadows toward orange with strength proportional to darkness, leaving
 * highlights largely intact. A subtle warm tint is added to upper mid-tones.
 * Mimics a cinematic colour grade rather than a full replacement.
 */
function txColorGrade(
  r: number,
  g: number,
  b: number,
  l: number,
): [number, number, number] {
  const strength = Math.pow(1 - l, 1.8) * 0.65;
  const nr = r + (255 - r) * strength;
  const ng = g + (106 - g) * strength;
  const nb = b + (0 - b) * strength;
  if (l > 0.65) {
    const warm = ((l - 0.65) / 0.35) * 0.07;
    return [
      Math.round(clamp(nr + 25 * warm, 0, 255)),
      Math.round(clamp(ng + 8 * warm, 0, 255)),
      Math.round(clamp(nb, 0, 255)),
    ];
  }
  return [
    Math.round(clamp(nr, 0, 255)),
    Math.round(clamp(ng, 0, 255)),
    Math.round(clamp(nb, 0, 255)),
  ];
}

/**
 * E · Luminance-preserving — text and glyphs.
 * Sets the hue to orange at exactly the pixel's perceptual luminance level.
 * Dark text stays dark, light text stays light — only the hue changes.
 * This is the only transform that guarantees legibility is not degraded.
 */
function txLuminancePreserve(l: number): [number, number, number] {
  // Near-whites: apply just a barely perceptible warm tint to avoid
  // flattening white backgrounds or bright highlights into saturated orange.
  if (l > 0.88) return hslToRgb(38, 0.08, l);
  return hslToRgb(ORANGE_HUE, 1.0, l);
}

// ─── Step 3 · Weighted blend ──────────────────────────────────────────────────
//
// Combines the five transforms into a single output for each pixel.
// Weights start from the image-level feature profile (Step 1) and are then
// adjusted per-pixel using the local edge magnitude.

function blendPixel(
  r: number,
  g: number,
  b: number,
  localEdge: number,
  profile: FeatureProfile,
): [number, number, number] {
  const [h, s, l] = rgbToHsl(r, g, b);

  // Near-white pixels (backgrounds, bright highlights) receive only the faintest
  // warm nudge so white stays white and transparent-background logos look clean.
  if (l > 0.90) {
    return [Math.min(255, r + 2), Math.max(0, g - 1), Math.max(0, b - 4)];
  }

  // Single-hue flat logo (e.g. solid LinkedIn blue, Starbucks dark green):
  // txHueShift preserves lightness, so a dark colour (l≈0.2) produces brown.
  // When the image has genuine colour but only one hue and no gradient, map
  // coloured pixels directly to bright orange. The s>0.20 + l>0.10 guards
  // ensure black outlines in the same logo are NOT caught here.
  if (
    profile.coloredRatio > 0.05 &&
    profile.multiColor < 0.15 &&
    profile.photographic < 0.3 &&
    s > 0.20 && l > 0.10
  ) {
    return hslToRgb(ORANGE_HUE, 1.0, 0.50);
  }

  // Near-black or achromatic pixels in B&W logos: hue-based transforms leave
  // them black because l=0 produces black regardless of hue. JPEG compression
  // also inflates HSL saturation on near-black pixels (e.g. rgb(5,3,2) → s≈0.43)
  // so saturation alone is not a reliable test.
  // Gate on coloredRatio<0.05: a true B&W/greyscale image has no strongly-coloured
  // pixels, whereas a green+black logo has many — so this won't fire for it.
  if ((l < 0.15 || s < 0.15) && profile.coloredRatio < 0.05) {
    const t = clamp(l / 0.88, 0, 1);
    return hslToRgb(ORANGE_HUE, lerp(1.0, 0.25, t), lerp(0.50, 0.85, t));
  }

  // ── Base weights from image-level feature profile ──
  // Each weight reflects how strongly that transform should contribute for this
  // type of image. The small floor on wA ensures flat logos always get coverage.
  let wA = profile.flatness * 0.55 + 0.05;
  let wB = profile.multiColor * 0.50;
  let wC = profile.gradientLikely * 0.55;
  let wD = profile.photographic * 0.55;
  let wE = profile.textDominance * 0.50;

  // ── Per-pixel edge adjustment ──
  // Pixels on a sharp edge (text stroke, shape border) should never lose their
  // luminance contrast. Raise the luminance-preserving weight and lower the
  // aggressive replacements as edge strength increases.
  const edgeFactor = clamp(localEdge * 3.5, 0, 1);
  wE += edgeFactor * 0.45;
  wA *= 1 - edgeFactor * 0.60;
  wB *= 1 - edgeFactor * 0.30;
  wD *= 1 - edgeFactor * 0.20;

  // ── Warm-bias modulation ──
  // A logo that is already warm (orange-adjacent) needs gentler treatment.
  // Shift weight toward the gradient-aware and luminance-preserving transforms.
  if (profile.warmBias > 0.4) {
    const wb = (profile.warmBias - 0.4) / 0.6; // 0..1
    wC *= 1 + wb * 0.5;
    wE *= 1 + wb * 0.3;
    wA *= 1 - wb * 0.3;
    wB *= 1 - wb * 0.2;
  }

  const total = wA + wB + wC + wD + wE;
  // If no feature was strong enough to produce a meaningful total weight,
  // fall back to palette remap (safe, perceptually consistent default).
  if (total < 0.01) return txPaletteRemap(l);

  // Compute all five transformed colours
  const [rA, gA, bA] = txHueShift(h, s, l);
  const [rB, gB, bB] = txPaletteRemap(l);
  const [rC, gC, bC] = txGradientAware(h, s, l);
  const [rD, gD, bD] = txColorGrade(r, g, b, l);
  const [rE, gE, bE] = txLuminancePreserve(l);

  const inv = 1 / total;
  const nA = wA * inv, nB = wB * inv, nC = wC * inv, nD = wD * inv, nE = wE * inv;

  return [
    Math.round(clamp(nA * rA + nB * rB + nC * rC + nD * rD + nE * rE, 0, 255)),
    Math.round(clamp(nA * gA + nB * gB + nC * gC + nD * gD + nE * gE, 0, 255)),
    Math.round(clamp(nA * bA + nB * bB + nC * bC + nD * bD + nE * bE, 0, 255)),
  ];
}

// ─── Step 4 · Apply to canvas ────────────────────────────────────────────────

/**
 * Writes the blended orange transformation back onto the canvas.
 * Keeps a pristine copy of the original pixel data so that edge reads
 * for neighbouring pixels are never contaminated by already-written output.
 */
function applyOrangify(
  ctx: CanvasRenderingContext2D,
  imageData: ImageData,
  profile: FeatureProfile,
): void {
  const data = imageData.data;
  const orig = new Uint8ClampedArray(data); // pristine source for edge reads
  const { width, height } = imageData;
  const stride = width * 4;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      if (orig[i + 3] < 10) continue; // fully transparent — leave untouched

      const r = orig[i], g = orig[i + 1], b = orig[i + 2];

      // Local edge magnitude: compare to right and bottom neighbours.
      // Reading from `orig` ensures edges are computed from the original image,
      // not from pixels we have already recoloured in this pass.
      let edgeMag = 0;
      if (x < width - 1) {
        const j = i + 4;
        edgeMag +=
          Math.abs(r - orig[j]) +
          Math.abs(g - orig[j + 1]) +
          Math.abs(b - orig[j + 2]);
      }
      if (y < height - 1) {
        const j = i + stride;
        edgeMag +=
          Math.abs(r - orig[j]) +
          Math.abs(g - orig[j + 1]) +
          Math.abs(b - orig[j + 2]);
      }
      const localEdge = edgeMag / (255 * 6);

      const [nr, ng, nb] = blendPixel(r, g, b, localEdge, profile);
      data[i] = nr;
      data[i + 1] = ng;
      data[i + 2] = nb;
      // alpha channel left unchanged
    }
  }

  ctx.putImageData(imageData, 0, 0);
}

// ─── I/O helpers (unchanged) ─────────────────────────────────────────────────

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Failed to load image"));
    img.src = src;
  });
}

function drawImageToCanvas(img: HTMLImageElement): HTMLCanvasElement {
  let w = img.naturalWidth || img.width;
  let h = img.naturalHeight || img.height;
  if (!w || !h) { w = FALLBACK_SIZE; h = FALLBACK_SIZE; }
  if (w > MAX_SIZE || h > MAX_SIZE) {
    const scale = Math.min(MAX_SIZE / w, MAX_SIZE / h);
    w = Math.round(w * scale);
    h = Math.round(h * scale);
  }
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not get canvas context");
  ctx.drawImage(img, 0, 0, w, h);
  return canvas;
}

function isSvgFile(file: File): boolean {
  return file.type === "image/svg+xml" || file.name.toLowerCase().endsWith(".svg");
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => resolve(e.target?.result as string);
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });
}

function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => resolve(e.target?.result as string);
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.readAsText(file);
  });
}

function parseSvgDimensions(svgText: string): { w: number; h: number } | null {
  const parser = new DOMParser();
  const doc = parser.parseFromString(svgText, "image/svg+xml");
  const svgEl = doc.querySelector("svg");
  if (!svgEl) return null;
  let w = parseFloat(svgEl.getAttribute("width") ?? "0") || 0;
  let h = parseFloat(svgEl.getAttribute("height") ?? "0") || 0;
  if (!w || !h) {
    const parts = (svgEl.getAttribute("viewBox") ?? "").trim().split(/[\s,]+/);
    if (parts.length === 4) {
      w = parseFloat(parts[2]) || 0;
      h = parseFloat(parts[3]) || 0;
    }
  }
  return w && h ? { w, h } : null;
}

function svgTextToDataUrl(svgText: string, w: number, h: number): string {
  const parser = new DOMParser();
  const doc = parser.parseFromString(svgText, "image/svg+xml");
  const svgEl = doc.querySelector("svg");
  if (svgEl) {
    svgEl.setAttribute("width", String(w));
    svgEl.setAttribute("height", String(h));
  }
  const serialized = new XMLSerializer().serializeToString(doc);
  return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(serialized);
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function orangifyImage(file: File): Promise<OrangifyResult> {
  try {
    let originalDataUrl: string;
    let canvas: HTMLCanvasElement;

    if (isSvgFile(file)) {
      const svgText = await readFileAsText(file).catch(() => {
        throw new Error("Could not read SVG file.");
      });
      const dims = parseSvgDimensions(svgText);
      let w = dims?.w || FALLBACK_SIZE;
      let h = dims?.h || FALLBACK_SIZE;
      if (w > MAX_SIZE || h > MAX_SIZE) {
        const scale = Math.min(MAX_SIZE / w, MAX_SIZE / h);
        w = Math.round(w * scale);
        h = Math.round(h * scale);
      }
      originalDataUrl = svgTextToDataUrl(svgText, w, h);
      const img = await loadImage(originalDataUrl).catch(() => {
        throw new Error("Could not render SVG. Try saving it as a PNG first.");
      });
      canvas = drawImageToCanvas(img);
    } else {
      originalDataUrl = await readFileAsDataUrl(file).catch(() => {
        throw new Error("Could not read the image file.");
      });
      const img = await loadImage(originalDataUrl).catch(() => {
        throw new Error("Could not load the image. The file may be corrupt or unsupported.");
      });
      canvas = drawImageToCanvas(img);
    }

    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Could not get canvas context");

    // Step 1: analyse the rasterised image to build the feature profile
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const profile = analyzeImage(imageData.data, canvas.width, canvas.height);

    // Steps 2–4: blend transforms and write result back to the canvas
    applyOrangify(ctx, imageData, profile);

    return {
      originalDataUrl,
      orangeDataUrl: canvas.toDataURL("image/png"),
      width: canvas.width,
      height: canvas.height,
    };
  } catch (err) {
    if (err instanceof Error) throw err;
    throw new Error("An unexpected error occurred while processing the image.");
  }
}

export function downloadDataUrl(dataUrl: string, filename: string): void {
  const a = document.createElement("a");
  a.href = dataUrl;
  a.download = filename;
  a.click();
}
