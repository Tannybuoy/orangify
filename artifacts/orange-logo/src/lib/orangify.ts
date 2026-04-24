const ORANGE_R = 255;
const ORANGE_G = 106;
const ORANGE_B = 0;

const FALLBACK_SIZE = 800;

export interface OrangifyResult {
  originalDataUrl: string;
  orangeDataUrl: string;
  width: number;
  height: number;
}

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

  if (!w || !h) {
    w = FALLBACK_SIZE;
    h = FALLBACK_SIZE;
  }

  if (w > 2048 || h > 2048) {
    const scale = Math.min(2048 / w, 2048 / h);
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

const LUMINANCE_THRESHOLD = 220;

function applyOrange(canvas: HTMLCanvasElement): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not get canvas context");
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = imageData.data;
  for (let i = 0; i < data.length; i += 4) {
    const alpha = data[i + 3];
    if (alpha === 0) continue;
    const luminance = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
    if (luminance >= LUMINANCE_THRESHOLD) continue;
    data[i] = ORANGE_R;
    data[i + 1] = ORANGE_G;
    data[i + 2] = ORANGE_B;
  }
  ctx.putImageData(imageData, 0, 0);
}

function isSvgFile(file: File): boolean {
  return (
    file.type === "image/svg+xml" ||
    file.name.toLowerCase().endsWith(".svg")
  );
}

async function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => resolve(e.target?.result as string);
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });
}

async function readFileAsText(file: File): Promise<string> {
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

  const widthAttr = svgEl.getAttribute("width");
  const heightAttr = svgEl.getAttribute("height");
  const viewBox = svgEl.getAttribute("viewBox");

  let w = widthAttr ? parseFloat(widthAttr) : 0;
  let h = heightAttr ? parseFloat(heightAttr) : 0;

  if ((!w || !h) && viewBox) {
    const parts = viewBox.trim().split(/[\s,]+/);
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

export async function orangifyImage(file: File): Promise<OrangifyResult> {
  try {
    if (isSvgFile(file)) {
      const svgText = await readFileAsText(file).catch(() => {
        throw new Error("Could not read SVG file.");
      });
      const dims = parseSvgDimensions(svgText);
      let w = dims?.w || FALLBACK_SIZE;
      let h = dims?.h || FALLBACK_SIZE;

      if (w > 2048 || h > 2048) {
        const scale = Math.min(2048 / w, 2048 / h);
        w = Math.round(w * scale);
        h = Math.round(h * scale);
      }

      const svgDataUrl = svgTextToDataUrl(svgText, w, h);
      const img = await loadImage(svgDataUrl).catch(() => {
        throw new Error("Could not render SVG. Try saving it as a PNG first.");
      });
      const canvas = drawImageToCanvas(img);
      applyOrange(canvas);
      const orangeDataUrl = canvas.toDataURL("image/png");

      return { originalDataUrl: svgDataUrl, orangeDataUrl, width: canvas.width, height: canvas.height };
    }

    const originalDataUrl = await readFileAsDataUrl(file).catch(() => {
      throw new Error("Could not read the image file.");
    });
    const img = await loadImage(originalDataUrl).catch(() => {
      throw new Error("Could not load the image. The file may be corrupt or unsupported.");
    });
    const canvas = drawImageToCanvas(img);
    applyOrange(canvas);
    const orangeDataUrl = canvas.toDataURL("image/png");

    return { originalDataUrl, orangeDataUrl, width: canvas.width, height: canvas.height };
  } catch (err) {
    if (err instanceof Error) throw err;
    throw new Error("An unexpected error occurred while processing the image.");
  }
}

export function downloadDataUrl(dataUrl: string, filename: string) {
  const a = document.createElement("a");
  a.href = dataUrl;
  a.download = filename;
  a.click();
}
