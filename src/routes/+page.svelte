<script lang="ts">
  import { invoke } from "@tauri-apps/api/core";
  import { listen } from "@tauri-apps/api/event";
  import type { Shape, ShapeType, EffectType, EffectOptions, DocumentSource, ShapesByPage } from "$lib/types/redactor";
  import {
    redrawCanvas,
    shapeAtPoint,
    shapeBounds,
    getHandleAtPoint,
    renderToPngBase64,
    type ResizeHandle,
  } from "$lib/redactorCanvas";
  import { loadPdfDocument, renderPageToDataUrl, renderPageThumbnail, type PDFDocumentProxy } from "$lib/pdf";
  import { ZoomIn, ZoomOut, Maximize2, Square, Circle, Pencil } from "@lucide/svelte";
  import {
    Button,
    Toolbar,
    ToolbarGroup,
    ErrorMessage,
    Placeholder,
    LoadingIndicator,
    EffectOptions as EffectOptionsComponent,
    ShapeOverlay,
    PageSidebar,
  } from "$lib/components";

  let canvasEl = $state<HTMLCanvasElement | null>(null);
  let canvasWrapEl = $state<HTMLDivElement | null>(null);
  let imageSource = $state<string | null>(null);
  let imageDimensions = $state<{ width: number; height: number } | null>(null);
  /** Full path when opened via dialog; null when pasted or dropped. */
  let sourceFilePath = $state<string | null>(null);
  /** Filename for save dialog default (e.g. "photo.jpg" or "pasted.png"). */
  let sourceFileName = $state<string>("redacted.png");
  /** Path we last saved to; when set, Save writes here without dialog. Cleared when opening a new image. */
  let lastSavedPath = $state<string | null>(null);
  /** Brief "Saved to …" message shown after a save. */
  let savedToast = $state<string | null>(null);
  /** Document: image (single page) or PDF (multi-page). Null when no document open. */
  let documentSource = $state<DocumentSource | null>(null);
  /** Current page index (0-based). For image docs always 0. */
  let currentPageIndex = $state(0);
  /** Shapes per page index. For image docs only key 0 is used. */
  let shapesByPage = $state<ShapesByPage>({});
  /** Derived: shapes for the current page. */
  let currentPageShapes = $derived(shapesByPage[currentPageIndex] ?? []);
  /** Loaded PDF document proxy (only set when documentSource.type === "pdf"). */
  let pdfDocRef = $state<PDFDocumentProxy | null>(null);
  /** Cached thumbnail data URLs per page index for PDF sidebar. */
  let pdfThumbnails = $state<Record<number, string>>({});
  /** Scale used when rendering PDF page to main canvas (2 = 2x for sharpness). */
  const PDF_PAGE_SCALE = 2;
  let tool = $state<ShapeType>("rectangle");
  let selectedEffect = $state<EffectType>("pixelate");
  let effectOptions = $state<EffectOptions>({
    fillColor: "#000000",
    fillOpacity: 1,
    pixelSize: 12,
    blurRadius: 20,
  });
  let isDrawing = $state(false);
  let drawStart = $state<{ x: number; y: number } | null>(null);
  let drawCurrent = $state<{ x: number; y: number } | null>(null);
  let freehandPoints = $state<number[]>([]);
  let saveError = $state<string | null>(null);
  let openError = $state<string | null>(null);
  let copyError = $state<string | null>(null);
  let shareError = $state<string | null>(null);

  const COMPATIBLE_IMAGE_TYPES = [
    "image/png",
    "image/jpeg",
    "image/jpg",
    "image/gif",
    "image/webp",
    "image/bmp",
  ];

  const COMPATIBLE_IMAGE_EXTENSIONS = [
    ".png",
    ".jpg",
    ".jpeg",
    ".gif",
    ".webp",
    ".bmp",
  ];

  function isCompatibleImageType(type: string): boolean {
    return COMPATIBLE_IMAGE_TYPES.some((t) => type === t || type.startsWith("image/"));
  }

  function isCompatibleImagePath(path: string): boolean {
    const lower = path.toLowerCase();
    return COMPATIBLE_IMAGE_EXTENSIONS.some((ext) => lower.endsWith(ext));
  }

  function isCompatibleDocumentPath(path: string): boolean {
    const lower = path.toLowerCase();
    return lower.endsWith(".pdf") || COMPATIBLE_IMAGE_EXTENSIONS.some((ext) => lower.endsWith(ext));
  }

  /** Default save filename: for image "-redacted.png", for PDF "-page-N.png". */
  function getDefaultSaveName(): string {
    const lastDot = sourceFileName.lastIndexOf(".");
    const stem = lastDot > 0 ? sourceFileName.slice(0, lastDot) : sourceFileName || "document";
    if (documentSource?.type === "pdf") {
      return `${stem}-page-${currentPageIndex + 1}.png`;
    }
    if (!sourceFileName || sourceFileName === "redacted.png") return "redacted.png";
    return `${stem}-redacted.png`;
  }

  /** Update shapes for the current page. */
  function setCurrentPageShapes(updater: (prev: Shape[]) => Shape[]) {
    const prev = shapesByPage[currentPageIndex] ?? [];
    shapesByPage = { ...shapesByPage, [currentPageIndex]: updater(prev) };
  }

  let selectedShapeIndex = $state<number | null>(null);
  let hoveredShapeIndex = $state<number | null>(null);
  let mouseOverImage = $state(false);
  let overlayRect = $state({ left: 0, top: 0, width: 0, height: 0 });
  /** Zoom level for document view (1 = 100%). */
  let zoomLevel = $state(1);
  /** When non-null, user is editing the zoom % input; value is the string in the input. */
  let zoomPercentInput = $state<string | null>(null);
  /** For pinch gesture: zoom level at gesture start. */
  let zoomAtGestureStart = $state(1);
  /** Shift key held — when drawing, constrains rectangle/ellipse to equal width/height. */
  let shiftKeyHeld = $state(false);

  const ZOOM_MIN = 0.01;
  const ZOOM_MAX = 3;
  const ZOOM_LEVELS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3];
  function zoomIn() {
    const i = ZOOM_LEVELS.indexOf(zoomLevel);
    if (i < ZOOM_LEVELS.length - 1) zoomLevel = ZOOM_LEVELS[i + 1];
    else if (zoomLevel < ZOOM_LEVELS[ZOOM_LEVELS.length - 1]) zoomLevel = Math.min(ZOOM_LEVELS[ZOOM_LEVELS.length - 1], zoomLevel + 0.25);
  }
  function zoomOut() {
    const i = ZOOM_LEVELS.indexOf(zoomLevel);
    if (i > 0) zoomLevel = ZOOM_LEVELS[i - 1];
    else if (zoomLevel > ZOOM_LEVELS[0]) zoomLevel = Math.max(ZOOM_LEVELS[0], zoomLevel - 0.25);
  }
  function zoomReset() {
    zoomLevel = 1;
  }
  /** Set zoom from a percentage number 0–300 (clamped). */
  function setZoomFromPercent(percent: number) {
    const clamped = Math.max(0, Math.min(300, percent));
    zoomLevel = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, clamped / 100));
  }
  /** Commit the zoom % input: parse, clamp 0–300, apply and clear edit state. */
  function commitZoomInput() {
    if (zoomPercentInput === null) return;
    const n = parseInt(zoomPercentInput, 10);
    if (!Number.isNaN(n)) setZoomFromPercent(n);
    zoomPercentInput = null;
  }
  /** Handle zoom via wheel (Cmd+scroll or trackpad pinch reported as ctrl+wheel). */
  function handleZoomWheel(e: WheelEvent) {
    if (!documentSource || !imageDimensions) return;
    if (e.metaKey || e.ctrlKey) {
      e.preventDefault();
      const delta = -Math.sign(e.deltaY);
      const factor = delta > 0 ? 1.1 : 0.9;
      zoomLevel = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, zoomLevel * factor));
    }
  }
  /** Handle Safari-style gesture events for pinch zoom. */
  function handleGestureStart(e: Event) {
    if (!documentSource) return;
    const ev = e as unknown as { scale?: number };
    zoomAtGestureStart = zoomLevel;
  }
  function handleGestureChange(e: Event) {
    if (!documentSource) return;
    e.preventDefault();
    const ev = e as unknown as { scale?: number };
    const scale = typeof ev.scale === "number" ? ev.scale : 1;
    zoomLevel = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, zoomAtGestureStart * scale));
  }
  /** Zoom so the document fits in the visible canvas area. */
  function zoomToFit() {
    if (!imageDimensions || !canvasWrapEl) return;
    const padding = 32;
    const w = canvasWrapEl.clientWidth - padding;
    const h = canvasWrapEl.clientHeight - padding;
    if (w <= 0 || h <= 0) return;
    const scale = Math.min(w / imageDimensions.width, h / imageDimensions.height);
    zoomLevel = Math.max(0.25, Math.min(3, scale));
  }
  /** When a new document finishes loading, apply zoom-to-fit (once per document, not on PDF page change). */
  let lastZoomFitDocKey = $state<string | null>(null);
  $effect(() => {
    const doc = documentSource;
    const dims = imageDimensions;
    const wrap = canvasWrapEl;
    if (!doc || !dims || !wrap) return;
    const docKey = doc.type === "pdf" ? doc.documentId : doc.dataUrl.slice(0, 100);
    if (docKey === lastZoomFitDocKey) return;
    lastZoomFitDocKey = docKey;
    requestAnimationFrame(() => {
      zoomToFit();
    });
  });
  $effect(() => {
    if (!documentSource) lastZoomFitDocKey = null;
  });
  /** Display size of the overlay (canvas) in pixels when zoomed. */
  let overlayDisplaySize = $derived(
    imageDimensions
      ? { width: imageDimensions.width * zoomLevel, height: imageDimensions.height * zoomLevel }
      : { width: 0, height: 0 }
  );

  type DragState =
    | { type: "move"; shapeIndex: number; startX: number; startY: number; startPoints: number[] }
    | {
        type: "resize";
        shapeIndex: number;
        handle: ResizeHandle;
        startX: number;
        startY: number;
        startBounds: { x: number; y: number; w: number; h: number };
      };
  let dragState = $state<DragState | null>(null);

  /** Load a PDF from base64 (used after open dialog, drop, or load from path). */
  async function loadPdfFromBase64(base64: string, fileName: string, filePath: string | null = null) {
    imageSource = null;
    imageDimensions = null;
    documentSource = null;
    pdfDocRef = null;
    sourceFilePath = filePath ?? null;
    sourceFileName = fileName;
    lastSavedPath = null;
    currentPageIndex = 0;
    shapesByPage = {};
    pdfThumbnails = {};
    selectedShapeIndex = null;
    hoveredShapeIndex = null;
    dragState = null;
    try {
      const binary = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
      const pdf = await loadPdfDocument(binary.buffer);
      documentSource = { type: "pdf", documentId: filePath ?? fileName, numPages: pdf.numPages };
      pdfDocRef = pdf;
      const page = await pdf.getPage(1);
      const dataUrl = await renderPageToDataUrl(page, PDF_PAGE_SCALE);
      imageSource = dataUrl;
    } catch (e) {
      openError = e instanceof Error ? e.message : String(e);
      documentSource = null;
      pdfDocRef = null;
    }
  }

  /** Open document (image or PDF) via file dialog. */
  async function openDocument() {
    openError = null;
    try {
      const result = await invoke<{ path: string; base64: string; format: string } | null>(
        "open_document_dialog"
      );
      if (!result) return;
      if (result.format === "image") {
        const dataUrl = `data:image/png;base64,${result.base64}`;
        imageDimensions = null;
        imageSource = dataUrl;
        documentSource = { type: "image", dataUrl };
        pdfDocRef = null;
        sourceFilePath = result.path;
        sourceFileName = result.path.split(/[/\\]/).pop() ?? "image.png";
        lastSavedPath = null;
        currentPageIndex = 0;
        shapesByPage = {};
        selectedShapeIndex = null;
        hoveredShapeIndex = null;
        dragState = null;
        return;
      }
      if (result.format === "pdf") {
        await loadPdfFromBase64(result.base64, result.path.split(/[/\\]/).pop() ?? "document.pdf");
      }
    } catch (e) {
      openError = e instanceof Error ? e.message : String(e);
    }
  }

  async function loadImageFromBytes(base64Any: string, fileName: string) {
    openError = null;
    try {
      const pngBase64 = await invoke<string>("any_image_to_png_base64", {
        base64Any,
      });
      const dataUrl = `data:image/png;base64,${pngBase64}`;
      imageDimensions = null;
      imageSource = dataUrl;
      documentSource = { type: "image", dataUrl };
      sourceFilePath = null;
      sourceFileName = fileName;
      lastSavedPath = null;
      currentPageIndex = 0;
      shapesByPage = {};
      selectedShapeIndex = null;
      hoveredShapeIndex = null;
      dragState = null;
    } catch (e) {
      openError = e instanceof Error ? e.message : String(e);
    }
  }

  /** Load image from a file path (e.g. from Tauri OS drag-drop). */
  async function loadImageFromPath(filePath: string) {
    openError = null;
    try {
      const [base64, name] = await invoke<[string, string]>("load_image_from_path", {
        path: filePath,
      });
      const dataUrl = `data:image/png;base64,${base64}`;
      imageDimensions = null;
      imageSource = dataUrl;
      documentSource = { type: "image", dataUrl };
      sourceFilePath = null;
      sourceFileName = name;
      lastSavedPath = null;
      currentPageIndex = 0;
      shapesByPage = {};
      selectedShapeIndex = null;
      hoveredShapeIndex = null;
      dragState = null;
    } catch (e) {
      openError = e instanceof Error ? e.message : String(e);
    }
  }

  /** Load document (image or PDF) from a file path (e.g. Tauri OS drag-drop). */
  async function loadDocumentFromPath(filePath: string) {
    openError = null;
    try {
      const result = await invoke<{ path: string; base64: string; format: string }>(
        "load_document_from_path",
        { path: filePath }
      );
      const name = result.path.split(/[/\\]/).pop() ?? "document";
      if (result.format === "image") {
        const dataUrl = `data:image/png;base64,${result.base64}`;
        imageDimensions = null;
        imageSource = dataUrl;
        documentSource = { type: "image", dataUrl };
        pdfDocRef = null;
        sourceFilePath = null;
        sourceFileName = name;
        lastSavedPath = null;
        currentPageIndex = 0;
        shapesByPage = {};
        selectedShapeIndex = null;
        hoveredShapeIndex = null;
        dragState = null;
        return;
      }
      if (result.format === "pdf") {
        await loadPdfFromBase64(result.base64, name, result.path);
      }
    } catch (e) {
      openError = e instanceof Error ? e.message : String(e);
    }
  }

  /** Paste image from system clipboard (Tauri plugin). */
  async function pasteImage() {
    openError = null;
    try {
      const base64 = await invoke<string>("plugin:clipboard|read_image_base64");
      if (!base64 || base64.length === 0) {
        openError = "No image in clipboard";
        return;
      }
      const dataUrl = `data:image/png;base64,${base64}`;
      imageDimensions = null;
      imageSource = dataUrl;
      documentSource = { type: "image", dataUrl };
      sourceFilePath = null;
      sourceFileName = "pasted.png";
      lastSavedPath = null;
      currentPageIndex = 0;
      shapesByPage = {};
      selectedShapeIndex = null;
      hoveredShapeIndex = null;
      dragState = null;
    } catch (e) {
      openError = e instanceof Error ? e.message : String(e);
    }
  }

  function fileToBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result;
        if (typeof result !== "string") reject(new Error("Expected string"));
        else resolve(result.replace(/^data:[^;]+;base64,/, ""));
      };
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });
  }

  function updateOverlayRect() {
    const canvas = canvasEl;
    const wrap = canvasWrapEl;
    if (!canvas || !wrap) return;
    const cr = canvas.getBoundingClientRect();
    const wr = wrap.getBoundingClientRect();
    overlayRect = {
      left: cr.left - wr.left + wrap.scrollLeft,
      top: cr.top - wr.top + wrap.scrollTop,
      width: cr.width,
      height: cr.height,
    };
  }

  $effect(() => {
    const canvas = canvasEl;
    const wrap = canvasWrapEl;
    if (!canvas || !wrap) return;
    updateOverlayRect();
    const ro = new ResizeObserver(() => updateOverlayRect());
    ro.observe(canvas);
    ro.observe(wrap);
    return () => ro.disconnect();
  });

  /** Cmd+scroll / pinch zoom (wheel) and Safari gesture events. */
  $effect(() => {
    const wrap = canvasWrapEl;
    if (!wrap) return;
    wrap.addEventListener("wheel", handleZoomWheel, { passive: false });
    wrap.addEventListener("gesturestart", handleGestureStart);
    wrap.addEventListener("gesturechange", handleGestureChange);
    return () => {
      wrap.removeEventListener("wheel", handleZoomWheel);
      wrap.removeEventListener("gesturestart", handleGestureStart);
      wrap.removeEventListener("gesturechange", handleGestureChange);
    };
  });

  function drawImageOnCanvas(img: HTMLImageElement) {
    const canvas = canvasEl;
    if (!canvas) return;
    const w = img.naturalWidth;
    const h = img.naturalHeight;
    canvas.width = w;
    canvas.height = h;
    imageDimensions = { width: w, height: h };
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(img, 0, 0);
  }

  /** Generate thumbnails for all PDF pages when a PDF is loaded. */
  $effect(() => {
    const doc = documentSource;
    const pdf = pdfDocRef;
    if (doc?.type !== "pdf" || !pdf) return;
    const numPages = doc.numPages;
    let cancelled = false;
    const acc: Record<number, string> = {};
    (async () => {
      for (let i = 0; i < numPages && !cancelled; i++) {
        try {
          const page = await pdf.getPage(i + 1);
          if (cancelled) return;
          const dataUrl = await renderPageThumbnail(page);
          if (cancelled) return;
          acc[i] = dataUrl;
          pdfThumbnails = { ...acc };
        } catch (_) {
          // skip failed page
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  });

  /** When PDF and current page changes, render that page to imageSource. */
  $effect(() => {
    const doc = documentSource;
    const pdf = pdfDocRef;
    const pageIndex = currentPageIndex;
    if (doc?.type !== "pdf" || !pdf || pageIndex < 0 || pageIndex >= doc.numPages) return;
    let cancelled = false;
    (async () => {
      try {
        const page = await pdf.getPage(pageIndex + 1);
        if (cancelled) return;
        const dataUrl = await renderPageToDataUrl(page, PDF_PAGE_SCALE);
        if (cancelled) return;
        imageSource = dataUrl;
      } catch (e) {
        if (!cancelled) openError = e instanceof Error ? e.message : String(e);
      }
    })();
    return () => {
      cancelled = true;
    };
  });

  $effect(() => {
    const src = imageSource;
    if (!src) {
      imageDimensions = null;
      return;
    }
    imageDimensions = null;
    const img = new Image();
    img.onload = () => drawImageOnCanvas(img);
    img.onerror = () => (openError = "Failed to load image");
    img.src = src;
  });

  function getExportBase64(): string | null {
    const canvas = canvasEl;
    if (!canvas || !documentSource) return null;
    const dataUrl = canvas.toDataURL("image/png");
    return dataUrl.replace(/^data:image\/png;base64,/, "");
  }

  function showSavedToast(path: string) {
    const name = path.split(/[/\\]/).pop() ?? path;
    savedToast = `Saved to ${name}`;
    const t = setTimeout(() => {
      savedToast = null;
    }, 3000);
    return () => clearTimeout(t);
  }

  async function saveImage() {
    saveError = null;
    const base64 = getExportBase64();
    if (!base64) {
      saveError = "No image to save";
      return;
    }
    try {
      const path = await invoke<string | null>("save_image", {
        base64Png: base64,
        overwritePath: lastSavedPath,
        defaultName: getDefaultSaveName(),
      });
      if (path) {
        lastSavedPath = path;
        showSavedToast(path);
      }
    } catch (e) {
      saveError = e instanceof Error ? e.message : String(e);
    }
  }

  async function saveImageAs() {
    saveError = null;
    const base64 = getExportBase64();
    if (!base64) {
      saveError = "No image to save";
      return;
    }
    try {
      const path = await invoke<string | null>("save_image", {
        base64Png: base64,
        overwritePath: null,
        defaultName: getDefaultSaveName(),
      });
      if (path) {
        lastSavedPath = path;
        showSavedToast(path);
      }
    } catch (e) {
      saveError = e instanceof Error ? e.message : String(e);
    }
  }

  async function copyImage() {
    copyError = null;
    const base64 = getExportBase64();
    if (!base64) {
      copyError = "No image to copy";
      return;
    }
    try {
      const sanitized = await invoke<string>("sanitize_image", { base64Png: base64 });
      await invoke("plugin:clipboard|write_image_base64", { base64Image: sanitized });
    } catch (e) {
      copyError = e instanceof Error ? e.message : String(e);
    }
  }

  async function shareImage() {
    shareError = null;
    const base64 = getExportBase64();
    if (!base64) {
      shareError = "No image to share";
      return;
    }
    try {
      const path = await invoke<string>("write_temp_image", { base64Png: base64 });
      try {
        await invoke("plugin:share|share_file", { path, mime: "image/png" });
      } catch {
        // Desktop: tauri-plugin-share only implements share_file on mobile; open with default app
        await invoke("share_image_open_with_app", { path });
      }
    } catch (e) {
      shareError = e instanceof Error ? e.message : String(e);
    }
  }

  /** Export all PDF pages as PNGs (one save dialog, then batch write). */
  async function exportAllPdfPages() {
    const doc = documentSource;
    if (doc?.type !== "pdf" || !pdfDocRef) return;
    saveError = null;
    const numPages = doc.numPages;
    const lastDot = sourceFileName.lastIndexOf(".");
    const stem = lastDot > 0 ? sourceFileName.slice(0, lastDot) : sourceFileName || "document";
    const defaultFirstName = `${stem}-page-1.png`;
    try {
      const base64s: string[] = [];
      for (let i = 0; i < numPages; i++) {
        const shapes = shapesByPage[i] ?? [];
        let imageSourcePage: string;
        let imageDimensionsPage: { width: number; height: number };
        if (i === currentPageIndex && imageSource && imageDimensions) {
          imageSourcePage = imageSource;
          imageDimensionsPage = imageDimensions;
        } else {
          const page = await pdfDocRef.getPage(i + 1);
          imageSourcePage = await renderPageToDataUrl(page, PDF_PAGE_SCALE);
          const img = new Image();
          imageDimensionsPage = await new Promise((resolve, reject) => {
            img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
            img.onerror = () => reject(new Error("Failed to load page image"));
            img.src = imageSourcePage;
          });
        }
        const base64 = await renderToPngBase64({
          imageSource: imageSourcePage,
          imageDimensions: imageDimensionsPage,
          shapes,
          effectOptions,
        });
        base64s.push(base64);
      }
      const path = await invoke<string | null>("save_images_batch", {
        base64Pngs: base64s,
        defaultFirstName,
      });
      if (path) showSavedToast(path);
    } catch (e) {
      saveError = e instanceof Error ? e.message : String(e);
    }
  }

  $effect(() => {
    let unlisten: (() => void) | undefined;
    listen<string>("menu-action", (event) => {
      switch (event.payload) {
        case "open":
          openDocument();
          break;
        case "save":
          saveImage();
          break;
        case "saveAs":
          saveImageAs();
          break;
        case "copy":
          copyImage();
          break;
        case "share":
          shareImage();
          break;
        case "paste":
          pasteImage();
          break;
        case "zoomIn":
          if (documentSource) zoomIn();
          break;
        case "zoomOut":
          if (documentSource) zoomOut();
          break;
        case "zoomToFit":
          if (documentSource) zoomToFit();
          break;
        case "zoomReset":
          if (documentSource) zoomReset();
          break;
      }
    }).then((fn) => {
      unlisten = fn;
    });
    return () => {
      unlisten?.();
    };
  });

  $effect(() => {
    let unlistenDrop: (() => void) | undefined;
    listen<{ paths: string[] }>("tauri://drag-drop", (event) => {
      const paths = event.payload?.paths ?? [];
      const docPath = paths.find((p) => isCompatibleDocumentPath(p));
      if (docPath) loadDocumentFromPath(docPath);
    }).then((fn) => {
      unlistenDrop = fn;
    });
    return () => {
      unlistenDrop?.();
    };
  });

  function getCanvasPoint(e: MouseEvent | PointerEvent): { x: number; y: number } | null {
    const canvas = canvasEl;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
    };
  }

  function applyMove(shape: Shape, dx: number, dy: number): Shape {
    if (shape.type === "rectangle" || shape.type === "square" || shape.type === "ellipse") {
      return { ...shape, points: [shape.points[0] + dx, shape.points[1] + dy, shape.points[2], shape.points[3]] };
    }
    if (shape.type === "circle") {
      return { ...shape, points: [shape.points[0] + dx, shape.points[1] + dy, shape.points[2]] };
    }
    if (shape.type === "freehand") {
      const pts = [...shape.points];
      for (let i = 0; i < pts.length; i += 2) {
        pts[i] += dx;
        pts[i + 1] += dy;
      }
      return { ...shape, points: pts };
    }
    return shape;
  }

  function applyResize(
    shape: Shape,
    handle: ResizeHandle,
    startBounds: { x: number; y: number; w: number; h: number },
    dx: number,
    dy: number,
    constrainAspect = false
  ): Shape {
    let { x, y, w, h } = startBounds;
    if (handle.includes("e")) w += dx;
    if (handle.includes("w")) {
      x += dx;
      w -= dx;
    }
    if (handle.includes("s")) h += dy;
    if (handle.includes("n")) {
      y += dy;
      h -= dy;
    }
    if (w < 4) w = 4;
    if (h < 4) h = 4;

    // When Shift is held, keep width and height equal (anchor = opposite corner/edge)
    if (constrainAspect && (shape.type === "rectangle" || shape.type === "square" || shape.type === "ellipse" || shape.type === "circle")) {
      const s = Math.max(w, h);
      switch (handle) {
        case "se":
          x = x;
          y = y;
          w = s;
          h = s;
          break;
        case "sw":
          x = x + w - s;
          y = y;
          w = s;
          h = s;
          break;
        case "ne":
          x = x;
          y = y + h - s;
          w = s;
          h = s;
          break;
        case "nw":
          x = x + w - s;
          y = y + h - s;
          w = s;
          h = s;
          break;
        case "e":
          x = x;
          y = y + h / 2 - s / 2;
          w = s;
          h = s;
          break;
        case "w":
          x = x + w - s;
          y = y + h / 2 - s / 2;
          w = s;
          h = s;
          break;
        case "n":
          x = x + w / 2 - s / 2;
          y = y + h - s;
          w = s;
          h = s;
          break;
        case "s":
          x = x + w / 2 - s / 2;
          y = y;
          w = s;
          h = s;
          break;
      }
    }

    if (shape.type === "rectangle") {
      return { ...shape, points: [x, y, w, h] };
    }
    if (shape.type === "square") {
      const d = Math.max(w, h);
      return { ...shape, points: [x, y, d, d] };
    }
    if (shape.type === "circle") {
      const cx = x + w / 2;
      const cy = y + h / 2;
      const r = Math.min(w, h) / 2;
      return { ...shape, points: [cx, cy, r] };
    }
    if (shape.type === "ellipse") {
      return { ...shape, points: [x, y, w, h] };
    }
    if (shape.type === "freehand" && shape.points.length >= 4) {
      const pts = shape.points;
      const oldB = shapeBounds(shape);
      const scaleX = w / oldB.w || 1;
      const scaleY = h / oldB.h || 1;
      const newPts: number[] = [];
      for (let i = 0; i < pts.length; i += 2) {
        newPts.push(x + (pts[i] - oldB.x) * scaleX, y + (pts[i + 1] - oldB.y) * scaleY);
      }
      return { ...shape, points: newPts };
    }
    return shape;
  }

  function handleShapePointerDown(index: number, e: PointerEvent) {
    selectedShapeIndex = index;
    const p = getCanvasPoint(e);
    if (!p) return;
    const shape = currentPageShapes[index];
    if (!shape) return;
    dragState = { type: "move", shapeIndex: index, startX: p.x, startY: p.y, startPoints: [...shape.points] };
  }

  function handleHandlePointerDown(handle: ResizeHandle, e: PointerEvent) {
    if (selectedShapeIndex === null) return;
    const p = getCanvasPoint(e);
    if (!p) return;
    const shape = currentPageShapes[selectedShapeIndex];
    if (!shape) return;
    const bounds = shapeBounds(shape);
    dragState = { type: "resize", shapeIndex: selectedShapeIndex, handle, startX: p.x, startY: p.y, startBounds: { ...bounds } };
  }

  function handlePointerMove(e: PointerEvent) {
    shiftKeyHeld = e.shiftKey;
    const p = getCanvasPoint(e);
    if (p !== null) {
      const idx = shapeAtPoint(currentPageShapes, p.x, p.y);
      hoveredShapeIndex = idx >= 0 ? idx : null;
    }
    if (dragState) {
      if (!p) return;
      if (dragState.type === "move") {
        const dx = p.x - dragState.startX;
        const dy = p.y - dragState.startY;
        const idx = dragState.shapeIndex;
        const startPoints = dragState.startPoints;
        setCurrentPageShapes((s) =>
          s.map((shape, i) =>
            i === idx ? applyMove({ ...shape, points: startPoints }, dx, dy) : shape
          )
        );
      } else {
        const d = dragState;
        const dx = p.x - d.startX;
        const dy = p.y - d.startY;
        const shape = currentPageShapes[d.shapeIndex];
        if (shape)
          setCurrentPageShapes((s) =>
            s.map((sh, i) =>
              i === d.shapeIndex ? applyResize(shape, d.handle, d.startBounds, dx, dy, e.shiftKey) : sh
            )
          );
      }
      return;
    }
    drawCurrent = p ?? drawCurrent;
    if (isDrawing && tool === "freehand" && p) freehandPoints = [...freehandPoints, p.x, p.y];
  }

  function handlePointerUp(e?: MouseEvent | PointerEvent) {
    if (dragState) {
      dragState = null;
      return;
    }
    if (!isDrawing || !drawStart || !drawCurrent || !imageDimensions) {
      isDrawing = false;
      drawStart = null;
      drawCurrent = null;
      return;
    }
    const [x0, y0] = [drawStart.x, drawStart.y];
    const [x1, y1] = [drawCurrent.x, drawCurrent.y];
    const constrainEqual = e?.shiftKey === true || (e == null && shiftKeyHeld);
    if (tool === "rectangle" || tool === "square") {
      let w = Math.abs(x1 - x0);
      let h = Math.abs(y1 - y0);
      if (constrainEqual) {
        const s = Math.max(w, h);
        w = s;
        h = s;
      }
      const x = x0 < x1 ? x0 : x0 - w;
      const y = y0 < y1 ? y0 : y0 - h;
      if (w >= 2 && h >= 2) {
        setCurrentPageShapes((prev) => [...prev, { type: "rectangle", points: [x, y, w, h], effect: selectedEffect }]);
        selectedShapeIndex = currentPageShapes.length;
      }
    } else if (tool === "ellipse" || tool === "circle") {
      let w = Math.abs(x1 - x0);
      let h = Math.abs(y1 - y0);
      if (constrainEqual) {
        const s = Math.max(w, h);
        w = s;
        h = s;
      }
      const x = x0 < x1 ? x0 : x0 - w;
      const y = y0 < y1 ? y0 : y0 - h;
      if (w >= 2 && h >= 2) {
        setCurrentPageShapes((prev) => [...prev, { type: "ellipse", points: [x, y, w, h], effect: selectedEffect }]);
        selectedShapeIndex = currentPageShapes.length;
      }
    } else if (tool === "freehand" && freehandPoints.length >= 4) {
      setCurrentPageShapes((prev) => [...prev, { type: "freehand", points: [...freehandPoints], effect: selectedEffect }]);
      selectedShapeIndex = currentPageShapes.length;
    }
    isDrawing = false;
    drawStart = null;
    drawCurrent = null;
    freehandPoints = [];
  }

  function pointerDown(e: MouseEvent) {
    shiftKeyHeld = e.shiftKey;
    const p = getCanvasPoint(e);
    if (!p || !imageDimensions) return;
    if (selectedShapeIndex !== null) {
      const bounds = shapeBounds(currentPageShapes[selectedShapeIndex]);
      const handle = getHandleAtPoint(bounds, p.x, p.y);
      if (handle) {
        dragState = {
          type: "resize",
          shapeIndex: selectedShapeIndex,
          handle,
          startX: p.x,
          startY: p.y,
          startBounds: { ...bounds },
        };
        return;
      }
    }
    const idx = shapeAtPoint(currentPageShapes, p.x, p.y);
    if (idx >= 0) {
      selectedShapeIndex = idx;
      dragState = {
        type: "move",
        shapeIndex: idx,
        startX: p.x,
        startY: p.y,
        startPoints: [...currentPageShapes[idx].points],
      };
      return;
    }
    selectedShapeIndex = null;
    isDrawing = true;
    drawStart = p;
    drawCurrent = p;
    if (tool === "freehand") freehandPoints = [p.x, p.y];
  }

  function pointerMove(e: MouseEvent | PointerEvent) {
    handlePointerMove(e as PointerEvent);
  }

  function pointerUp(e?: MouseEvent | PointerEvent) {
    handlePointerUp(e);
  }

  function deleteSelectedShape() {
    if (selectedShapeIndex === null) return;
    setCurrentPageShapes((prev) => prev.filter((_, i) => i !== selectedShapeIndex));
    selectedShapeIndex = null;
    dragState = null;
  }

  function setSelectedShapeEffect(effect: EffectType) {
    if (selectedShapeIndex === null) return;
    setCurrentPageShapes((prev) => prev.map((s, i) => (i === selectedShapeIndex ? { ...s, effect } : s)));
    selectedEffect = effect;
  }

  function setSelectedShapeStrength(value: number) {
    if (selectedShapeIndex === null) return;
    const shape = currentPageShapes[selectedShapeIndex];
    const effect = shape.effect;
    setCurrentPageShapes((prev) =>
      prev.map((s, i) => {
        if (i !== selectedShapeIndex) return s;
        if (effect === "pixelate") return { ...s, pixelSize: value };
        if (effect === "blur") return { ...s, blurRadius: value };
        return { ...s, fillOpacity: value };
      })
    );
  }

  function setSelectedShapeFillColor(color: string) {
    if (selectedShapeIndex === null) return;
    setCurrentPageShapes((prev) =>
      prev.map((s, i) => (i === selectedShapeIndex ? { ...s, fillColor: color } : s))
    );
    effectOptions = { ...effectOptions, fillColor: color };
  }

  $effect(() => {
    redrawCanvas({
      canvas: canvasEl,
      imageSource,
      imageDimensions,
      shapes: currentPageShapes,
      tool,
      isDrawing,
      drawStart,
      drawCurrent,
      freehandPoints,
      effectOptions,
      shiftKey: shiftKeyHeld,
    });
  });

  function onKeydown(e: KeyboardEvent) {
    if (e.key === "Shift") shiftKeyHeld = true;
    if (e.key === "Backspace" || e.key === "Delete") {
      if (selectedShapeIndex !== null) {
        e.preventDefault();
        deleteSelectedShape();
      }
      return;
    }
    const mod = e.metaKey || e.ctrlKey;
    if (mod && (e.key === "=" || e.key === "+")) {
      e.preventDefault();
      if (documentSource) zoomIn();
      return;
    }
    if (mod && e.key === "-") {
      e.preventDefault();
      if (documentSource) zoomOut();
      return;
    }
    if (mod && e.key === "0") {
      e.preventDefault();
      if (documentSource) zoomReset();
      return;
    }
    if (e.key === "o") {
      e.preventDefault();
      openDocument();
    } else if (e.key === "s") {
      e.preventDefault();
      if (documentSource) {
        if (e.shiftKey) saveImageAs();
        else saveImage();
      }
    } else if ((e.key === "v" || e.key === "V") && mod) {
      e.preventDefault();
      pasteImage();
    }
  }

  function onKeyup(e: KeyboardEvent) {
    if (e.key === "Shift") shiftKeyHeld = false;
  }

  $effect(() => {
    if (typeof document === "undefined") return;
    document.addEventListener("keydown", onKeydown);
    document.addEventListener("keyup", onKeyup);
    return () => {
      document.removeEventListener("keydown", onKeydown);
      document.removeEventListener("keyup", onKeyup);
    };
  });

  $effect(() => {
    if (typeof document === "undefined" || !dragState) return;
    document.addEventListener("pointermove", handlePointerMove);
    document.addEventListener("pointerup", handlePointerUp);
    document.addEventListener("pointercancel", handlePointerUp);
    return () => {
      document.removeEventListener("pointermove", handlePointerMove);
      document.removeEventListener("pointerup", handlePointerUp);
      document.removeEventListener("pointercancel", handlePointerUp);
    };
  });

  function onDragOver(e: DragEvent) {
    const hasFile = Array.from(e.dataTransfer?.items ?? []).some(
      (item) =>
        item.kind === "file" &&
        (isCompatibleImageType(item.type) || item.type === "application/pdf")
    );
    if (hasFile) {
      e.preventDefault();
      e.dataTransfer!.dropEffect = "copy";
    }
  }

  async function onDrop(e: DragEvent) {
    const file = e.dataTransfer?.files?.[0];
    if (!file) return;
    const isPdf = file.type === "application/pdf";
    if (!isCompatibleImageType(file.type) && !isPdf) return;
    e.preventDefault();
    try {
      const base64 = await fileToBase64(file);
      if (isPdf) {
        openError = null;
        await loadPdfFromBase64(base64, file.name, null);
      } else {
        await loadImageFromBytes(base64, file.name);
      }
    } catch (_) {
      openError = "Failed to load dropped file";
    }
  }

  function onPaste(e: ClipboardEvent) {
    e.preventDefault();
    pasteImage();
  }

  $effect(() => {
    if (typeof document === "undefined") return;
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  });
</script>

<main
  class="app"
  ondragover={onDragOver}
  ondrop={onDrop}
  role="application"
  aria-label="Redactorizer app; drop an image or PDF, or paste an image to open"
>
  <Toolbar>
    <ToolbarGroup>
      <Button title="Open image or PDF (⌘O)" onclick={openDocument}>Open</Button>
      <Button
        title="Save (⌘S)"
        onclick={saveImage}
        disabled={!documentSource}
      >
        Save
      </Button>
      {#if documentSource?.type === "pdf"}
        <Button
          title="Export all pages as PNGs"
          onclick={exportAllPdfPages}
        >
          Export all
        </Button>
      {/if}
    </ToolbarGroup>
    <ToolbarGroup>
      <Button
        title="Rectangle (hold Shift for square)"
        active={tool === "rectangle"}
        onclick={() => (tool = "rectangle")}
      >
        <span class="shape-icon"><Square size={18} aria-hidden="true" /></span>
      </Button>
      <Button
        title="Ellipse (hold Shift for circle)"
        active={tool === "ellipse"}
        onclick={() => (tool = "ellipse")}
      >
        <span class="shape-icon"><Circle size={18} aria-hidden="true" /></span>
      </Button>
      <Button
        title="Freehand"
        active={tool === "freehand"}
        onclick={() => (tool = "freehand")}
      >
        <span class="shape-icon"><Pencil size={18} aria-hidden="true" /></span>
      </Button>
    </ToolbarGroup>
    <ToolbarGroup>
      <Button
        active={selectedEffect === "pixelate"}
        onclick={() => {
          selectedEffect = "pixelate";
          setSelectedShapeEffect("pixelate");
        }}
      >
        Pixelate
      </Button>
      <Button
        active={selectedEffect === "blur"}
        onclick={() => {
          selectedEffect = "blur";
          setSelectedShapeEffect("blur");
        }}
      >
        Blur
      </Button>
      <Button
        active={selectedEffect === "fill"}
        onclick={() => {
          selectedEffect = "fill";
          setSelectedShapeEffect("fill");
        }}
      >
        Fill
      </Button>
      <EffectOptionsComponent
        bind:effectOptions
        {selectedEffect}
        fillColorValue={selectedShapeIndex != null && currentPageShapes[selectedShapeIndex]?.effect === "fill"
          ? (currentPageShapes[selectedShapeIndex].fillColor ?? effectOptions.fillColor)
          : undefined}
        onFillColorChange={selectedShapeIndex != null && currentPageShapes[selectedShapeIndex]?.effect === "fill"
          ? setSelectedShapeFillColor
          : undefined}
      />
    </ToolbarGroup>
    {#if documentSource}
      <div class="toolbar-spacer" aria-hidden="true"></div>
      <ToolbarGroup>
        <Button
          title="Zoom to fit"
          onclick={zoomToFit}
        >
          <Maximize2 size={18} aria-hidden="true" />
        </Button>
        <Button
          title="Zoom out (⌘−)"
          onclick={zoomOut}
          disabled={zoomLevel <= ZOOM_LEVELS[0]}
        >
          <ZoomOut size={18} aria-hidden="true" />
        </Button>
        <label class="zoom-percent-wrap" title="Zoom level (0–300%); click to edit. ⌘0 resets to 100%">
          <span class="visually-hidden">Zoom level, percent</span>
          <input
            type="number"
            class="zoom-percent-input"
            min={0}
            max={300}
            step={1}
            value={zoomPercentInput ?? Math.round(zoomLevel * 100)}
            onfocus={(e) => {
              if (zoomPercentInput === null) zoomPercentInput = String(Math.round(zoomLevel * 100));
              const el = e.currentTarget as HTMLInputElement;
              requestAnimationFrame(() => el?.select());
            }}
            onblur={commitZoomInput}
            onkeydown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                commitZoomInput();
                (e.currentTarget as HTMLInputElement).blur();
              }
              if (e.key === "Escape") {
                zoomPercentInput = null;
                (e.currentTarget as HTMLInputElement).blur();
              }
            }}
            oninput={(e) => {
              const v = (e.currentTarget as HTMLInputElement).value;
              if (v === "" || v === "-") return;
              zoomPercentInput = v;
            }}
          />
          <span class="zoom-percent-suffix">%</span>
        </label>
        <Button
          title="Zoom in (⌘+)"
          onclick={zoomIn}
          disabled={zoomLevel >= ZOOM_LEVELS[ZOOM_LEVELS.length - 1]}
        >
          <ZoomIn size={18} aria-hidden="true" />
        </Button>
      </ToolbarGroup>
    {/if}
  </Toolbar>

  <ErrorMessage message={openError} />
  <ErrorMessage message={saveError} />
  <ErrorMessage message={copyError} />
  <ErrorMessage message={shareError} />

  {#if savedToast}
    <p class="saved-toast" role="status">{savedToast}</p>
  {/if}

  <div class="main-content" class:with-sidebar={documentSource?.type === "pdf"}>
    {#if documentSource?.type === "pdf"}
      <PageSidebar
        documentTitle={sourceFileName}
        numPages={documentSource.numPages}
        thumbnails={pdfThumbnails}
        currentPageIndex={currentPageIndex}
        onPageSelect={(i) => {
          currentPageIndex = i;
          selectedShapeIndex = null;
          dragState = null;
        }}
      />
    {/if}
    <div
      class="canvas-wrap"
      class:empty-state={!documentSource}
      role="application"
      aria-label="Image redaction canvas"
      bind:this={canvasWrapEl}
      onpointerenter={() => (mouseOverImage = true)}
      onpointerleave={() => {
        mouseOverImage = false;
        hoveredShapeIndex = null;
      }}
    >
    {#if documentSource}
      <div class="canvas-wrap-inner">
      <div
        class="zoom-inner"
        style={imageDimensions
          ? `width: ${imageDimensions.width * zoomLevel}px; height: ${imageDimensions.height * zoomLevel}px;`
          : "min-width: 100%; min-height: 240px;"}
      >
        <canvas
          bind:this={canvasEl}
          class="canvas"
          class:canvas-loading={!imageDimensions}
          onmousedown={pointerDown}
          onmousemove={pointerMove}
          onmouseup={pointerUp}
          onmouseleave={pointerUp}
        ></canvas>
        {#if !imageDimensions}
          <div class="image-loading-overlay" aria-busy="true">
            <LoadingIndicator message="Loading image…" size="large" />
          </div>
        {/if}
        {#if imageDimensions && overlayDisplaySize.width > 0 && overlayDisplaySize.height > 0}
          <div
            class="overlay-wrapper"
            role="presentation"
            onpointerdown={(e) => {
              const t = e.target as Element;
              if (t.closest?.(".shape-path") || t.closest?.(".handle") || t.closest?.(".toolbar-inner")) return;
              pointerDown(e as unknown as MouseEvent);
            }}
            onpointermove={pointerMove}
            onpointerup={pointerUp}
            onpointerleave={pointerUp}
          >
            <ShapeOverlay
              canvasWidth={imageDimensions.width}
              canvasHeight={imageDimensions.height}
              overlayWidth={overlayDisplaySize.width}
              overlayHeight={overlayDisplaySize.height}
            shapes={currentPageShapes}
            selectedIndex={selectedShapeIndex}
            hoveredIndex={hoveredShapeIndex}
            showOutlines={mouseOverImage}
            onShapePointerDown={handleShapePointerDown}
            onShapePointerEnter={(i: number) => (hoveredShapeIndex = i)}
            onShapePointerLeave={() => (hoveredShapeIndex = null)}
            onHandlePointerDown={handleHandlePointerDown}
            {effectOptions}
            onEffectChange={setSelectedShapeEffect}
            onEffectStrengthChange={setSelectedShapeStrength}
            onDelete={deleteSelectedShape}
          />
        </div>
      {/if}
      </div>
      </div>
    {:else}
      <Placeholder
        message="Open an image or PDF to start redacting"
        onAction={openDocument}
        actionLabel="Open"
      />
    {/if}
    </div>
  </div>
</main>

<style>
  .app {
    display: flex;
    flex-direction: column;
    height: 100vh;
    font-family: -apple-system, BlinkMacSystemFont, "SF Pro", "Segoe UI", Roboto, sans-serif;
    font-size: 13px;
    color: #1d1d1f;
    background: #f5f5f7;
    -webkit-font-smoothing: antialiased;
  }
  .main-content {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-height: 0;
  }
  .main-content.with-sidebar {
    flex-direction: row;
  }
  .canvas-wrap {
    position: relative;
    flex: 1;
    overflow: auto;
    padding: 16px;
    min-height: 0;
  }
  .canvas-wrap.empty-state {
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .canvas-wrap-inner {
    display: flex;
    align-items: center;
    justify-content: center;
    min-width: 100%;
    min-height: 100%;
  }
  .zoom-inner {
    position: relative;
    flex-shrink: 0;
    margin: auto;
  }
  .toolbar-spacer {
    flex: 1;
    min-width: 0;
  }
  .zoom-inner .canvas {
    width: 100%;
    height: 100%;
    max-width: none;
    max-height: none;
  }
  .zoom-inner .overlay-wrapper {
    position: absolute;
    inset: 0;
  }
  .image-loading-overlay {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(245, 245, 247, 0.85);
    z-index: 10;
  }
  .overlay-wrapper {
    position: absolute;
    /* when not inside .zoom-inner, positioned via inline style from overlayRect */
  }
  .canvas {
    display: block;
    max-width: 100%;
    max-height: 100%;
    object-fit: contain;
    background: #e5e5ea;
    cursor: crosshair;
  }
  .canvas-loading {
    visibility: hidden;
  }
  .shape-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }
  .shape-icon :global(svg) {
    display: block;
  }
  .visually-hidden {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  }
  .zoom-percent-wrap {
    display: inline-flex;
    align-items: center;
    min-width: 2.5em;
    font-variant-numeric: tabular-nums;
    background: #fff;
    border: 1px solid rgba(0, 0, 0, 0.15);
    border-radius: 6px;
    padding: 6px 8px;
    height: 32px;
    box-sizing: border-box;
  }
  .zoom-percent-wrap:hover {
    background: #f0f0f0;
  }
  .zoom-percent-wrap:focus-within {
    outline: 2px solid #007aff;
    outline-offset: 2px;
  }
  .zoom-percent-input {
    width: 2.2em;
    min-width: 0;
    padding: 0;
    border: none;
    background: none;
    font: inherit;
    color: inherit;
    text-align: right;
    font-variant-numeric: tabular-nums;
    appearance: textfield;
    -moz-appearance: textfield;
  }
  .zoom-percent-input::-webkit-outer-spin-button,
  .zoom-percent-input::-webkit-inner-spin-button {
    appearance: none;
    -webkit-appearance: none;
    margin: 0;
  }
  .zoom-percent-input:focus {
    outline: none;
  }
  .zoom-percent-suffix {
    margin-left: 1px;
    opacity: 0.8;
  }
  .saved-toast {
    position: fixed;
    bottom: 20px;
    left: 50%;
    transform: translateX(-50%);
    margin: 0;
    padding: 8px 16px;
    font-size: 12px;
    background: #1d1d1f;
    color: #f5f5f7;
    border-radius: 8px;
    box-shadow: 0 2px 12px rgba(0, 0, 0, 0.2);
    z-index: 100;
    animation: fade-in 0.2s ease;
  }
  @keyframes fade-in {
    from {
      opacity: 0;
      transform: translateX(-50%) translateY(4px);
    }
    to {
      opacity: 1;
      transform: translateX(-50%) translateY(0);
    }
  }
  @media (prefers-color-scheme: dark) {
    .app {
      color: #f5f5f7;
      background: #1d1d1f;
    }
    .image-loading-overlay {
      background: rgba(29, 29, 31, 0.85);
    }
    .saved-toast {
      background: #f5f5f7;
      color: #1d1d1f;
    }
    .zoom-percent-wrap {
      background: #2d2d30;
      border-color: rgba(255, 255, 255, 0.2);
    }
    .zoom-percent-wrap:hover {
      background: #3a3a3c;
    }
    .zoom-percent-wrap:focus-within {
      outline-color: #0a84ff;
    }
  }
</style>
