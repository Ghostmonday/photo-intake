# 📸 photo-intake

## Never see *"Could not process that file"* again.

[![MIT License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![npm version](https://img.shields.io/badge/npm-v1.0.0-green.svg)](https://www.npmjs.com/package/photo-intake)

A drop-in React component that eliminates the most frustrating error in every web app that accepts photo uploads.

---

## Before & After

**Before (typical upload component):**

> *"We could not process that file. Try a clearer photo or a different format."*

The user has no idea what went wrong. They retake the photo, get the same error, and leave. You get a support ticket you can't reproduce.

**After (photo-intake):**

| Problem | What Happens |
|---------|-------------|
| Image is sideways (EXIF rotation) | ✅ Auto-corrected — no user action needed |
| Image is too large | ✅ Compressed client-side to ≤2MB |
| Image is blurry | ⚠️ Gentle warning: "Image may be blurry — consider retaking" |
| Too dark | ⚠️ "Image appears poorly lit — consider better lighting" |
| PDF with multiple pages | ✅ Page count detected, page selector shown |
| Browser can't process the file | ✅ Falls back to raw file with silent log |
| User drags an unsupported format | ✅ Clear error: "Unsupported format. Use JPG, PNG, or PDF." |

**Zero generic errors. Every failure mode has a specific, helpful response.**

---

## Installation

```bash
npm install photo-intake
```

## One-line usage

```tsx
import { TicketUploadCapture } from "photo-intake";

function MyForm() {
  return (
    <TicketUploadCapture
      onCaptureReady={(c) => console.log("File:", c.file, "Preview:", c.previewUrl)}
      onCaptureClear={() => console.log("cleared")}
    />
  );
}
```

---

## The 13 Requirements

| # | Requirement | What It Does |
|---|-------------|-------------|
| 1 | **Mobile camera capture** | Opens native camera on mobile — `capture="environment"` |
| 2 | **Desktop file upload** | Click-to-browse file picker |
| 3 | **Drag-and-drop** | Visual hover state with border transition + scale effect |
| 4 | **Inline preview** | Shows image thumbnail or PDF embed immediately |
| 5 | **Client-side compression** | Canvas API compresses images to ≤2MB before any network request |
| 6 | **EXIF orientation correction** | Reads JPEG EXIF data and rotates the preview correctly |
| 7 | **Multi-page PDF support** | Detects page count, renders page preview, allows page selection |
| 8 | **Blur detection** | Laplacian variance analysis — warns if image is too blurry |
| 9 | **Low-light detection** | Average pixel brightness check — warns if too dark |
| 10 | **Determinate progress bar** | Milestone-based progress during processing and OCR |
| 11 | **Edit / replace option** | Retake, choose different file, or remove buttons after capture |
| 12 | **Format constraints shown** | Visible hint: "Supports JPG, PNG, PDF — max 10MB" |
| 13 | **Graceful fallback** | If ANY processing fails, uses raw file instead of showing "could not process" |

---

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `onCaptureReady` | `(capture: CaptureResult) => void` | **required** | Called with processed file + preview + warnings |
| `onCaptureClear` | `() => void` | **required** | Called when user clears or replaces the file |
| `autoOpenCamera` | `boolean` | `false` | Opens camera picker on mount |
| `maxSizeMB` | `number` | `10` | Max file size in MB |

---

## How It Works

```
User selects file
    │
    ├── Is JPG/PNG/PDF?  ──NO──→  Show specific format error
    │
    ├── Is < 10MB?  ──NO──→  Show size error
    │
    ├── Is PDF?  ──YES──→  Extract pages → show preview with page selector
    │
    └── Is image?  ──YES──→
         │
         1. Read EXIF orientation
         2. Load + rotate to correct orientation
         3. Compress iteratively until ≤2MB
         4. Check for blur (Laplacian variance)
         5. Check for low light (avg pixel brightness)
         │
         └── Success → return processed file + preview + any warnings
         └── Failure → return RAW FILE with warning logged
                        (user NEVER sees "could not process")
```

---

## Canvas Memory Management

iOS Safari imposes a 384MB aggregate canvas memory cap. photo-intake includes an automatic canvas memory manager that releases GPU/CPU memory after every processing pass, preventing tab crashes on mobile.

---

## Live Demo

**[https://ghostmonday.github.io/photo-intake/demo](https://ghostmonday.github.io/photo-intake/demo)**

Drag a photo onto the demo page and watch it get processed in real time — EXIF correction, compression, blur detection, everything.

---

## License

MIT — free for personal and commercial use. Go build something.

---

*Built by [Ghostmonday](https://github.com/Ghostmonday). Part of the ParkingBreaker ecosystem.*
