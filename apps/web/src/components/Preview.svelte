<script lang="ts">
  import { openExternal } from "../lib/native";
  interface Props {
    html: string;
    onOpenLink: (target: string, heading: string) => void;
    onToggleTask: (line: number, path?: string) => void;
    onTag: (tag: string) => void;
    /** Chord-sheet buttons: transpose, fingerings, diagrams. */
    onChordAction?: (action: string, block: number, chord: string, instrument: string) => void;
    /** Diagram HTML for the hover popup over a chord. */
    chordTip?: (chord: string, instrument: string) => string;
    /** Autoscroll speed (1–10) while playing, null when stopped. */
    autoscroll?: number | null;
    /** Called when autoscroll reaches the end of the note. */
    onAutoscrollEnd?: () => void;
  }
  let { html, onOpenLink, onToggleTask, onTag, onChordAction, chordTip, autoscroll = null, onAutoscrollEnd }: Props = $props();

  let pane: HTMLDivElement;

  // Autoscroll: smooth scrolling at a steady speed, screen kept awake.
  $effect(() => {
    const speed = autoscroll;
    if (!speed || !pane) return;
    const pxPerSecond = 6 + speed * 8;
    let last = performance.now();
    let carry = 0;
    let frame = 0;
    let lock: { release(): Promise<void> } | undefined;
    (navigator as Navigator & { wakeLock?: { request(t: string): Promise<{ release(): Promise<void> }> } }).wakeLock
      ?.request("screen")
      .then((l) => (lock = l))
      .catch(() => {});
    const step = (now: number) => {
      carry += ((now - last) / 1000) * pxPerSecond;
      last = now;
      const whole = Math.floor(carry);
      if (whole > 0) {
        pane.scrollTop += whole;
        carry -= whole;
      }
      if (pane.scrollTop + pane.clientHeight >= pane.scrollHeight - 1) return onAutoscrollEnd?.();
      frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => {
      cancelAnimationFrame(frame);
      lock?.release().catch(() => {});
    };
  });

  let tip = $state<{ html: string; x: number; y: number } | null>(null);

  function over(e: MouseEvent) {
    const el = (e.target as HTMLElement).closest<HTMLElement>(".chord-sheet .chord");
    if (!el || !chordTip) return (tip = null);
    const instrument = el.closest<HTMLElement>(".chords")?.dataset.instrument ?? "guitar";
    const r = el.getBoundingClientRect();
    tip = { html: chordTip(el.dataset.chord ?? "", instrument), x: r.left + r.width / 2, y: r.bottom + 6 };
  }

  function click(e: MouseEvent) {
    const el = e.target as HTMLElement;
    const act = el.closest<HTMLElement>("[data-act]");
    if (act && act.dataset.act && onChordAction) {
      e.preventDefault();
      const instrument = act.dataset.instrument ?? act.closest<HTMLElement>(".chords")?.dataset.instrument ?? "guitar";
      onChordAction(act.dataset.act, Number(act.dataset.block ?? 0), act.dataset.chord ?? "", instrument);
      return;
    }
    const box = el.closest<HTMLInputElement>("input.task-box");
    if (box) {
      e.preventDefault();
      onToggleTask(Number(box.dataset.line), box.dataset.path);
      return;
    }
    const link = el.closest<HTMLAnchorElement>("a.wikilink");
    if (link) {
      e.preventDefault();
      onOpenLink(link.dataset.target ?? "", link.dataset.heading ?? "");
      return;
    }
    // Markdown links to a heading of this note: [Heading](#heading).
    const anchor = el.closest<HTMLAnchorElement>('a[href^="#"]:not(.tag)');
    const href = anchor?.getAttribute("href") ?? "";
    if (anchor && href.length > 1) {
      e.preventDefault();
      let h = href.slice(1);
      try {
        h = decodeURIComponent(h);
      } catch {
        // Keep it as written.
      }
      onOpenLink("", h);
      return;
    }
    const tag = el.closest<HTMLAnchorElement>("a.tag");
    if (tag) {
      e.preventDefault();
      onTag(tag.dataset.tag ?? "");
      return;
    }
    // Web and mail links: the system browser / mail app (a new window cannot open inside the apps).
    const ext = el.closest<HTMLAnchorElement>("a[href]");
    const url = ext?.getAttribute("href") ?? "";
    if (ext && /^(https?:|mailto:|tel:)/i.test(url)) {
      e.preventDefault();
      void openExternal(url);
      return;
    }
  }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div class="preview" bind:this={pane} onclick={click} onmouseover={over} onmouseleave={() => (tip = null)} onfocusin={() => (tip = null)}>
  <article class="markdown">{@html html}</article>
</div>
{#if tip}
  <div class="chord-tip" style:left="{tip.x}px" style:top="{tip.y}px" role="tooltip">{@html tip.html}</div>
{/if}

<style>
  .chord-tip {
    position: fixed;
    z-index: 60;
    transform: translateX(-50%);
    padding: 6px;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--panel);
    color: var(--fg);
    box-shadow: 0 8px 24px rgb(0 0 0 / 0.18);
    pointer-events: none;
  }
  .preview {
    height: 100%;
    overflow: auto;
    padding: 12px 20px 30vh;
  }
  .markdown {
    max-width: 820px;
    margin: 0 auto;
    line-height: 1.65;
    font-size: var(--note-size, 15px);
  }
</style>
