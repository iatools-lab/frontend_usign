import { removeBackground } from "@imgly/background-removal";

/**
 * Nettoie une image de signature importée :
 *
 * 1.  Tente d'abord la suppression de fond par IA (@imgly/background-removal).
 *     En production le modèle WASM (~40 Mo) est téléchargé une fois puis mis en
 *     cache par le navigateur ; les appels suivants sont quasi instantanés.
 *
 * 2.  Si l'IA échoue (hors‑ligne, premier chargement lent, …), un fallback
 *     pixel‑par‑pixel 100 % local prend le relais sans aucun appel réseau.
 *
 * 3.  Dans les deux cas on applique un nettoyage final :
 *     - suppression des pixels de fond résiduels
 *     - rognage des marges transparentes
 *     - redimensionnement si l'image est très grande
 *
 * 4.  Retourne un data URL PNG prêt à être stocké.
 */
export async function cleanSignatureImageFile(file: File): Promise<string> {
  // ── 1. Tentative IA ──────────────────────────────────────
  try {
    const resultBlob = await removeBackground(file, {
      output: { format: "image/png", quality: 1 },
    });
    const resultDataUrl = await blobToDataUrl(resultBlob);

    // Nettoyage fin après l'IA (rogner + seuillage adaptatif)
    return await keepInkOnly(resultDataUrl);
  } catch (error) {
    console.warn("removeBackground AI failed — fallback to pixel‑based extraction.", error);
  }

  // ── 2. Fallback pixel (instantané, aucun réseau) ──────────
  const originalDataUrl = await readFileAsDataUrl(file);
  return await keepInkOnly(originalDataUrl);
}

// ────────────────────────────────────────────────────────────
//  keepInkOnly
//  Transforme tout pixel qui n'est pas une trace d'encre en
//  pixel transparent.
//  Utilise un seuil adaptatif calculé sur la luminance moyenne
//  de l'image pour s'adapter aux fonds clairs comme aux fonds
//  légèrement gris.
// ────────────────────────────────────────────────────────────

async function keepInkOnly(dataUrl: string): Promise<string> {
  const image = await loadImage(dataUrl);

  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;

  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Impossible de préparer l'image de signature.");

  ctx.drawImage(image, 0, 0);

  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const { data } = imageData;

  // ── Calculer la luminance moyenne des pixels non‑transparents
  let totalLuminance = 0;
  let counted = 0;
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const a = data[i + 3];

    if (a > 50) {
      // Luminosité perçue (ITU-R BT.709)
      totalLuminance += 0.2126 * r + 0.7152 * g + 0.0722 * b;
      counted++;
    }
  }
  const avgLuminance = counted > 0 ? totalLuminance / counted : 128;

  // Seuil adaptatif : plus l'image est claire, plus on exige
  // que l'encre soit foncée pour être conservée.
  const adaptiveThreshold = Math.max(40, Math.min(160, avgLuminance - 30));

  // ── Classifier chaque pixel
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const a = data[i + 3];

    if (a === 0) continue;

    // Luminosité relative (ITU-R BT.601)
    const luminance = 0.299 * r + 0.587 * g + 0.114 * b;

    // Saturation : écart entre le canal le plus fort et le plus faible
    const maxChannel = Math.max(r, g, b);
    const minChannel = Math.min(r, g, b);
    const saturation = maxChannel - minChannel;

    // Est‑ce que ce pixel ressemble à de l'encre ?
    const isDark = luminance < adaptiveThreshold;
    const isColoredInk = saturation > 30 && maxChannel > 60 && luminance < 200;

    if (isDark || isColoredInk) {
      // Encre → on renforce l'opacité tout en gardant l'anti‑aliasing
      data[i + 3] = Math.max(a, 220);
    } else {
      // Fond → transparent
      data[i + 3] = 0;
    }
  }

  ctx.putImageData(imageData, 0, 0);

  // ── Rogner les marges transparentes
  const trimmedCanvas = trimTransparentEdges(canvas);

  // ── Redimensionner si nécessaire
  const finalCanvas = resizeIfNeeded(trimmedCanvas, 800);

  return finalCanvas.toDataURL("image/png");
}

// ────────────────────────────────────────────────────────────
//  trimTransparentEdges — supprime les bandes vides autour du
//  contenu visible.
// ────────────────────────────────────────────────────────────

function trimTransparentEdges(source: HTMLCanvasElement): HTMLCanvasElement {
  const ctx = source.getContext("2d");
  if (!ctx) return source;

  const { width, height } = source;
  const imageData = ctx.getImageData(0, 0, width, height);
  const { data } = imageData;

  let top = height,
    bottom = 0,
    left = width,
    right = 0;

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

// ────────────────────────────────────────────────────────────
//  resizeIfNeeded — redimensionne si la plus grande dimension
//  dépasse maxPx, en conservant le ratio.
// ────────────────────────────────────────────────────────────

function resizeIfNeeded(source: HTMLCanvasElement, maxPx: number): HTMLCanvasElement {
  const { width, height } = source;
  if (width <= maxPx && height <= maxPx) return source;

  const ratio = Math.min(maxPx / width, maxPx / height);
  const newWidth = Math.round(width * ratio);
  const newHeight = Math.round(height * ratio);

  const canvas = document.createElement("canvas");
  canvas.width = newWidth;
  canvas.height = newHeight;

  const ctx = canvas.getContext("2d");
  if (!ctx) return source;

  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(source, 0, 0, newWidth, newHeight);
  return canvas;
}

// ────────────────────────────────────────────────────────────
//  Utilitaires
// ────────────────────────────────────────────────────────────

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
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
