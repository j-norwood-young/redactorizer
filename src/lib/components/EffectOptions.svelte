<script lang="ts">
  import type { EffectType, EffectOptions as EffectOptionsType } from "$lib/types/redactor";

  let { selectedEffect, effectOptions = $bindable() } = $props<{
    selectedEffect: EffectType;
    effectOptions: EffectOptionsType;
  }>();
</script>

{#if selectedEffect === "fill"}
  <input
    type="color"
    bind:value={effectOptions.fillColor}
    class="color-picker"
    title="Fill colour"
  />
{:else if selectedEffect === "pixelate"}
  <label for="pixel-size" class="toolbar-label">Size</label>
  <input
    id="pixel-size"
    type="range"
    min="4"
    max="32"
    step="2"
    bind:value={effectOptions.pixelSize}
    class="range-input"
  />
{:else if selectedEffect === "blur"}
  <label for="blur-radius" class="toolbar-label">Blur</label>
  <input
    id="blur-radius"
    type="range"
    min="4"
    max="48"
    step="2"
    bind:value={effectOptions.blurRadius}
    class="range-input"
  />
{/if}

<style>
  .color-picker {
    width: 28px;
    height: 28px;
    padding: 0;
    border: 1px solid rgba(0, 0, 0, 0.2);
    border-radius: 4px;
    cursor: pointer;
  }
  .toolbar-label {
    font-size: 12px;
    color: #86868b;
  }
  .range-input {
    width: 80px;
    vertical-align: middle;
  }
</style>
