/**
 * Client-side ticket photo processing: EXIF orientation, compression,
 * blur / low-light analysis, and PDF page metadata.
 */

import { createManagedCanvas } from "./canvas-memory";

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
export const MAX_COMPRESSED_BYTES = 2 * 1024 * 1024;
export const SUPPORTED_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "application/pdf",
] as const;

export const FORMAT_HINT = "Supports JPG, PNG, PDF — max 10MB";

const BLUR_VARIANCE_THRESHOLD = 120;
const LOW_LIGHT_BRIGHTNESS_THRESHOLD = 80;

export type QualityWarnings = {
  blurry?: boolean;
  lowLight?: boolean;
};

export type ProcessedImageResult = {
  file: File;
  previewDataUrl: string;
  warnings: QualityWarnings;
};

function loadImageFromUrl(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Failed to load image"));
    img.src = url;
  });
}

/** Parse JPEG EXIF orientation tag (1–8). Returns 1 when unknown or not JPEG. */
export function readExifOrientation(buffer: ArrayBuffer): number {
  const view = new DataView(buffer);
  if (view.byteLength < 4 || view.getUint16(0, false) !== 0xffd8) {
    return 1;
  }

  let offset = 2;
  while (offset + 4 < view.byteLength) {
    const marker = view.getUint16(offset, false);
    offset += 2;

    if (marker === 0xffe1) {
      const segmentLength = view.getUint16(offset, false);
      const segmentStart = offset + 2;
      if (segmentStart + 6 > view.byteLength) return 1;

      const exifHeader = view.getUint32(segmentStart, false);
      if (exifHeader !== 0x45786966) return 1;

      const tiffOffset = segmentStart + 6;
      if (tiffOffset + 8 > view.byteLength) return 1;

      const littleEndian = view.getUint16(tiffOffset, false) === 0x4949;
      const getUint16 = (pos: number) => view.getUint16(pos, littleEndian);
      const getUint32 = (pos: number) => view.getUint32(pos, littleEndian);

      const ifdOffset = tiffOffset + getUint32(tiffOffset + 4);
      if (ifdOffset + 2 > view.byteLength) return 1;

      const entryCount = getUint16(ifdOffset);
      for (let i = 0; i < entryCount; i++) {
        const entryOffset = ifdOffset + 2 + i * 12;
        if (entryOffset + 12 > view.byteLength) break;
        const tag = getUint16(entryOffset);
        if (tag === 0x0112) {
          return getUint16(entryOffset + 8) || 1;
        }
      }
      return 1;
    }

    if ((marker & 0xff00) !== 0xff00) break;
    const size = view.getUint16(offset, false);
    if (size < 2) break;
    offset += size;
  }

  return 1;
}

function orientedDimensions(
  width: number,
  height: number,
  orientation: number,
): { width: number; height: number } {
  if (orientation >= 5 && orientation <= 8) {
    return { width: height, height: width };
  }
  return { width, height };
}

function drawOrientedImage(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  orientation: number,
): void {
  const { width, height } = orientedDimensions(
    img.naturalWidth,
    img.naturalHeight,
    orientation,
  );

  ctx.save();
  switch (orientation) {
    case 2:
      ctx.translate(width, 0);
      ctx.scale(-1, 1);
      break;
    case 3:
      ctx.translate(width, height);
      ctx.rotate(Math.PI);
      break;
    case 4:
      ctx.translate(0, height);
      ctx.scale(1, -1);
      break;
    case 5:
      ctx.translate(height, 0);
      ctx.rotate(Math.PI / 2);
      ctx.scale(-1, 1);
      break;
    case 6:
      ctx.translate(height, 0);
      ctx.rotate(Math.PI / 2);
      break;
    case 7:
      ctx.translate(0, width);
      ctx.rotate(-Math.PI / 2);
      ctx.scale(-1, 1);
      break;
    case 8:
      ctx.translate(0, width);
      ctx.rotate(-Math.PI / 2);
      break;
    default:
      break;
  }
  ctx.drawImage(img, 0, 0);
  ctx.restore();
}

function computeLaplacianVariance(imageData: ImageData): number {
  const { data, width, height } = imageData;
  const gray = new Float32Array(width * height);

  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    gray[p] = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
  }

  let sum = 0;
  let sumSq = 0;
  let count = 0;

  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const idx = y * width + x;
      const laplacian =
        -gray[idx - width] -
        gray[idx - 1] +
        4 * gray[idx] -
        gray[idx + 1] -
        gray[idx + width];
      sum += laplacian;
      sumSq += laplacian * laplacian;
      count++;
    }
  }

  if (count === 0) return 0;
  const mean = sum / count;
  return sumSq / count - mean * mean;
}

function computeAverageBrightness(imageData: ImageData): number {
  const { data } = imageData;
  let total = 0;
  const pixels = data.length / 4;
  for (let i = 0; i < data.length; i += 4) {
    total += (data[i] + data[i + 1] + data[i + 2]) / 3;
  }
  return total / pixels;
}

function analyzeImageQuality(ctx: CanvasRenderingContext2D, width: number, height: number): QualityWarnings {
  const sampleWidth = Math.min(width, 320);
  const sampleHeight = Math.min(height, 320);
  const { ctx: sampleCtx, release } = createManagedCanvas(sampleWidth, sampleHeight);
  try {
    sampleCtx.drawImage(
      ctx.canvas,
      0,
      0,
      width,
      height,
      0,
      0,
      sampleWidth,
      sampleHeight,
    );
    const imageData = sampleCtx.getImageData(0, 0, sampleWidth, sampleHeight);
    const variance = computeLaplacianVariance(imageData);
    const brightness = computeAverageBrightness(imageData);
    const warnings: QualityWarnings = {};
    if (variance < BLUR_VARIANCE_THRESHOLD) {
      warnings.blurry = true;
    }
    if (brightness < LOW_LIGHT_BRIGHTNESS_THRESHOLD) {
      warnings.lowLight = true;
    }
    return warnings;
  } finally {
    release();
  }
}

async function canvasToBlob(
  canvas: HTMLCanvasElement,
  type: string,
  quality: number,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("Canvas export failed"))),
      type,
      quality,
    );
  });
}

export function isSupportedTicketFile(file: File): boolean {
  const mime = file.type.toLowerCase();
  if (SUPPORTED_MIME_TYPES.includes(mime as (typeof SUPPORTED_MIME_TYPES)[number])) {
    return true;
  }
  const name = file.name.toLowerCase();
  return (
    name.endsWith(".jpg") ||
    name.endsWith(".jpeg") ||
    name.endsWith(".png") ||
    name.endsWith(".pdf")
  );
}

export function formatErrorMessage(file: File): string | null {
  if (!isSupportedTicketFile(file)) {
    return "Unsupported format. Please upload a JPG, PNG, or PDF file.";
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return "File is too large. Please keep uploads under 10MB.";
  }
  return null;
}

export async function getPdfPageCount(file: File): Promise<number> {
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer.slice(0, Math.min(buffer.byteLength, 2 * 1024 * 1024)));
  const text = Array.from(bytes, (b) => String.fromCharCode(b)).join("");
  const matches = [...text.matchAll(/\/Count\s+(\d+)/g)];
  if (matches.length === 0) return 1;
  return Math.max(...matches.map((m) => parseInt(m[1], 10)));
}

export async function processTicketImage(file: File): Promise<ProcessedImageResult> {
  const buffer = await file.arrayBuffer();
  const orientation = file.type === "image/png" ? 1 : readExifOrientation(buffer);
  const blobUrl = URL.createObjectURL(file);

  try {
    const img = await loadImageFromUrl(blobUrl);
    const { width, height } = orientedDimensions(
      img.naturalWidth,
      img.naturalHeight,
      orientation,
    );

    let scale = 1;
    let quality = 0.88;
    let outputBlob: Blob | null = null;
    let outputDataUrl = "";
    let analysisCtx: CanvasRenderingContext2D | null = null;
    let analysisWidth = 0;
    let analysisHeight = 0;

    while (scale >= 0.35) {
      const targetWidth = Math.max(1, Math.round(width * scale));
      const targetHeight = Math.max(1, Math.round(height * scale));
      const { canvas, ctx, release } = createManagedCanvas(targetWidth, targetHeight);

      try {
        drawOrientedImage(ctx, img, orientation);
        analysisCtx = ctx;
        analysisWidth = targetWidth;
        analysisHeight = targetHeight;

        let attemptQuality = quality;
        while (attemptQuality >= 0.4) {
          const blob = await canvasToBlob(canvas, "image/jpeg", attemptQuality);
          if (blob.size <= MAX_COMPRESSED_BYTES) {
            outputBlob = blob;
            outputDataUrl = canvas.toDataURL("image/jpeg", attemptQuality);
            break;
          }
          attemptQuality -= 0.08;
        }

        if (outputBlob) break;
      } finally {
        release();
      }

      scale *= 0.85;
      quality = 0.82;
    }

    if (!outputBlob) {
      throw new Error("Could not compress image below 2MB");
    }

    const compressedFile = new File(
      [outputBlob],
      file.name.replace(/\.(png|jpe?g)$/i, ".jpg"),
      { type: "image/jpeg", lastModified: Date.now() },
    );

    const warnings =
      analysisCtx && analysisWidth && analysisHeight
        ? analyzeImageQuality(analysisCtx, analysisWidth, analysisHeight)
        : {};

    return {
      file: compressedFile,
      previewDataUrl: outputDataUrl,
      warnings,
    };
  } finally {
    URL.revokeObjectURL(blobUrl);
  }
}

export function isMobileCaptureDevice(): boolean {
  if (typeof window === "undefined") return false;
  const ua = navigator.userAgent;
  return (
    /Android|iPhone|iPad|iPod|webOS|BlackBerry|IEMobile|Opera Mini/i.test(ua) ||
    (navigator.maxTouchPoints > 1 && window.innerWidth < 1024)
  );
}