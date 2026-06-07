"use client";

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
} from "react";
import { Button } from "./Button";
import {
  FORMAT_HINT,
  getPdfPageCount,
  isMobileCaptureDevice,
  isSupportedTicketFile,
  processTicketImage,
  type QualityWarnings,
} from "./ticket-capture-utils";

export type ProcessedTicketCapture = {
  file: File;
  previewUrl: string;
  isPdf: boolean;
  pageCount: number;
  selectedPage: number;
  warnings: QualityWarnings;
};

export interface TicketUploadCaptureProps {
  capture: ProcessedTicketCapture | null;
  onCaptureReady: (capture: ProcessedTicketCapture) => void;
  onCaptureClear: () => void;
  disabled?: boolean;
  /** When true, opens the device camera picker once on mount. */
  autoOpenCamera?: boolean;
  onAutoOpenCameraHandled?: () => void;
}

const PROCESSING_MILESTONES = [
  { at: 12, label: "Reading file…" },
  { at: 32, label: "Correcting orientation…" },
  { at: 52, label: "Compressing image…" },
  { at: 72, label: "Checking quality…" },
  { at: 92, label: "Preparing preview…" },
] as const;

const UPL_DISCLOSURE =
  "This automated document-drafting platform helps self-represented users prepare appeal documents under the user's sole direction and control. It does not provide legal advice and does not establish an attorney-client relationship.";

function processingLabel(progress: number): string {
  const step = [...PROCESSING_MILESTONES].reverse().find((m) => progress >= m.at);
  return step?.label ?? "Processing…";
}

function buildRawFileFallback(file: File, isPdf: boolean): ProcessedTicketCapture {
  return {
    file,
    previewUrl: URL.createObjectURL(file),
    isPdf,
    pageCount: 1,
    selectedPage: 1,
    warnings: {},
  };
}

export default function TicketUploadCapture({
  capture,
  onCaptureReady,
  onCaptureClear,
  disabled = false,
  autoOpenCamera = false,
  onAutoOpenCameraHandled,
}: TicketUploadCaptureProps) {
  const disclosureId = useId();
  const formatHintId = useId();
  const errorId = useId();
  const galleryInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const pdfPreviewRef = useRef<HTMLObjectElement>(null);

  const [isDragging, setIsDragging] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [formatError, setFormatError] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [processingProgress, setProcessingProgress] = useState(0);
  const [selectedPage, setSelectedPage] = useState(1);

  useEffect(() => {
    setIsMobile(isMobileCaptureDevice());
  }, []);

  useEffect(() => {
    if (capture?.isPdf) {
      setSelectedPage(capture.selectedPage);
    }
  }, [capture]);

  useEffect(() => {
    if (!autoOpenCamera || disabled || isProcessing || capture) return;
    const timer = window.setTimeout(() => {
      cameraInputRef.current?.click();
      onAutoOpenCameraHandled?.();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [
    autoOpenCamera,
    capture,
    disabled,
    isProcessing,
    onAutoOpenCameraHandled,
  ]);

  const runProcessingProgress = useCallback(async () => {
    setProcessingProgress(0);
    for (const milestone of PROCESSING_MILESTONES) {
      setProcessingProgress(milestone.at);
      await new Promise((r) => setTimeout(r, 120));
    }
    setProcessingProgress(100);
  }, []);

  const handleIncomingFile = useCallback(
    async (file: File) => {
      setFormatError(null);

      if (!isSupportedTicketFile(file)) {
        setFormatError("Unsupported format. Please upload a JPG, PNG, or PDF file.");
        return;
      }
      if (file.size > 10 * 1024 * 1024) {
        setFormatError("File is too large. Please keep uploads under 10MB.");
        return;
      }

      setIsProcessing(true);
      await runProcessingProgress();

      const isPdf =
        file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");

      try {
        if (isPdf) {
          let pageCount = 1;
          try {
            pageCount = await getPdfPageCount(file);
          } catch (pdfErr) {
            console.error("TicketUploadCapture: PDF page count failed", pdfErr);
          }
          onCaptureReady({
            file,
            previewUrl: URL.createObjectURL(file),
            isPdf: true,
            pageCount,
            selectedPage: 1,
            warnings: {},
          });
        } else {
          const result = await processTicketImage(file);
          onCaptureReady({
            file: result.file,
            previewUrl: result.previewDataUrl,
            isPdf: false,
            pageCount: 1,
            selectedPage: 1,
            warnings: result.warnings,
          });
        }
      } catch (err) {
        console.error("TicketUploadCapture: processing failed, using raw file", err);
        try {
          onCaptureReady(buildRawFileFallback(file, isPdf));
        } catch (fallbackErr) {
          console.error("TicketUploadCapture: raw file fallback failed", fallbackErr);
        }
      } finally {
        setIsProcessing(false);
        setProcessingProgress(0);
      }
    },
    [onCaptureClear, onCaptureReady, runProcessingProgress],
  );

  const onFileInputChange = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      e.target.value = "";
      if (file) void handleIncomingFile(file);
    },
    [handleIncomingFile],
  );

  const onDrop = useCallback(
    (e: DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      setIsDragging(false);
      const file = e.dataTransfer.files[0];
      if (file) void handleIncomingFile(file);
    },
    [handleIncomingFile],
  );

  const clearCapture = useCallback(() => {
    if (capture?.isPdf && capture.previewUrl.startsWith("blob:")) {
      URL.revokeObjectURL(capture.previewUrl);
    }
    setFormatError(null);
    setSelectedPage(1);
    onCaptureClear();
    if (galleryInputRef.current) galleryInputRef.current.value = "";
    if (cameraInputRef.current) cameraInputRef.current.value = "";
  }, [capture, onCaptureClear]);

  const updatePdfPage = useCallback(
    (page: number) => {
      if (!capture?.isPdf) return;
      setSelectedPage(page);
      onCaptureReady({ ...capture, selectedPage: page });
    },
    [capture, onCaptureReady],
  );

  const openGallery = useCallback(() => {
    galleryInputRef.current?.click();
  }, []);

  const openCamera = useCallback(() => {
    cameraInputRef.current?.click();
  }, []);

  const showPreview = capture && !isProcessing;
  const dropZoneBusy = disabled || isProcessing;

  return (
    <div className="mt-8 space-y-4" data-testid="ticket-upload-capture">
      <div
        className="rounded-xl border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-700 dark:bg-zinc-900/50"
        data-testid="upload-upl-disclosure"
        role="note"
        aria-labelledby={disclosureId}
      >
        <p
          id={disclosureId}
          className="text-xs font-semibold uppercase tracking-wide text-violet-700 dark:text-violet-400 mb-2"
        >
          Regulatory disclosure
        </p>
        <p className="text-xs text-zinc-700 dark:text-zinc-300 leading-relaxed">
          {UPL_DISCLOSURE}
        </p>
      </div>

      <input
        ref={galleryInputRef}
        type="file"
        accept="image/jpeg,image/png,application/pdf,.jpg,.jpeg,.png,.pdf"
        className="sr-only"
        disabled={dropZoneBusy}
        aria-label="Choose ticket file from device"
        data-testid="upload-file-input"
        onChange={onFileInputChange}
      />
      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="sr-only"
        disabled={dropZoneBusy}
        aria-label="Take ticket photo with camera"
        data-testid="upload-camera-input"
        onChange={onFileInputChange}
      />

      {!showPreview && (
        <div
          role="button"
          tabIndex={0}
          aria-label="Upload parking ticket photo or PDF"
          aria-describedby={`${formatHintId}${formatError ? ` ${errorId}` : ""}`}
          className={`drop-zone drop-zone-scaled ${isDragging ? "active" : ""} ${
            dropZoneBusy ? "opacity-60 pointer-events-none" : ""
          }`}
          data-testid="upload-dropzone"
          onDragOver={(e) => {
            e.preventDefault();
            if (!dropZoneBusy) setIsDragging(true);
          }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={onDrop}
          onClick={() => {
            if (!dropZoneBusy) openGallery();
          }}
          onKeyDown={(e) => {
            if (dropZoneBusy) return;
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              openGallery();
            }
          }}
        >
          <svg
            className="w-10 h-10 mx-auto mb-4 text-violet-600"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            aria-hidden
          >
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="17 8 12 3 7 8" />
            <line x1="12" y1="3" x2="12" y2="15" />
          </svg>
          <p className="font-medium text-zinc-800 dark:text-zinc-200">
            {isMobile ? "Take a photo or upload your ticket" : "Drag and drop your ticket photo"}
          </p>
          <p id={formatHintId} className="mt-1 text-sm text-zinc-500">
            {isMobile
              ? `Tap to use your camera, or choose a file — ${FORMAT_HINT}`
              : `or click to browse — ${FORMAT_HINT}`}
          </p>
        </div>
      )}

      {isMobile && !showPreview && (
        <Button
          type="button"
          variant="secondary"
          fullWidth
          disabled={dropZoneBusy}
          onClick={openCamera}
          data-testid="upload-take-photo-button"
          aria-label="Take photo with device camera"
        >
          Take photo
        </Button>
      )}

      {formatError && (
        <p
          id={errorId}
          role="alert"
          className="text-sm text-red-600 dark:text-red-400"
          data-testid="upload-format-error"
        >
          {formatError}
        </p>
      )}

      {isProcessing && (
        <div
          className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-700 dark:bg-zinc-950"
          data-testid="upload-processing-panel"
          aria-live="polite"
          aria-busy="true"
        >
          <div className="flex items-center justify-between text-sm mb-2">
            <span className="text-zinc-600 dark:text-zinc-400">
              {processingLabel(processingProgress)}
            </span>
            <span className="font-medium text-violet-700 dark:text-violet-400">
              {Math.round(processingProgress)}%
            </span>
          </div>
          <div
            className="progress-bar"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(processingProgress)}
            aria-label="Image processing progress"
          >
            <div
              className="progress-bar-fill"
              style={{ width: `${processingProgress}%` }}
              data-testid="upload-processing-bar"
            />
          </div>
        </div>
      )}

      {showPreview && (
        <div
          className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-700 dark:bg-zinc-950 space-y-4"
          data-testid="upload-preview-panel"
        >
          <div className="flex items-start gap-4">
            {capture.isPdf ? (
              <div className="flex-1 min-w-0">
                <object
                  ref={pdfPreviewRef}
                  data={`${capture.previewUrl}#page=${selectedPage}`}
                  type="application/pdf"
                  className="w-full h-48 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-100 dark:bg-zinc-900"
                  aria-label={`PDF preview, page ${selectedPage} of ${capture.pageCount}`}
                  data-testid="upload-pdf-preview"
                >
                  <p className="text-sm text-zinc-500 p-4">PDF preview unavailable in this browser.</p>
                </object>
              </div>
            ) : (
              <img
                src={capture.previewUrl}
                alt="Preview of uploaded parking ticket"
                className="w-28 h-28 sm:w-36 sm:h-36 object-cover rounded-lg border border-zinc-200 dark:border-zinc-700 shrink-0"
                data-testid="upload-image-preview"
              />
            )}
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100 truncate">
                {capture.file.name}
              </p>
              <p className="text-xs text-zinc-500 mt-1">
                {(capture.file.size / (1024 * 1024)).toFixed(2)} MB
                {capture.isPdf ? ` · ${capture.pageCount} page${capture.pageCount === 1 ? "" : "s"}` : " · Compressed"}
              </p>
              {capture.isPdf && capture.pageCount > 1 && (
                <div className="mt-3">
                  <label htmlFor="pdf-page-select" className="text-xs font-medium text-zinc-700 dark:text-zinc-300">
                    Preview page
                  </label>
                  <select
                    id="pdf-page-select"
                    value={selectedPage}
                    onChange={(e) => updatePdfPage(Number(e.target.value))}
                    className="input-strike mt-1 w-full text-sm"
                    data-testid="upload-pdf-page-select"
                    aria-label={`Select PDF page, ${capture.pageCount} pages total`}
                  >
                    {Array.from({ length: capture.pageCount }, (_, i) => i + 1).map((page) => (
                      <option key={page} value={page}>
                        Page {page} of {capture.pageCount}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>
          </div>

          {capture.warnings.blurry && (
            <p
              role="status"
              className="text-sm text-zinc-700 dark:text-zinc-300 bg-zinc-100 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-lg px-3 py-2"
              data-testid="upload-blur-warning"
            >
              Image may be blurry — consider retaking.
            </p>
          )}
          {capture.warnings.lowLight && (
            <p
              role="status"
              className="text-sm text-zinc-700 dark:text-zinc-300 bg-zinc-100 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-lg px-3 py-2"
              data-testid="upload-lowlight-warning"
            >
              This photo looks dark — try brighter lighting before capture.
            </p>
          )}

          <div className="flex flex-col sm:flex-row gap-2">
            {isMobile && (
              <Button
                type="button"
                variant="secondary"
                onClick={openCamera}
                data-testid="upload-retake-button"
                aria-label="Retake photo with camera"
              >
                Retake photo
              </Button>
            )}
            <Button
              type="button"
              variant="secondary"
              onClick={openGallery}
              data-testid="upload-replace-button"
              aria-label="Choose a different file"
            >
              Choose different file
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={clearCapture}
              data-testid="upload-clear-button"
              aria-label="Remove uploaded file"
            >
              Remove
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}