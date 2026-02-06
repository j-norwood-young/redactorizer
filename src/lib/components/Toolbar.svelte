<script lang="ts">
</script>

<header class="toolbar">
  <slot />
</header>

<style>
  .toolbar {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 10px 16px;
    background: rgba(255, 255, 255, 0.8);
    border-bottom: 1px solid rgba(0, 0, 0, 0.08);
    flex-shrink: 0;
  }
  @media (prefers-color-scheme: dark) {
    .toolbar {
      background: rgba(45, 45, 48, 0.9);
      border-bottom-color: rgba(255, 255, 255, 0.1);
    }
  }
</style>
