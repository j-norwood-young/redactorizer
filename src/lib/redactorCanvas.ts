import type { Shape, ShapeType, EffectOptions } from "$lib/types/redactor";

export function shapePath(ctx: CanvasRenderingContext2D, shape: Shape): void {
  ctx.beginPath();
  if (shape.type === "rectangle" || shape.type === "square") {
    const [x, y, w, h] = shape.points;
    ctx.rect(x, y, w, h);
  } else if (shape.type === "circle") {
    const [cx, cy, r] = shape.points;
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
  } else if (shape.type === "freehand" && shape.points.length >= 4) {
    ctx.moveTo(shape.points[0], shape.points[1]);
    for (let i = 2; i < shape.points.length; i += 2)
      ctx.lineTo(shape.points[i], shape.points[i + 1]);
    ctx.closePath();
  }
}

/** Returns true if (x, y) is inside the shape (canvas coordinates). */
export function pointInShape(shape: Shape, x: number, y: number): boolean {
  if (shape.type === "rectangle" || shape.type === "square") {
    const [sx, sy, w, h] = shape.points;
    return x >= sx && x <= sx + w && y >= sy && y <= sy + h;
  }
  if (shape.type === "circle") {
    const [cx, cy, r] = shape.points;
    return Math.hypot(x - cx, y - cy) <= r;
  }
  if (shape.type === "freehand" && shape.points.length >= 6) {
    const pts = shape.points;
    let inside = false;
    const n = pts.length / 2;
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const xi = pts[i * 2];
      const yi = pts[i * 2 + 1];
      const xj = pts[j * 2];
      const yj = pts[j * 2 + 1];
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }
  return false;
}

/** Find topmost shape index that contains (x, y), or -1. */
export function shapeAtPoint(shapes: Shape[], x: number, y: number): number {
  for (let i = shapes.length - 1; i >= 0; i--) {
    if (pointInShape(shapes[i], x, y)) return i;
  }
  return -1;
}

export function shapeBounds(shape: Shape): { x: number; y: number; w: number; h: number } {
  if (shape.type === "rectangle" || shape.type === "square") {
    const [x, y, w, h] = shape.points;
    return { x, y, w, h };
  }
  if (shape.type === "circle") {
    const [cx, cy, r] = shape.points;
    return { x: cx - r, y: cy - r, w: 2 * r, h: 2 * r };
  }
  if (shape.type === "freehand" && shape.points.length >= 4) {
    let minX = shape.points[0];
    let minY = shape.points[1];
    let maxX = minX;
    let maxY = minY;
    for (let i = 2; i < shape.points.length; i += 2) {
      const x = shape.points[i];
      const y = shape.points[i + 1];
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
    return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
  }
  return { x: 0, y: 0, w: 0, h: 0 };
}

export type ResizeHandle =
  | "n"
  | "ne"
  | "e"
  | "se"
  | "s"
  | "sw"
  | "w"
  | "nw";

const HANDLE_HIT_RADIUS = 8;

/** Returns which resize handle (if any) contains the point, for a shape's bounds. */
export function getHandleAtPoint(
  bounds: { x: number; y: number; w: number; h: number },
  px: number,
  py: number
): ResizeHandle | null {
  const { x, y, w, h } = bounds;
  const cx = x + w / 2;
  const cy = y + h / 2;
  const handles: { key: ResizeHandle; hx: number; hy: number }[] = [
    { key: "n", hx: cx, hy: y },
    { key: "ne", hx: x + w, hy: y },
    { key: "e", hx: x + w, hy: cy },
    { key: "se", hx: x + w, hy: y + h },
    { key: "s", hx: cx, hy: y + h },
    { key: "sw", hx: x, hy: y + h },
    { key: "w", hx: x, hy: cy },
    { key: "nw", hx: x, hy: y },
  ];
  for (const { key, hx, hy } of handles) {
    if (Math.hypot(px - hx, py - hy) <= HANDLE_HIT_RADIUS) return key;
  }
  return null;
}

/** Build SVG path d for a shape (canvas coordinates). */
export function shapeToSvgPath(shape: Shape): string {
  if (shape.type === "rectangle" || shape.type === "square") {
    const [x, y, w, h] = shape.points;
    return `M ${x} ${y} h ${w} v ${h} h ${-w} Z`;
  }
  if (shape.type === "circle") {
    const [cx, cy, r] = shape.points;
    return `M ${cx + r} ${cy} A ${r} ${r} 0 0 1 ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy} Z`;
  }
  if (shape.type === "freehand" && shape.points.length >= 4) {
    const p = shape.points;
    let d = `M ${p[0]} ${p[1]}`;
    for (let i = 2; i < p.length; i += 2) d += ` L ${p[i]} ${p[i + 1]}`;
    return d + " Z";
  }
  return "";
}

/**
 * Separable Gaussian blur on ImageData (works without ctx.filter, e.g. in Tauri WebView).
 * Gives smooth, radially symmetric blur with no streaking or weak corners.
 */
function gaussianBlurImageData(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  radius: number
): void {
  if (radius <= 0 || width <= 0 || height <= 0) return;
  const r = Math.min(radius, Math.max(width, height));
  const sigma = r / 2;
  const size = (r << 1) + 1;
  const kernel = new Float64Array(size);
  let sum = 0;
  for (let i = 0; i < size; i++) {
    const x = i - r;
    kernel[i] = Math.exp(-(x * x) / (2 * sigma * sigma));
    sum += kernel[i];
  }
  for (let i = 0; i < size; i++) kernel[i] /= sum;

  const tmp = new Uint8ClampedArray(data.length);

  function horizontalPass(src: Uint8ClampedArray, dst: Uint8ClampedArray) {
    for (let y = 0; y < height; y++) {
      const row = y * width;
      for (let x = 0; x < width; x++) {
        let sr = 0, sg = 0, sb = 0, sa = 0, wsum = 0;
        for (let ki = 0; ki < size; ki++) {
          const xi = Math.max(0, Math.min(width - 1, x + ki - r));
          const w = kernel[ki];
          const i = (row + xi) << 2;
          sr += src[i] * w;
          sg += src[i + 1] * w;
          sb += src[i + 2] * w;
          sa += src[i + 3] * w;
          wsum += w;
        }
        const o = (row + x) << 2;
        dst[o] = Math.round(sr / wsum);
        dst[o + 1] = Math.round(sg / wsum);
        dst[o + 2] = Math.round(sb / wsum);
        dst[o + 3] = Math.round(sa / wsum);
      }
    }
  }

  function verticalPass(src: Uint8ClampedArray, dst: Uint8ClampedArray) {
    for (let x = 0; x < width; x++) {
      for (let y = 0; y < height; y++) {
        let sr = 0, sg = 0, sb = 0, sa = 0, wsum = 0;
        for (let ki = 0; ki < size; ki++) {
          const yi = Math.max(0, Math.min(height - 1, y + ki - r));
          const w = kernel[ki];
          const i = (yi * width + x) << 2;
          sr += src[i] * w;
          sg += src[i + 1] * w;
          sb += src[i + 2] * w;
          sa += src[i + 3] * w;
          wsum += w;
        }
        const o = (y * width + x) << 2;
        dst[o] = Math.round(sr / wsum);
        dst[o + 1] = Math.round(sg / wsum);
        dst[o + 2] = Math.round(sb / wsum);
        dst[o + 3] = Math.round(sa / wsum);
      }
    }
  }

  horizontalPass(data, tmp);
  verticalPass(tmp, data);
}

function applyShapeEffect(
  ctx: CanvasRenderingContext2D,
  shape: Shape,
  img: HTMLImageElement,
  bounds: { x: number; y: number; w: number; h: number },
  effectOptions: EffectOptions
): void {
  const pixelSize = shape.pixelSize ?? effectOptions.pixelSize;
  const blurRadius = shape.blurRadius ?? effectOptions.blurRadius;
  const fillColor = shape.fillColor ?? effectOptions.fillColor;
  const { x: bx, y: by, w: bw, h: bh } = bounds;
  if (bw <= 0 || bh <= 0) return;

  if (shape.effect === "pixelate") {
    // Ensure at least 6 blocks per dimension so small regions don't collapse to one colour
    const minBlocks = 6;
    const maxPixelSizeW = bw >= minBlocks ? bw / minBlocks : bw;
    const maxPixelSizeH = bh >= minBlocks ? bh / minBlocks : bh;
    const effectivePixelSize = Math.max(
      1,
      Math.min(pixelSize, maxPixelSizeW, maxPixelSizeH)
    );
    const tw = Math.max(1, Math.floor(bw / effectivePixelSize));
    const th = Math.max(1, Math.floor(bh / effectivePixelSize));
    const temp = document.createElement("canvas");
    temp.width = tw;
    temp.height = th;
    const tctx = temp.getContext("2d");
    if (!tctx) return;
    tctx.imageSmoothingEnabled = false;
    tctx.drawImage(img, bx, by, bw, bh, 0, 0, tw, th);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(temp, 0, 0, tw, th, bx, by, bw, bh);
  } else if (shape.effect === "blur") {
    // Use integer dimensions so the buffer fully covers the shape (avoids truncated
    // bottom/right and corner gaps when bounds are fractional). Software Gaussian
    // works everywhere (e.g. Tauri WebView doesn't support ctx.filter).
    const regionScale = Math.min(2, Math.max(0.5, Math.sqrt(bw * bh) / 80));
    const effectiveBlur = Math.max(2, Math.round(blurRadius * regionScale));
    const w = Math.ceil(bw);
    const h = Math.ceil(bh);
    if (w <= 0 || h <= 0) return;
    const temp = document.createElement("canvas");
    temp.width = w;
    temp.height = h;
    const tctx = temp.getContext("2d");
    if (!tctx) return;
    tctx.drawImage(img, bx, by, bw, bh, 0, 0, w, h);
    const imageData = tctx.getImageData(0, 0, w, h);
    gaussianBlurImageData(imageData.data, w, h, effectiveBlur);
    gaussianBlurImageData(imageData.data, w, h, effectiveBlur);
    tctx.putImageData(imageData, 0, 0);
    ctx.drawImage(temp, 0, 0, w, h, bx, by, bw, bh);
  } else {
    ctx.fillStyle = fillColor;
    ctx.fill();
  }
}

export interface RedrawParams {
  canvas: HTMLCanvasElement | null;
  imageSource: string | null;
  imageDimensions: { width: number; height: number } | null;
  shapes: Shape[];
  tool: ShapeType;
  isDrawing: boolean;
  drawStart: { x: number; y: number } | null;
  drawCurrent: { x: number; y: number } | null;
  freehandPoints: number[];
  effectOptions: EffectOptions;
}

export function redrawCanvas(params: RedrawParams): void {
  const {
    canvas,
    imageSource: src,
    imageDimensions,
    shapes,
    tool,
    isDrawing,
    drawStart,
    drawCurrent,
    freehandPoints,
    effectOptions,
  } = params;
  if (!canvas || !src || !imageDimensions) return;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const img = new Image();
  img.onload = () => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0);

    for (const s of shapes) {
      const bounds = shapeBounds(s);
      if (bounds.w <= 0 || bounds.h <= 0) continue;
      ctx.save();
      shapePath(ctx, s);
      ctx.clip();
      applyShapeEffect(ctx, s, img, bounds, effectOptions);
      ctx.restore();
    }

    ctx.strokeStyle = "rgba(255, 0, 0, 0.8)";
    ctx.lineWidth = 2;
    if (isDrawing && drawStart && drawCurrent) {
      const [x0, y0] = [drawStart.x, drawStart.y];
      const [x1, y1] = [drawCurrent.x, drawCurrent.y];
      if (tool === "rectangle" || tool === "square") {
        const w =
          tool === "square"
            ? Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0))
            : Math.abs(x1 - x0);
        const h = tool === "square" ? w : Math.abs(y1 - y0);
        if (tool === "square") {
          const xx = x0 < x1 ? x0 : x0 - w;
          const yy = y0 < y1 ? y0 : y0 - w;
          ctx.strokeRect(xx, yy, w, w);
        } else ctx.strokeRect(Math.min(x0, x1), Math.min(y0, y1), w, h);
      } else if (tool === "circle") {
        const cx = (x0 + x1) / 2;
        const cy = (y0 + y1) / 2;
        const r = Math.hypot(x1 - x0, y1 - y0) / 2;
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.stroke();
      } else if (tool === "freehand" && freehandPoints.length >= 4) {
        ctx.beginPath();
        ctx.moveTo(freehandPoints[0], freehandPoints[1]);
        for (let i = 2; i < freehandPoints.length; i += 2)
          ctx.lineTo(freehandPoints[i], freehandPoints[i + 1]);
        ctx.stroke();
      }
    }
  };
  img.src = src;
}
