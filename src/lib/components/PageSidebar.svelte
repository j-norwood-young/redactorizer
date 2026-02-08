<script lang="ts">
  let {
    documentTitle = "",
    numPages = 0,
    thumbnails = {} as Record<number, string>,
    currentPageIndex = 0,
    onPageSelect = (_index: number) => {},
  }: {
    documentTitle?: string;
    numPages?: number;
    thumbnails?: Record<number, string>;
    currentPageIndex?: number;
    onPageSelect?: (index: number) => void;
  } = $props();

  const truncatedTitle = $derived(
    documentTitle.length > 24 ? documentTitle.slice(0, 21) + "…" : documentTitle
  );
</script>

<aside class="sidebar" role="navigation" aria-label="Page thumbnails">
  <div class="sidebar-title" title={documentTitle}>{truncatedTitle}</div>
  <div class="thumbnail-list">
    {#each Array.from({ length: numPages }, (_, i) => i) as pageIndex (pageIndex)}
      <button
        type="button"
        class="thumbnail-item"
        class:current={pageIndex === currentPageIndex}
        onclick={() => onPageSelect(pageIndex)}
        aria-label="Page {pageIndex + 1}"
        aria-current={pageIndex === currentPageIndex ? "true" : undefined}
      >
        <div class="thumbnail-preview">
          {#if thumbnails[pageIndex]}
            <img src={thumbnails[pageIndex]} alt="" width="120" height="160" />
          {:else}
            <span class="thumbnail-placeholder">…</span>
          {/if}
        </div>
        <span class="page-number" class:current={pageIndex === currentPageIndex}>
          {pageIndex + 1}
        </span>
      </button>
    {/each}
  </div>
</aside>

<style>
  .sidebar {
    width: 200px;
    min-width: 200px;
    background: #2c2c2e;
    color: #e5e5ea;
    display: flex;
    flex-direction: column;
    border-right: 1px solid #38383a;
    flex-shrink: 0;
  }
  .sidebar-title {
    padding: 12px 10px;
    font-size: 11px;
    color: #8e8e93;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    border-bottom: 1px solid #38383a;
  }
  .thumbnail-list {
    flex: 1;
    overflow-y: auto;
    padding: 8px;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .thumbnail-item {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
    padding: 0;
    margin: 0;
    background: transparent;
    border: none;
    border-radius: 6px;
    cursor: pointer;
    color: inherit;
    font: inherit;
  }
  .thumbnail-item:hover {
    background: #38383a;
  }
  .thumbnail-item.current .thumbnail-preview {
    box-shadow: 0 0 0 2px #0a84ff;
  }
  .thumbnail-preview {
    width: 120px;
    height: 160px;
    background: #1c1c1e;
    border-radius: 4px;
    overflow: hidden;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .thumbnail-preview img {
    width: 100%;
    height: 100%;
    object-fit: contain;
    display: block;
  }
  .thumbnail-placeholder {
    font-size: 24px;
    color: #48484a;
  }
  .page-number {
    font-size: 13px;
    color: #8e8e93;
  }
  .page-number.current {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    border-radius: 50%;
    background: #0a84ff;
    color: #fff;
    font-weight: 500;
  }
</style>
