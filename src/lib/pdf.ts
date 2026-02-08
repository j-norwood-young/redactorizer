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
