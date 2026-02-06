<script lang="ts">
  import type { Shape, EffectType, EffectOptions } from "$lib/types/redactor";
  import { shapeBounds, shapeToSvgPath, type ResizeHandle } from "$lib/redactorCanvas";

  let {
    canvasWidth = 1,
    canvasHeight = 1,
    overlayWidth = 0,
    overlayHeight = 0,
    shapes = [],
    selectedIndex = null,
    hoveredIndex = null,
    showOutlines = false,
    effectOptions,
    onShapePointerDown,
    onShapePointerEnter,
    onShapePointerLeave,
    onHandlePointerDown,
    onEffectChange,
    onEffectStrengthChange,
    onDelete,
  } = $props<{
    canvasWidth: number;
    canvasHeight: number;
    overlayWidth: number;
    overlayHeight: number;
    shapes: Shape[];
    selectedIndex: number | null;
    hoveredIndex: number | null;
    showOutlines: boolean;
    effectOptions: EffectOptions;
    onShapePointerDown?: (index: number, e: PointerEvent) => void;
    onShapePointerEnter?: (index: number) => void;
    onShapePointerLeave?: () => void;
    onHandlePointerDown?: (handle: ResizeHandle, e: PointerEvent) => void;
    onEffectChange?: (effect: EffectType) => void;
    onEffectStrengthChange?: (value: number) => void;
    onDelete?: () => void;
  }>();

  const TOOLBAR_WIDTH = 200;
  const TOOLBAR_HEIGHT = 66;
  const TOOLBAR_GAP = 8;
  const OVERLAY_EDGE_MARGIN = 8;

  const STRENGTH_CONFIG: Record<
    EffectType,
    { min: number; max: number; step: number; default: number }
  > = {
    pixelate: { min: 4, max: 48, step: 2, default: 12 },
    blur: { min: 4, max: 48, step: 2, default: 20 },
    fill: { min: 0, max: 1, step: 0.01, default: 1 },
  };

  const strengthState = $derived.by(() => {
    if (selectedIndex === null || !shapes[selectedIndex] || !effectOptions) return null;
    const shape = shapes[selectedIndex];
    const effect: EffectType = shape.effect;
    const config = STRENGTH_CONFIG[effect];
    const value =
      effect === "pixelate"
        ? shape.pixelSize ?? effectOptions.pixelSize
        : effect === "blur"
          ? shape.blurRadius ?? effectOptions.blurRadius
          : shape.fillOpacity ?? effectOptions.fillOpacity;
    const clamped = Math.max(config.min, Math.min(config.max, value));
    return { effect, config, value: clamped };
  });

  const toolbarStyle = $derived.by(() => {
    if (selectedIndex === null || !shapes[selectedIndex] || overlayWidth <= 0 || overlayHeight <= 0)
      return null;
    const bounds = shapeBounds(shapes[selectedIndex]);
    const scale = Math.min(overlayWidth / canvasWidth, overlayHeight / canvasHeight);
    const offsetX = (overlayWidth - canvasWidth * scale) / 2;
    const offsetY = (overlayHeight - canvasHeight * scale) / 2;

    const shapeTopPx = offsetY + bounds.y * scale;
    const shapeBottomPx = offsetY + (bounds.y + bounds.h) * scale;
    const centerX = offsetX + (bounds.x + bounds.w / 2) * scale;

    const roomAbove = shapeTopPx - OVERLAY_EDGE_MARGIN;
    const roomBelow = overlayHeight - shapeBottomPx - OVERLAY_EDGE_MARGIN;
    const preferAbove = roomAbove >= TOOLBAR_HEIGHT + TOOLBAR_GAP;
    const preferBelow = roomBelow >= TOOLBAR_HEIGHT + TOOLBAR_GAP;

    let topPx: number;
    if (preferAbove) {
      topPx = shapeTopPx - TOOLBAR_HEIGHT - TOOLBAR_GAP;
    } else if (preferBelow) {
      topPx = shapeBottomPx + TOOLBAR_GAP;
    } else {
      topPx = roomAbove >= roomBelow
        ? OVERLAY_EDGE_MARGIN
        : overlayHeight - TOOLBAR_HEIGHT - OVERLAY_EDGE_MARGIN;
    }

    const leftPx = Math.max(
      OVERLAY_EDGE_MARGIN,
      Math.min(centerX - TOOLBAR_WIDTH / 2, overlayWidth - TOOLBAR_WIDTH - OVERLAY_EDGE_MARGIN)
    );

    return {
      left: `${leftPx}px`,
      top: `${topPx}px`,
      width: `${TOOLBAR_WIDTH}px`,
      height: `${TOOLBAR_HEIGHT}px`,
    };
  });
</script>

<div
  class="overlay"
  role="presentation"
  aria-hidden="true"
>
  <svg
    class="svg"
    viewBox="0 0 {canvasWidth} {canvasHeight}"
    preserveAspectRatio="xMidYMid meet"
  >
    <!-- Shape outlines and hover fill -->
    {#each shapes as shape, i}
      {@const pathD = shapeToSvgPath(shape)}
      {@const isHovered = hoveredIndex === i}
      {@const isSelected = selectedIndex === i}
      {@const show = showOutlines || isHovered || isSelected}
      {#if pathD}
        <path
          role="presentation"
          class="shape-path"
          class:visible={show}
          class:hovered={isHovered}
          class:selected={isSelected}
          d={pathD}
          data-index={i}
          onpointerdown={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onShapePointerDown?.(i, e);
          }}
          onpointerenter={() => onShapePointerEnter?.(i)}
          onpointerleave={() => onShapePointerLeave?.()}
        />
      {/if}
    {/each}
    <!-- Resize handles (only for selected shape) -->
    {#if selectedIndex !== null && shapes[selectedIndex]}
      {@const selShape = shapes[selectedIndex]}
      {@const bounds = shapeBounds(selShape)}
      {@const handleSize = 8}
      {#each [
        { key: "n", x: bounds.x + bounds.w / 2, y: bounds.y },
        { key: "ne", x: bounds.x + bounds.w, y: bounds.y },
        { key: "e", x: bounds.x + bounds.w, y: bounds.y + bounds.h / 2 },
        { key: "se", x: bounds.x + bounds.w, y: bounds.y + bounds.h },
        { key: "s", x: bounds.x + bounds.w / 2, y: bounds.y + bounds.h },
        { key: "sw", x: bounds.x, y: bounds.y + bounds.h },
        { key: "w", x: bounds.x, y: bounds.y + bounds.h / 2 },
        { key: "nw", x: bounds.x, y: bounds.y },
      ] as handlePos (handlePos.key)}
        <rect
          role="presentation"
          class="handle"
          data-handle={handlePos.key}
          x={handlePos.x - handleSize / 2}
          y={handlePos.y - handleSize / 2}
          width={handleSize}
          height={handleSize}
          onpointerdown={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onHandlePointerDown?.(handlePos.key, e);
          }}
        />
      {/each}
    {/if}
  </svg>
  <!-- Toolbar as HTML (avoids SVG foreignObject paint artifacts) -->
  {#if toolbarStyle && selectedIndex !== null && shapes[selectedIndex]}
    {@const selShape = shapes[selectedIndex]}
    <div
      class="toolbar-wrap"
      style="left: {toolbarStyle.left}; top: {toolbarStyle.top}; width: {toolbarStyle.width}; height: {toolbarStyle.height}"
    >
      <div class="toolbar-inner">
        <div class="toolbar-row toolbar-buttons">
          <button
            type="button"
            class="effect-btn"
            class:active={selShape.effect === "pixelate"}
            onclick={() => onEffectChange?.("pixelate")}
          >
            Pixelate
          </button>
          <button
            type="button"
            class="effect-btn"
            class:active={selShape.effect === "blur"}
            onclick={() => onEffectChange?.("blur")}
          >
            Blur
          </button>
          <button
            type="button"
            class="effect-btn"
            class:active={selShape.effect === "fill"}
            onclick={() => onEffectChange?.("fill")}
          >
            Fill
          </button>
          <button
            type="button"
            class="delete-btn"
            title="Delete"
            onpointerdown={(e) => e.stopPropagation()}
            onclick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onDelete?.();
            }}
          >
            <span class="delete-icon" aria-hidden="true">
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                <line x1="10" y1="11" x2="10" y2="17" />
                <line x1="14" y1="11" x2="14" y2="17" />
              </svg>
            </span>
          </button>
        </div>
        {#if strengthState}
          <div class="toolbar-row toolbar-slider-row">
            <input
              type="range"
              class="strength-slider"
              min={strengthState.config.min}
              max={strengthState.config.max}
              step={strengthState.config.step}
              value={strengthState.value}
              title={strengthState.effect === "fill"
                ? `Opacity ${Math.round(strengthState.value * 100)}%`
                : `Strength ${strengthState.value}`}
              oninput={(e) => {
                const v = parseFloat((e.currentTarget as HTMLInputElement).value);
                onEffectStrengthChange?.(v);
              }}
              onpointerdown={(e) => e.stopPropagation()}
            />
          </div>
        {/if}
      </div>
    </div>
  {/if}
</div>

<style>
  .overlay {
    position: absolute;
    inset: 0;
    pointer-events: none;
  }
  .overlay :global(.shape-path),
  .overlay :global(.handle),
  .overlay :global(.toolbar-wrap),
  .overlay :global(.toolbar-inner),
  .overlay :global(.toolbar-inner *) {
    pointer-events: auto;
  }
  .toolbar-wrap {
    position: absolute;
    display: flex;
    align-items: center;
    justify-content: center;
    pointer-events: auto;
  }
  .svg {
    width: 100%;
    height: 100%;
    display: block;
    pointer-events: none;
  }
  .shape-path,
  .handle {
    pointer-events: auto;
  }
  .shape-path {
    fill: none;
    stroke: rgba(0, 0, 0, 0.25);
    stroke-width: 1.5;
    opacity: 0;
    transition: opacity 0.12s ease, stroke 0.12s ease, fill 0.12s ease;
    cursor: move;
  }
  .shape-path.visible {
    opacity: 1;
  }
  .shape-path.hovered {
    stroke: rgba(59, 130, 246, 0.7);
    fill: rgba(59, 130, 246, 0.06);
  }
  .shape-path.selected {
    stroke: rgba(59, 130, 246, 0.9);
    stroke-width: 2;
    fill: rgba(59, 130, 246, 0.08);
  }
  .handle {
    fill: #fff;
    stroke: rgba(59, 130, 246, 0.9);
    stroke-width: 1.5;
    cursor: nwse-resize;
    opacity: 1;
  }
  .handle:hover {
    fill: rgba(59, 130, 246, 0.2);
  }
  .toolbar-inner {
    display: flex;
    flex-direction: column;
    align-items: stretch;
    gap: 6px;
    padding: 6px 8px;
    background: #fff;
    border-radius: 8px;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
    border: 1px solid rgba(0, 0, 0, 0.08);
    width: 100%;
    box-sizing: border-box;
  }
  .toolbar-row {
    display: flex;
    align-items: center;
    gap: 4px;
  }
  .toolbar-buttons {
    flex: 0 0 auto;
  }
  .toolbar-slider-row {
    padding: 0 2px;
  }
  .strength-slider {
    width: 100%;
    height: 4px;
    margin: 0;
    -webkit-appearance: none;
    appearance: none;
    background: rgba(0, 0, 0, 0.12);
    border-radius: 2px;
  }
  .strength-slider::-webkit-slider-thumb {
    -webkit-appearance: none;
    appearance: none;
    width: 12px;
    height: 12px;
    border-radius: 50%;
    background: #2563eb;
    cursor: pointer;
    border: none;
  }
  .strength-slider::-moz-range-thumb {
    width: 12px;
    height: 12px;
    border-radius: 50%;
    background: #2563eb;
    cursor: pointer;
    border: none;
  }
  .effect-btn,
  .delete-btn {
    padding: 4px 8px;
    font-size: 12px;
    border: none;
    border-radius: 4px;
    background: transparent;
    cursor: pointer;
    color: #1d1d1f;
  }
  .effect-btn:hover,
  .delete-btn:hover {
    background: rgba(0, 0, 0, 0.06);
  }
  .effect-btn.active {
    background: rgba(59, 130, 246, 0.2);
    color: #2563eb;
  }
  .delete-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 6px;
    margin-left: 2px;
    border-left: 1px solid rgba(0, 0, 0, 0.1);
    color: #dc2626;
  }
  .delete-btn:hover {
    background: rgba(220, 38, 38, 0.1);
  }
  .delete-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }
  .delete-icon :global(svg) {
    display: block;
  }
  @media (prefers-color-scheme: dark) {
    .toolbar-inner {
      background: #2d2d2d;
      border-color: rgba(255, 255, 255, 0.1);
    }
    .effect-btn,
    .delete-btn {
      color: #f5f5f7;
    }
    .effect-btn:hover,
    .delete-btn:hover {
      background: rgba(255, 255, 255, 0.08);
    }
    .effect-btn.active {
      background: rgba(59, 130, 246, 0.3);
      color: #93c5fd;
    }
    .delete-btn {
      color: #f87171;
      border-left-color: rgba(255, 255, 255, 0.1);
    }
    .delete-btn:hover {
      background: rgba(248, 113, 113, 0.15);
    }
    .strength-slider {
      background: rgba(255, 255, 255, 0.2);
    }
    .strength-slider::-webkit-slider-thumb {
      background: #93c5fd;
    }
    .strength-slider::-moz-range-thumb {
      background: #93c5fd;
    }
  }
</style>
