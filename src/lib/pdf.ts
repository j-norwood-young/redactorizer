import * as pdfjsLib from "pdfjs-dist";
import pdfWorker from "pdfjs-dist/build/pdf.worker.mjs?url";

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker as string;

export type PDFDocumentProxy = pdfjsLib.PDFDocumentProxy;
export type PDFPageProxy = pdfjsLib.PDFPageProxy;

/**
 * Load a PDF document from binary data. Returns the document proxy (use getPage, numPages).
 */
export async function loadPdfDocument(data: ArrayBuffer): Promise<PDFDocumentProxy> {
  const loadingTask = pdfjsLib.getDocument({ data });
  const pdf = await loadingTask.promise;
  return pdf;
}

/**
 * Render a single PDF page to a PNG data URL at the given scale (e.g. 2 for 2x resolution).
 */
export async function renderPageToDataUrl(
  page: PDFPageProxy,
  scale: number
): Promise<string> {
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not get canvas 2d context");
  await page.render({
    canvasContext: ctx,
    canvas,
    viewport,
  }).promise;
  return canvas.toDataURL("image/png");
}

/**
 * Target viewport width for thumbnails (CSS pixels).
 */
export const THUMBNAIL_VIEWPORT_WIDTH = 140;

/**
 * Render a PDF page to a PNG data URL sized for thumbnails (fixed width).
 */
export async function renderPageThumbnail(page: PDFPageProxy): Promise<string> {
  const viewport1 = page.getViewport({ scale: 1 });
  const scale = THUMBNAIL_VIEWPORT_WIDTH / viewport1.width;
  return renderPageToDataUrl(page, scale);
}

/** Decode base64 PNG string to Uint8Array for pdf-lib. */
function base64ToUint8Array(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export interface PdfPageImage {
  /** PNG image as base64 (no data URL prefix). */
  base64Png: string;
  width: number;
  height: number;
}

/** Ensure dimension is a valid number for pdf-lib (no NaN/undefined). */
function validDimension(n: number, fallback: number): number {
  const v = Number(n);
  return Number.isFinite(v) && v > 0 ? Math.round(v) : fallback;
}

/**
 * Create a single PDF from redaction-safe page images (one page per image).
 * Returns the PDF file as base64 for saving.
 */
export async function createPdfFromPageImages(pages: PdfPageImage[]): Promise<string> {
  const { PDFDocument } = await import("pdf-lib");
  const doc = await PDFDocument.create();
  for (const { base64Png, width, height } of pages) {
    const w = validDimension(width, 612);
    const h = validDimension(height, 792);
    const page = doc.addPage([w, h]);
    const imageBytes = base64ToUint8Array(base64Png);
    const image = await doc.embedPng(imageBytes);
    page.drawImage(image, { x: 0, y: 0, width: w, height: h });
  }
  const pdfBytes = await doc.save();
  const arr = new Uint8Array(pdfBytes);
  const chunk = 8192;
  let binary = "";
  for (let i = 0; i < arr.length; i += chunk) {
    binary += String.fromCharCode(...arr.subarray(i, i + chunk));
  }
  return btoa(binary);
}
