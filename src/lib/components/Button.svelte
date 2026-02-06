<script lang="ts">
  import type { Snippet } from "svelte";

  let {
    type = "button",
    disabled = false,
    active = false,
    title,
    onclick,
    children,
  } = $props<{
    type?: "button" | "submit";
    disabled?: boolean;
    active?: boolean;
    title?: string;
    onclick?: () => void;
    children?: Snippet;
  }>();
</script>

<button
  {type}
  class="btn"
  class:active
  {disabled}
  {title}
  onclick={onclick}
  onkeydown={(e) => e.key === "Enter" && !disabled && onclick?.()}
>
  {@render children?.()}
</button>

<style>
  .btn {
    padding: 6px 12px;
    border: 1px solid rgba(0, 0, 0, 0.15);
    border-radius: 6px;
    background: #fff;
    color: #1d1d1f;
    cursor: pointer;
    font: inherit;
  }
  .btn:hover:not(:disabled) {
    background: #f0f0f0;
  }
  .btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .btn.active {
    background: #007aff;
    color: #fff;
    border-color: #007aff;
  }
  @media (prefers-color-scheme: dark) {
    .btn {
      background: #2d2d30;
      color: #f5f5f7;
      border-color: rgba(255, 255, 255, 0.2);
    }
    .btn:hover:not(:disabled) {
      background: #3a3a3c;
    }
    .btn.active {
      background: #0a84ff;
      border-color: #0a84ff;
    }
  }
</style>
