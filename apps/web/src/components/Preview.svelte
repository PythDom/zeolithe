<script lang="ts">
  interface Props {
    html: string;
    onOpenLink: (target: string, heading: string) => void;
    onToggleTask: (line: number) => void;
    onTag: (tag: string) => void;
  }
  let { html, onOpenLink, onToggleTask, onTag }: Props = $props();

  function click(e: MouseEvent) {
    const el = e.target as HTMLElement;
    const box = el.closest<HTMLInputElement>("input.task-box");
    if (box) {
      e.preventDefault();
      onToggleTask(Number(box.dataset.line));
      return;
    }
    const link = el.closest<HTMLAnchorElement>("a.wikilink");
    if (link) {
      e.preventDefault();
      onOpenLink(link.dataset.target ?? "", link.dataset.heading ?? "");
      return;
    }
    const tag = el.closest<HTMLAnchorElement>("a.tag");
    if (tag) {
      e.preventDefault();
      onTag(tag.dataset.tag ?? "");
      return;
    }
    const a = el.closest<HTMLAnchorElement>("a[href]");
    if (a && /^https?:/.test(a.getAttribute("href") ?? "")) {
      e.preventDefault();
      window.open(a.href, "_blank", "noopener");
    }
  }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div class="preview" onclick={click}>
  <article class="markdown">{@html html}</article>
</div>

<style>
  .preview {
    height: 100%;
    overflow: auto;
    padding: 12px 20px 30vh;
  }
  .markdown {
    max-width: 820px;
    margin: 0 auto;
    line-height: 1.65;
    font-size: 15px;
  }
</style>
