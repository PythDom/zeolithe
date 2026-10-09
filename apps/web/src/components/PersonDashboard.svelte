<script lang="ts">
  import { personDashboard, type Person } from "@zeolite/core";
  import Preview from "./Preview.svelte";

  interface Props {
    people: Person[];
    /** Person shown first (e.g. the one of the open one-on-one note). */
    initial?: string;
    render: (markdown: string) => string;
    onOpenLink: (target: string, heading: string) => void;
    onToggleTask: (line: number, path?: string) => void;
    /** Save the dashboard of a person as a note (live queries). */
    onSave: (title: string, markdown: string) => void;
    onClose: () => void;
  }
  let { people, initial, render, onOpenLink, onToggleTask, onSave, onClose }: Props = $props();

  // svelte-ignore state_referenced_locally
  let person = $state(initial && people.some((p) => p.name === initial) ? initial : (people[0]?.name ?? ""));
  const markdown = $derived(person ? personDashboard(person) : "");
  const html = $derived(markdown ? render(markdown) : "");
</script>

<svelte:window onkeydown={(e) => e.key === "Escape" && onClose()} />

<div class="backdrop" role="presentation" onclick={(e) => e.target === e.currentTarget && onClose()}>
  <div class="dialog" role="dialog" aria-label="One-on-one dashboard">
    <header>
      <h2>👥 One-on-one dashboard</h2>
      <button class="x" aria-label="Close" onclick={onClose}>✕</button>
    </header>
    {#if people.length === 0}
      <p class="empty">No one yet: create a <b>One-on-One</b> note (＋ New note) and add a person there.</p>
    {:else}
      <div class="people" role="radiogroup" aria-label="Person">
        {#each people as p}
          <button role="radio" aria-checked={person === p.name} class:active={person === p.name} onclick={() => (person = p.name)}>{p.name}</button>
        {/each}
      </div>
      <div class="body">
        <Preview {html} {onOpenLink} {onToggleTask} onTag={() => {}} />
      </div>
      <footer>
        <span class="hint">Live: ticking an action here ticks it in its note.</span>
        <button onclick={() => onSave(`1on1 dashboard - ${person}`, markdown)} disabled={!person} title="Creates a note with these queries in the Searches folder">Save as note</button>
        <button class="primary" onclick={onClose}>Close</button>
      </footer>
    {/if}
  </div>
</div>

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 50;
    display: grid;
    place-items: center;
    padding: calc(16px + var(--safe-top)) calc(16px + var(--safe-right)) calc(16px + var(--safe-bottom)) calc(16px + var(--safe-left));
    background: rgb(0 0 0 / 0.35);
  }
  .dialog {
    display: flex;
    flex-direction: column;
    width: min(860px, 100%);
    height: min(900px, 100%);
    border-radius: 12px;
    background: var(--panel);
    color: var(--fg);
    box-shadow: 0 20px 60px rgb(0 0 0 / 0.3);
    overflow: hidden;
  }
  header,
  footer {
    display: flex;
    gap: 8px;
    align-items: center;
    padding: 12px 16px;
  }
  header {
    border-bottom: 1px solid var(--border);
  }
  footer {
    justify-content: flex-end;
    border-top: 1px solid var(--border);
  }
  h2 {
    flex: 1;
    margin: 0;
    font-size: 17px;
  }
  .x {
    border: none;
    background: none;
    color: var(--muted);
    font-size: 16px;
    cursor: pointer;
  }
  .people {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    padding: 10px 16px;
    border-bottom: 1px solid var(--border);
  }
  .people button {
    padding: 6px 12px;
    border: 1px solid var(--border);
    border-radius: 999px;
    background: var(--bg);
    color: var(--fg);
    font: inherit;
    font-size: 14px;
    cursor: pointer;
  }
  .people button.active {
    border-color: var(--accent);
    background: var(--accent-soft);
    font-weight: 600;
  }
  .body {
    flex: 1;
    min-height: 0;
    overflow: auto;
  }
  .empty {
    padding: 16px;
    color: var(--muted);
  }
  .hint {
    margin-right: auto;
    color: var(--muted);
    font-size: 12.5px;
  }
  footer button {
    padding: 8px 14px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: transparent;
    color: var(--fg);
    font: inherit;
    cursor: pointer;
  }
  footer .primary {
    border-color: var(--accent);
    background: var(--accent);
    color: var(--on-accent);
  }
  footer button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
</style>
