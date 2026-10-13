import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { escapeDynamicTemplateAttributes } from "../src/safety/html-attributes.mjs";

const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
const attrRE = /\b((?:data-[a-zA-Z0-9-]+|value|for|id|aria-label|title|placeholder)=")\$\{([^{}]+)\}(")/g;

test("untrusted historical IDs are escaped in HTML attributes without changing their identity", () => {
  const source = '<button data-arg="${p.id}"><option value="${p.id}">${esc2(p.name)}</option></button>';
  const result = escapeDynamicTemplateAttributes(source);
  assert.equal(result.changed, 2);
  assert.equal(result.source,
    '<button data-arg="${esc2(p.id)}"><option value="${esc2(p.id)}">${esc2(p.name)}</option></button>');
  assert.deepEqual(escapeDynamicTemplateAttributes(result.source), { source: result.source, changed: 0 },
    "Safe attribute escaping must be idempotent under repeated builds");
});

test("generated legacy HTML has no unescaped dynamic dataset, value or accessibility attributes", () => {
  const unsafe = [...html.matchAll(attrRE)].filter((m) => !/^esc(?:2|3)\s*\(/.test(m[2].trim()))
    .map((m) => m[0]);
  assert.deepEqual(unsafe, [], "Potential imported ID/attribute injection in production templates");
  assert.ok(html.includes('data-arg="${esc2(p.id)}"'), "Person click IDs not escaped");
  assert.ok(html.includes('value="${esc2(p.id)}"'), "Person select IDs not escaped");
});

test("legacy person memory and preparation HTML escapes raw observations before insertion", () => {
  for (const marker of [
    'memories.slice(0, 2).map((m) => esc2(m.info)).join(',
    'loops.slice(0, 4).map((l) => esc2(l.text)).join(',
    'mems.map((m2) => esc2(m2.info)).join('
  ]) assert.ok(html.includes(marker), "User-controlled note interpolation not escaped: " + marker);
  for (const unsafe of [
    'memories.slice(0, 2).map((m) => m.info).join(',
    'loops.slice(0, 4).map((l) => l.text).join(',
    'mems.map((m2) => m2.info).join('
  ]) assert.equal(html.includes(unsafe), false);
});
