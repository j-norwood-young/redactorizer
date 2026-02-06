<script lang="ts">
  import { invoke } from "@tauri-apps/api/core";
  import { listen } from "@tauri-apps/api/event";
  import type { Shape, ShapeType, EffectType, EffectOptions } from "$lib/types/redactor";
  import {
    redrawCanvas,
    shapeAtPoint,
    shapeBounds,
    getHandleAtPoint,
    type ResizeHandle,
  } from "$lib/redactorCanvas";
  import {
    Button,
    Toolbar,
    ToolbarGroup,
    ErrorMessage,
    Placeholder,
    EffectOptions as EffectOptionsComponent,
    ShapeOverlay,
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
  let shapes = $state<Shape[]>([]);
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

  function isCompatibleImageType(type: string): boolean {
    return COMPATIBLE_IMAGE_TYPES.some((t) => type === t || type.startsWith("image/"));
  }

  /** Default save filename: stem of sourceFileName + "-redacted.png". */
  function getDefaultSaveName(): string {
    if (!sourceFileName || sourceFileName === "redacted.png") return "redacted.png";
    const lastDot = sourceFileName.lastIndexOf(".");
    const stem = lastDot > 0 ? sourceFileName.slice(0, lastDot) : sourceFileName;
    return `${stem}-redacted.png`;
  }

  let selectedShapeIndex = $state<number | null>(null);
  let hoveredShapeIndex = $state<number | null>(null);
  let mouseOverImage = $state(false);
  let overlayRect = $state({ left: 0, top: 0, width: 0, height: 0 });
  /** Shift key held — when drawing, constrains rectangle/ellipse to equal width/height. */
  let shiftKeyHeld = $state(false);

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

  async function openImage() {
    openError = null;
    try {
      const result = await invoke<{ path: string; base64: string } | null>("open_image_dialog");
      if (result) {
        imageSource = `data:image/png;base64,${result.base64}`;
        sourceFilePath = result.path;
        sourceFileName = result.path.split(/[/\\]/).pop() ?? "image.png";
        lastSavedPath = null;
        shapes = [];
        selectedShapeIndex = null;
        hoveredShapeIndex = null;
        dragState = null;
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
      imageSource = `data:image/png;base64,${pngBase64}`;
      sourceFilePath = null;
      sourceFileName = fileName;
      lastSavedPath = null;
      shapes = [];
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

  $effect(() => {
    const src = imageSource;
    if (!src) {
      imageDimensions = null;
      return;
    }
    const img = new Image();
    img.onload = () => drawImageOnCanvas(img);
    img.onerror = () => (openError = "Failed to load image");
    img.src = src;
  });

  function getExportBase64(): string | null {
    const canvas = canvasEl;
    if (!canvas || !imageSource) return null;
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
      await invoke("plugin:share|share_file", { path, mime: "image/png" });
    } catch (e) {
      shareError = e instanceof Error ? e.message : String(e);
    }
  }

  $effect(() => {
    let unlisten: (() => void) | undefined;
    listen<string>("menu-action", (event) => {
      switch (event.payload) {
        case "open":
          openImage();
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
      }
    }).then((fn) => {
      unlisten = fn;
    });
    return () => {
      unlisten?.();
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
    const shape = shapes[index];
    if (!shape) return;
    dragState = { type: "move", shapeIndex: index, startX: p.x, startY: p.y, startPoints: [...shape.points] };
  }

  function handleHandlePointerDown(handle: ResizeHandle, e: PointerEvent) {
    if (selectedShapeIndex === null) return;
    const p = getCanvasPoint(e);
    if (!p) return;
    const shape = shapes[selectedShapeIndex];
    if (!shape) return;
    const bounds = shapeBounds(shape);
    dragState = { type: "resize", shapeIndex: selectedShapeIndex, handle, startX: p.x, startY: p.y, startBounds: { ...bounds } };
  }

  function handlePointerMove(e: PointerEvent) {
    shiftKeyHeld = e.shiftKey;
    const p = getCanvasPoint(e);
    if (p !== null) {
      const idx = shapeAtPoint(shapes, p.x, p.y);
      hoveredShapeIndex = idx >= 0 ? idx : null;
    }
    if (dragState) {
      if (!p) return;
      if (dragState.type === "move") {
        const dx = p.x - dragState.startX;
        const dy = p.y - dragState.startY;
        const idx = dragState.shapeIndex;
        const startPoints = dragState.startPoints;
        shapes = shapes.map((s, i) =>
          i === idx ? applyMove({ ...s, points: startPoints }, dx, dy) : s
        );
      } else {
        const d = dragState;
        const dx = p.x - d.startX;
        const dy = p.y - d.startY;
        const shape = shapes[d.shapeIndex];
        if (shape)
          shapes = shapes.map((s, i) =>
            i === d.shapeIndex ? applyResize(shape, d.handle, d.startBounds, dx, dy, e.shiftKey) : s
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
        shapes = [...shapes, { type: "rectangle", points: [x, y, w, h], effect: selectedEffect }];
        selectedShapeIndex = shapes.length - 1;
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
        shapes = [...shapes, { type: "ellipse", points: [x, y, w, h], effect: selectedEffect }];
        selectedShapeIndex = shapes.length - 1;
      }
    } else if (tool === "freehand" && freehandPoints.length >= 4) {
      shapes = [...shapes, { type: "freehand", points: [...freehandPoints], effect: selectedEffect }];
      selectedShapeIndex = shapes.length - 1;
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
      const bounds = shapeBounds(shapes[selectedShapeIndex]);
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
    const idx = shapeAtPoint(shapes, p.x, p.y);
    if (idx >= 0) {
      selectedShapeIndex = idx;
      dragState = {
        type: "move",
        shapeIndex: idx,
        startX: p.x,
        startY: p.y,
        startPoints: [...shapes[idx].points],
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
    shapes = shapes.filter((_, i) => i !== selectedShapeIndex);
    selectedShapeIndex = null;
    dragState = null;
  }

  function setSelectedShapeEffect(effect: EffectType) {
    if (selectedShapeIndex === null) return;
    shapes = shapes.map((s, i) => (i === selectedShapeIndex ? { ...s, effect } : s));
    selectedEffect = effect;
  }

  function setSelectedShapeStrength(value: number) {
    if (selectedShapeIndex === null) return;
    const shape = shapes[selectedShapeIndex];
    const effect = shape.effect;
    shapes = shapes.map((s, i) => {
      if (i !== selectedShapeIndex) return s;
      if (effect === "pixelate") return { ...s, pixelSize: value };
      if (effect === "blur") return { ...s, blurRadius: value };
      return { ...s, fillOpacity: value };
    });
    if (effect === "pixelate") effectOptions = { ...effectOptions, pixelSize: value };
    else if (effect === "blur") effectOptions = { ...effectOptions, blurRadius: value };
    else effectOptions = { ...effectOptions, fillOpacity: value };
  }

  $effect(() => {
    redrawCanvas({
      canvas: canvasEl,
      imageSource,
      imageDimensions,
      shapes,
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
    const mod = e.metaKey;
    if (!mod) return;
    if (e.key === "o") {
      e.preventDefault();
      openImage();
    } else if (e.key === "s") {
      e.preventDefault();
      if (imageSource) {
        if (e.shiftKey) saveImageAs();
        else saveImage();
      }
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
    const hasImage = Array.from(e.dataTransfer?.items ?? []).some(
      (item) => item.kind === "file" && isCompatibleImageType(item.type)
    );
    if (hasImage) {
      e.preventDefault();
      e.dataTransfer!.dropEffect = "copy";
    }
  }

  async function onDrop(e: DragEvent) {
    const file = e.dataTransfer?.files?.[0];
    if (!file || !isCompatibleImageType(file.type)) return;
    e.preventDefault();
    try {
      const base64 = await fileToBase64(file);
      await loadImageFromBytes(base64, file.name);
    } catch (_) {
      openError = "Failed to load dropped image";
    }
  }

  async function onPaste(e: ClipboardEvent) {
    const item = Array.from(e.clipboardData?.items ?? []).find(
      (i) => i.type.startsWith("image/")
    );
    const file = item?.getAsFile();
    if (!file) return;
    e.preventDefault();
    try {
      const base64 = await fileToBase64(file);
      await loadImageFromBytes(base64, "pasted.png");
    } catch (_) {
      openError = "Failed to load pasted image";
    }
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
  aria-label="Redactorizer app; drop an image or paste to open"
>
  <Toolbar>
    <ToolbarGroup>
      <Button
        title="Rectangle (hold Shift for square)"
        active={tool === "rectangle"}
        onclick={() => (tool = "rectangle")}
      >
        <span class="shape-icon" aria-hidden="true">
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="3" y="3" width="18" height="18" rx="1" />
          </svg>
        </span>
      </Button>
      <Button
        title="Ellipse (hold Shift for circle)"
        active={tool === "ellipse"}
        onclick={() => (tool = "ellipse")}
      >
        <span class="shape-icon" aria-hidden="true">
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <ellipse cx="12" cy="12" rx="10" ry="6" />
          </svg>
        </span>
      </Button>
      <Button
        title="Freehand"
        active={tool === "freehand"}
        onclick={() => (tool = "freehand")}
      >
        <span class="shape-icon" aria-hidden="true">
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 19l7-7 3 3-7 7-3-3z" />
            <path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z" />
          </svg>
        </span>
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
      <EffectOptionsComponent bind:effectOptions {selectedEffect} />
    </ToolbarGroup>
  </Toolbar>

  <ErrorMessage message={openError} />
  <ErrorMessage message={saveError} />
  <ErrorMessage message={copyError} />
  <ErrorMessage message={shareError} />

  {#if savedToast}
    <p class="saved-toast" role="status">{savedToast}</p>
  {/if}

  <div
    class="canvas-wrap"
    role="application"
    aria-label="Image redaction canvas"
    bind:this={canvasWrapEl}
    onpointerenter={() => (mouseOverImage = true)}
    onpointerleave={() => {
      mouseOverImage = false;
      hoveredShapeIndex = null;
    }}
  >
    {#if imageSource}
      <canvas
        bind:this={canvasEl}
        class="canvas"
        onmousedown={pointerDown}
        onmousemove={pointerMove}
        onmouseup={pointerUp}
        onmouseleave={pointerUp}
      ></canvas>
      {#if imageDimensions && overlayRect.width > 0 && overlayRect.height > 0}
        <div
          class="overlay-wrapper"
          role="presentation"
          style="left: {overlayRect.left}px; top: {overlayRect.top}px; width: {overlayRect.width}px; height: {overlayRect.height}px;"
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
            overlayWidth={overlayRect.width}
            overlayHeight={overlayRect.height}
            shapes={shapes}
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
    {:else}
      <Placeholder
        message="Open an image to start redacting"
        onAction={openImage}
        actionLabel="Open image"
      />
    {/if}
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
  .canvas-wrap {
    position: relative;
    flex: 1;
    overflow: auto;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 16px;
  }
  .overlay-wrapper {
    position: absolute;
  }
  .canvas {
    display: block;
    max-width: 100%;
    max-height: 100%;
    object-fit: contain;
    background: #e5e5ea;
    cursor: crosshair;
  }
  .shape-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }
  .shape-icon :global(svg) {
    display: block;
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
    .saved-toast {
      background: #f5f5f7;
      color: #1d1d1f;
    }
  }
</style>
