<script lang="ts">
  import { invoke } from "@tauri-apps/api/core";
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
  let shapes = $state<Shape[]>([]);
  let tool = $state<ShapeType>("rectangle");
  let selectedEffect = $state<EffectType>("pixelate");
  let effectOptions = $state<EffectOptions>({
    fillColor: "#000000",
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

  let selectedShapeIndex = $state<number | null>(null);
  let hoveredShapeIndex = $state<number | null>(null);
  let mouseOverImage = $state(false);
  let overlayRect = $state({ left: 0, top: 0, width: 0, height: 0 });

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
      const result = await invoke<string | null>("open_image_dialog");
      if (result) {
        imageSource = `data:image/png;base64,${result}`;
        shapes = [];
        selectedShapeIndex = null;
        hoveredShapeIndex = null;
        dragState = null;
      }
    } catch (e) {
      openError = e instanceof Error ? e.message : String(e);
    }
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

  async function saveImage() {
    saveError = null;
    const base64 = getExportBase64();
    if (!base64) {
      saveError = "No image to save";
      return;
    }
    try {
      await invoke("save_image", { base64Png: base64 });
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
    if (shape.type === "rectangle" || shape.type === "square") {
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
    dy: number
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
            i === d.shapeIndex ? applyResize(shape, d.handle, d.startBounds, dx, dy) : s
          );
      }
      return;
    }
    drawCurrent = p ?? drawCurrent;
    if (isDrawing && tool === "freehand" && p) freehandPoints = [...freehandPoints, p.x, p.y];
  }

  function handlePointerUp() {
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
    if (tool === "rectangle") {
      const x = Math.min(x0, x1);
      const y = Math.min(y0, y1);
      const w = Math.abs(x1 - x0);
      const h = Math.abs(y1 - y0);
      if (w >= 2 && h >= 2)
        shapes = [...shapes, { type: "rectangle", points: [x, y, w, h], effect: selectedEffect }];
    } else if (tool === "square") {
      const d = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
      const x = x0 < x1 ? x0 : x0 - d;
      const y = y0 < y1 ? y0 : y0 - d;
      if (d >= 2) shapes = [...shapes, { type: "square", points: [x, y, d, d], effect: selectedEffect }];
    } else if (tool === "circle") {
      const cx = (x0 + x1) / 2;
      const cy = (y0 + y1) / 2;
      const r = Math.hypot(x1 - x0, y1 - y0) / 2;
      if (r >= 2) shapes = [...shapes, { type: "circle", points: [cx, cy, r], effect: selectedEffect }];
    } else if (tool === "freehand" && freehandPoints.length >= 4) {
      shapes = [...shapes, { type: "freehand", points: [...freehandPoints], effect: selectedEffect }];
    }
    isDrawing = false;
    drawStart = null;
    drawCurrent = null;
    freehandPoints = [];
  }

  function pointerDown(e: MouseEvent) {
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

  function pointerUp() {
    handlePointerUp();
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
    });
  });

  function onKeydown(e: KeyboardEvent) {
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
      if (imageSource) saveImage();
    }
  }

  $effect(() => {
    if (typeof document === "undefined") return;
    document.addEventListener("keydown", onKeydown);
    return () => document.removeEventListener("keydown", onKeydown);
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
</script>

<main class="app">
  <Toolbar>
    <ToolbarGroup>
      <Button title="Open image (⌘O)" onclick={openImage}>Open</Button>
      <Button
        title="Save (⌘S)"
        disabled={!imageSource}
        onclick={saveImage}
      >
        Save
      </Button>
      <Button
        title="Copy image to clipboard"
        disabled={!imageSource}
        onclick={copyImage}
      >
        Copy
      </Button>
      <Button
        title="Share image"
        disabled={!imageSource}
        onclick={shareImage}
      >
        Share
      </Button>
    </ToolbarGroup>
    <ToolbarGroup>
      <Button active={tool === "rectangle"} onclick={() => (tool = "rectangle")}>
        Rectangle
      </Button>
      <Button active={tool === "square"} onclick={() => (tool = "square")}>
        Square
      </Button>
      <Button active={tool === "circle"} onclick={() => (tool = "circle")}>
        Circle
      </Button>
      <Button active={tool === "freehand"} onclick={() => (tool = "freehand")}>
        Freehand
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
            onEffectChange={setSelectedShapeEffect}
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
  @media (prefers-color-scheme: dark) {
    .app {
      color: #f5f5f7;
      background: #1d1d1f;
    }
  }
</style>
