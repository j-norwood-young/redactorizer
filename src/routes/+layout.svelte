<script lang="ts">
  import { afterNavigate } from "$app/navigation";
  import { listen } from "@tauri-apps/api/event";
  import { getVersion } from "@tauri-apps/api/app";
  import type { Snippet } from "svelte";
  import { Button } from "$lib/components";
  import "../app.css";

  let { children } = $props<{ children?: Snippet }>();
  let aboutOpen = $state(false);
  let version = $state<string>("");

  afterNavigate(() => {
    window.scrollTo(0, 0);
  });

  $effect(() => {
    getVersion().then((v) => {
      version = v;
    });
  });

  $effect(() => {
    let unlisten: (() => void) | undefined;
    listen<string>("menu-action", (event) => {
      if (event.payload === "helpAbout") {
        aboutOpen = true;
      }
    }).then((fn) => {
      unlisten = fn;
    });
    return () => {
      unlisten?.();
    };
  });

  function closeAbout(): void {
    aboutOpen = false;
  }

  function handleAboutBackdropClick(e: MouseEvent): void {
    if ((e.target as HTMLElement).dataset.aboutBackdrop === "true") {
      closeAbout();
    }
  }

  function handleAboutKeydown(e: KeyboardEvent): void {
    if (e.key === "Escape") closeAbout();
  }

  let aboutModalEl = $state<HTMLDivElement | null>(null);

  $effect(() => {
    if (!aboutOpen) return;
    const el = aboutModalEl;
    if (el) {
      el.focus();
    }
    const onKeydown = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeAbout();
    };
    window.addEventListener("keydown", onKeydown);
    return () => window.removeEventListener("keydown", onKeydown);
  });
</script>

{@render children?.()}

{#if aboutOpen}
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <div
    class="about-modal-backdrop"
    data-about-backdrop="true"
    role="presentation"
    onclick={handleAboutBackdropClick}
    onkeydown={handleAboutKeydown}
  >
    <div
      bind:this={aboutModalEl}
      class="about-modal"
      role="dialog"
      aria-modal="true"
      aria-labelledby="about-title"
      tabindex="-1"
      onkeydown={handleAboutKeydown}
    >
      <div class="about-modal-content">
        <h1 id="about-title">About Redactorizer</h1>
        <p class="about-tagline">Redact the heck out of your documents.</p>
        <p class="about-version">Version {version || "…"}</p>
        <p class="about-body">
          Redactorizer is designed to let investigative journalists redact sensitive information
          from documents in order to protect the identity of sources and to avoid potential legal
          exposure.
        </p>
        <p class="about-body">
          Redactorizer lets you open images and PDFs, draw redaction shapes (rectangles, ellipses,
          or freehand), and apply pixelation or blur. Export as PDF or PNG with your redactions
          applied.
        </p>
        <p class="about-body">
          Built by <a href="mailto:jason@10layer.com">Jason Norwood-Young</a>.
        </p>
        <Button title="Close" onclick={closeAbout}>Close</Button>
      </div>
    </div>
  </div>
{/if}

<style>
  .about-modal-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.4);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
    padding: 24px;
  }
  .about-modal {
    background: #f5f5f7;
    border-radius: 12px;
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.25);
    max-width: 440px;
    width: 100%;
    max-height: calc(100vh - 48px);
    overflow: auto;
  }
  .about-modal-content {
    padding: 24px;
    font-size: 13px;
    color: #1d1d1f;
  }
  .about-modal-content h1 {
    margin: 0 0 6px;
    font-size: 22px;
    font-weight: 600;
    letter-spacing: -0.02em;
    color: #1d1d1f;
  }
  .about-tagline {
    margin: 0 0 12px;
    font-size: 15px;
    color: #6e6e73;
    font-weight: 400;
  }
  .about-version {
    margin: 0 0 20px;
    font-size: 12px;
    color: #86868b;
  }
  .about-body {
    margin: 0 0 12px;
    line-height: 1.5;
    font-size: 13px;
    color: #1d1d1f;
  }
  .about-body:last-of-type {
    margin-bottom: 20px;
  }
  .about-modal-content a {
    color: #007aff;
  }
  .about-modal-content a:hover {
    text-decoration: underline;
  }
  .about-modal-content a:visited {
    color: #007aff;
  }
  @media (prefers-color-scheme: dark) {
    .about-modal {
      background: #1d1d1f;
      box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
    }
    .about-modal-content {
      color: #f5f5f7;
    }
    .about-modal-content h1,
    .about-body {
      color: #f5f5f7;
    }
    .about-tagline,
    .about-version {
      color: #86868b;
    }
  }
</style>
