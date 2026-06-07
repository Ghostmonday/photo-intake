/**
 * Canvas Memory Manager
 *
 * iOS Safari imposes a 384MB aggregate canvas memory cap across all <canvas>
 * elements. Once exceeded, getContext("2d") returns null and the tab may crash.
 *
 * This module provides utilities for explicitly releasing canvas memory via the
 * releaseCanvas() teardown pattern, plus image cache eviction for the Safari
 * ~10MB cumulative <img> .src allocation ceiling.
 *
 * @see https://webkit.org/blog/10805/
 */

/**
 * Canonical teardown pattern for releasing canvas GPU/CPU memory.
 *
 * 1. Shrink canvas to 1×1px (releases GPU backing store)
 * 2. Clear rendering context
 * 3. Remove from DOM if attached
 *
 * Calling this after every captureFrame() / snapPhoto() / normalize pass
 * prevents aggregate canvas memory from exceeding Safari's ~384MB ceiling.
 */
export function releaseCanvas(canvas: HTMLCanvasElement | OffscreenCanvas | null): void {
  if (!canvas) return;

  // Shrink to minimal size to release backing store
  canvas.width = 1;
  canvas.height = 1;

  // Clear any remaining context state
  if ("getContext" in canvas && canvas instanceof HTMLCanvasElement) {
    const ctx = canvas.getContext("2d");
    if (ctx) {
      ctx.clearRect(0, 0, 1, 1);
    }
  }

  // Remove from DOM to allow GC
  if (canvas instanceof HTMLCanvasElement && canvas.parentNode) {
    canvas.parentNode.removeChild(canvas);
  }
}

/**
 * Evict an <img> element from Safari's image allocation pool.
 *
 * Safari tracks cumulative <img> .src memory (~10MB iPhone, ~6.5MB iPad).
 * Reassign src to a 1×1 blank GIF to release the previous allocation.
 */
export function evictImageCache(img: HTMLImageElement | null): void {
  if (!img) return;
  // 1×1 transparent GIF — smallest valid image data URL
  img.src =
    "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";
}

/**
 * Create a managed canvas with automatic cleanup tracking.
 *
 * Use this instead of document.createElement("canvas") directly.
 * The returned `release()` function must be called after use.
 *
 * @example
 * const { canvas, ctx, release } = createManagedCanvas(640, 480);
 * ctx.drawImage(video, 0, 0);
 * const dataUrl = canvas.toDataURL("image/jpeg", 0.8);
 * release(); // immediately frees memory
 */
export function createManagedCanvas(
  width: number,
  height: number,
): {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  release: () => void;
} {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext("2d");
  if (!ctx) {
    // If OOM, return a released wrapper — caller should check ctx before drawing
    releaseCanvas(canvas);
    throw new Error(
      "Canvas context unavailable — likely exceeded Safari 384MB aggregate limit. " +
        "Ensure releaseCanvas() is called after every previous capture.",
    );
  }

  return {
    canvas,
    ctx,
    release: () => releaseCanvas(canvas),
  };
}

/**
 * Create an offscreen canvas for image processing without DOM attachment.
 * Returns null if OffscreenCanvas is unsupported (Safari < 16.4).
 */
export function createOffscreenCanvas(
  width: number,
  height: number,
): OffscreenCanvas | null {
  if (typeof OffscreenCanvas === "undefined") {
    return null;
  }
  try {
    const canvas = new OffscreenCanvas(width, height);
    return canvas;
  } catch {
    return null;
  }
}

/**
 * Maximum dimension policy for client-side canvas operations.
 * Keeping canvases under 2048px on the longest edge ensures
 * single-canvas memory stays under ~16 MB (2048 × 2048 × 4 bytes).
 */
export const MAX_CANVAS_DIMENSION = 2048;

/**
 * Calculate dimensions that fit within MAX_CANVAS_DIMENSION while
 * maintaining aspect ratio.
 */
export function fitWithinMaxDimension(
  width: number,
  height: number,
): { width: number; height: number } {
  if (width <= MAX_CANVAS_DIMENSION && height <= MAX_CANVAS_DIMENSION) {
    return { width, height };
  }

  const ratio = Math.min(
    MAX_CANVAS_DIMENSION / width,
    MAX_CANVAS_DIMENSION / height,
  );

  return {
    width: Math.round(width * ratio),
    height: Math.round(height * ratio),
  };
}

/**
 * CanvasPool — manages a pool of reusable canvas elements to avoid
 * allocation churn. Max 2 concurrent canvases to stay within Safari limits.
 */
export class CanvasPool {
  private pool: HTMLCanvasElement[] = [];
  private active = 0;
  private readonly maxSize: number;

  constructor(maxSize = 2) {
    this.maxSize = maxSize;
  }

  acquire(width: number, height: number): {
    canvas: HTMLCanvasElement;
    ctx: CanvasRenderingContext2D;
  } | null {
    if (this.active >= this.maxSize) {
      return null; // pool exhausted — caller must release first
    }

    const canvas =
      this.pool.pop() ?? document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;

    const ctx = canvas.getContext("2d");
    if (!ctx) {
      releaseCanvas(canvas);
      return null;
    }

    this.active++;
    return { canvas, ctx };
  }

  release(canvas: HTMLCanvasElement | null): void {
    if (!canvas) return;
    releaseCanvas(canvas);
    this.active = Math.max(0, this.active - 1);
    this.pool.push(canvas);
  }

  drain(): void {
    for (const c of this.pool) {
      releaseCanvas(c);
    }
    this.pool = [];
    this.active = 0;
  }
}
