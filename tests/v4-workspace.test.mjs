import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { renderPersonaV4FollowUps } from "../src/ui/workspace.mjs";

const root = new URL("../", import.meta.url);
const html = await readFile(new URL("index.html", root), "utf8");
const css = await readFile(new URL("src/ui/workspace.css", root), "utf8");

test("six top-level workspace destinations are embedded without replacing old 34 routes", () => {
  assert.match(html, /PERSONA_V4_WORKSPACE_RUNTIME_START/);
  assert.match(html, /PERSONA_V4_WORKSPACE_CSS_START/);
  assert.match(html, /followups:\s*renderPersonaV4FollowUps/);
  assert.match(html, /personaV4InitWorkspace\(\);/);
  const block = html.slice(html.indexOf("/* PERSONA_V4_WORKSPACE_RUNTIME_START */"), html.indexOf("/* PERSONA_V4_WORKSPACE_RUNTIME_END */"));
  for (const name of ["dashboard", "people", "interactions", "followups", "patterns", "copilot"]) {
    assert.match(block, new RegExp('"' + name + '"'));
  }
  for (const old of ["openloops", "decisionlab", "playbook", "monthly", "privacy"]) {
    assert.match(html, new RegExp('data-view="' + old + '"'));
  }
  assert.match(block, /All tools · 34 legacy views/);
  assert.match(block, /aria-current/);
  assert.match(block, /aria-expanded/);
});

test("responsive theme-aware workspace styles preserve reduced motion and focus states", () => {
  assert.match(css, /@media \(max-width: 720px\)/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(css, /:focus-visible/);
  assert.match(css, /--accent/);
  assert.match(css, /#primaryNav\[hidden\]/);
  assert.doesNotMatch(css, /https?:\/\//);
});

test("follow-up page renders actionable real records, correct counts, and escaped text", () => {
  const originals = new Map();
  const install = (key, value) => {
    originals.set(key, Object.prototype.hasOwnProperty.call(globalThis, key) ? globalThis[key] : undefined);
    globalThis[key] = value;
  };
  try {
    install("todayLocal", () => "2026-10-13");
    install("esc2", (v) => String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;"));
    install("personName", (id) => id === "p1" ? "Example Person" : "Other");
    const state = {
      contextPersonId: "all",
      data: {
        followUps: [
          { id: "old", personId: "p1", text: "<script>alert(1)</script>", dueDate: "2026-10-11" },
          { id: "today", personId: "p1", text: "Talk", dueDate: "2026-10-13" },
          { id: "done", personId: "p1", text: "Finished", status: "done", dueDate: "2026-10-01" },
          { id: "future", personId: "p2", text: "Future", dueDate: "2026-10-19" }
        ]
      }
    };
    install("getState", () => state);
    const page = renderPersonaV4FollowUps();
    assert.match(page, /Follow-ups/);
    assert.match(page, /<strong>3<\/strong><span>Open<\/span>/);
    assert.match(page, /<strong>2<\/strong><span>Due now<\/span>/);
    assert.match(page, /<strong>1<\/strong><span>Completed<\/span>/);
    assert.match(page, /data-action="completeFollowUp" data-arg="old"/);
    assert.match(page, /data-action="snoozeFollowUp" data-arg="today"/);
    assert.match(page, /&lt;script>alert\(1\)&lt;\/script>/);
    assert.doesNotMatch(page, /<script>/);
    state.contextPersonId = "p2";
    const scoped = renderPersonaV4FollowUps();
    assert.match(scoped, /Future/);
    assert.doesNotMatch(scoped, /Talk/);
    assert.match(scoped, /<strong>1<\/strong><span>Open<\/span>/);
  } finally {
    for (const [key, value] of originals) {
      if (value === undefined) delete globalThis[key]; else globalThis[key] = value;
    }
  }
});
