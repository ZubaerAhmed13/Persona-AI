import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const indexPath = resolve(root, "index.html");
let html = await readFile(indexPath, "utf8");

function replaceOnce(oldText, newText, label, alreadyText) {
  if (html.includes(alreadyText)) return;
  const matches = html.split(oldText).length - 1;
  if (matches !== 1) throw new Error(`${label}: expected one source match, found ${matches}`);
  html = html.replace(oldText, newText);
}

// tagInput() is used inside modal forms. Give each group the id already used by
// the form save handlers, while retaining the data-taggroup contract used by UI binding.
replaceOnce(
  `    <div class="tag-grid" data-taggroup="\${id}">`,
  `    <div class="tag-grid" id="\${id}" data-taggroup="\${id}">`,
  "functional tag group id",
  `id="\${id}" data-taggroup="\${id}"`
);

// Modal content lives outside #view. Binding only root() (#view) leaves modal tag
// buttons inert. Bind every current tag group in the document; each modal is removed
// on close, so this does not accumulate handlers on stale nodes.
replaceOnce(
  `    root().querySelectorAll("[data-taggroup]").forEach((g) => {`,
  `    document.querySelectorAll("[data-taggroup]").forEach((g) => {`,
  "modal tag group binding",
  `document.querySelectorAll("[data-taggroup]").forEach((g) => {`
);

// The person profile already allows an active memory to be marked remembered even
// without a reminder. Keep the dedicated Memories view consistent with that lifecycle.
// A reminder date remains optional metadata rather than a prerequisite for completion.
replaceOnce(
  `      \${m.reminderDate && m.status !== "done" ? \`<button class="btn btn-sm" data-action="completeMemory" data-arg="\${m.id}">Check in</button>\` : ""}`,
  `      \${m.status !== "done" ? \`<button class="btn btn-sm" data-action="completeMemory" data-arg="\${m.id}">Mark remembered</button>\` : ""}`,
  "memory completion action consistency",
  `\${m.status !== "done" ? \`<button class="btn btn-sm" data-action="completeMemory" data-arg="\${m.id}">Mark remembered</button>\` : ""}`
);

await writeFile(indexPath, html, "utf8");
console.log("Applied Persona modal tag/context and memory lifecycle functional fixes");
