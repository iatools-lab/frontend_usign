const MAX_PROCESSING_DIMENSION = 1600;
const FINAL_MAX_DIMENSION = 800;

/**
 * Nettoie une image de signature importée sans dépendre d'un modèle IA côté
 * navigateur. L'ancien flux utilisait une suppression de fond IA qui peut
 * télécharger et initialiser un moteur lourd en production. Ici, tout est fait
 * localement dans un canvas afin que l'upload reste rapide et prévisible.
 */
export async function cleanSignatureImageFile(file: File): Promise<string> {
  if (!file.type.startsWith("image/")) {
    throw new Error("Format d'image non supporté.");
  }

  const originalDataUrl = await readFileAsDataUrl(file);
  return keepInkOnly(originalDataUrl);
}

async function keepInkOnly(dataUrl: string): Promise<string> {
  const image = await loadImage(dataUrl);

  const canvas = document.createElement("canvas");
  const scale = Math.min(
    1,
    MAX_PROCESSING_DIMENSION / Math.max(1, image.naturalWidth),
    MAX_PROCESSING_DIMENSION / Math.max(1, image.naturalHeight),
  );

  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));

  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Impossible de préparer l'image de signature.");

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);

  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const { data } = imageData;

  let totalLuminance = 0;
  let counted = 0;
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const a = data[i + 3];

    if (a > 50) {
      totalLuminance += 0.2126 * r + 0.7152 * g + 0.0722 * b;
      counted++;
    }
  }

  const avgLuminance = counted > 0 ? totalLuminance / counted : 128;
  const adaptiveThreshold = Math.max(40, Math.min(160, avgLuminance - 30));

  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const a = data[i + 3];

    if (a === 0) continue;

    const luminance = 0.299 * r + 0.587 * g + 0.114 * b;
    const maxChannel = Math.max(r, g, b);
    const minChannel = Math.min(r, g, b);
    const saturation = maxChannel - minChannel;

    const isDarkInk = luminance < adaptiveThreshold;
    const isColoredInk = saturation > 30 && maxChannel > 60 && luminance < 200;

    if (isDarkInk || isColoredInk) {
      data[i + 3] = Math.max(a, 220);
    } else {
      data[i + 3] = 0;
    }
  }

  ctx.putImageData(imageData, 0, 0);

  const trimmedCanvas = trimTransparentEdges(canvas);
  const finalCanvas = resizeIfNeeded(trimmedCanvas, FINAL_MAX_DIMENSION);
  return finalCanvas.toDataURL("image/png");
}

function trimTransparentEdges(source: HTMLCanvasElement): HTMLCanvasElement {
  const ctx = source.getContext("2d");
  if (!ctx) return source;

  const { width, height } = source;
  const imageData = ctx.getImageData(0, 0, width, height);
  const { data } = imageData;

  let top = height;
  let bottom = 0;
  let left = width;
  let right = 0;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const alpha = data[(y * width + x) * 4 + 3];
      if (alpha > 20) {
        if (y < top) top = y;
        if (y > bottom) bottom = y;
        if (x < left) left = x;
        if (x > right) right = x;
      }
    }
  }

  if (top > bottom || left > right) return source;

  const margin = 4;
  const cropX = Math.max(0, left - margin);
  const cropY = Math.max(0, top - margin);
  const cropW = Math.min(width - cropX, right - left + 1 + margin * 2);
  const cropH = Math.min(height - cropY, bottom - top + 1 + margin * 2);

  const output = document.createElement("canvas");
  output.width = cropW;
  output.height = cropH;

  const outCtx = output.getContext("2d");
  if (!outCtx) return source;

  outCtx.drawImage(source, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);
  return output;
}

function resizeIfNeeded(source: HTMLCanvasElement, maxPx: number): HTMLCanvasElement {
  const { width, height } = source;
  if (width <= maxPx && height <= maxPx) return source;

  const ratio = Math.min(maxPx / width, maxPx / height);
  const newWidth = Math.max(1, Math.round(width * ratio));
  const newHeight = Math.max(1, Math.round(height * ratio));

  const canvas = document.createElement("canvas");
  canvas.width = newWidth;
  canvas.height = newHeight;

  const ctx = canvas.getContext("2d");
  if (!ctx) return source;

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(source, 0, 0, newWidth, newHeight);
  return canvas;
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = src;
  });
}
