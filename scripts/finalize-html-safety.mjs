import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { escapeDynamicTemplateAttributes } from "../src/safety/html-attributes.mjs";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const indexPath = resolve(root, "index.html");
let html = await readFile(indexPath, "utf8");

// Escape arbitrary imported IDs and user-provided HTML attribute values.
const escapedAttributes = escapeDynamicTemplateAttributes(html);
html = escapedAttributes.source;
const legacyTextSinks = [{"old":"memories.slice(0, 2).map((m) => m.info).join(\" \\xB7 \")","new":"memories.slice(0, 2).map((m) => esc2(m.info)).join(\" \\xB7 \")"},{"old":"loops.slice(0, 4).map((l) => l.text).join(\"; \")","new":"loops.slice(0, 4).map((l) => esc2(l.text)).join(\"; \")"},{"old":"mems.map((m2) => m2.info).join(\"; \")","new":"mems.map((m2) => esc2(m2.info)).join(\"; \")"}];
for (const sink of legacyTextSinks) {
  if (html.includes(sink.new)) continue;
  const count = html.split(sink.old).length - 1;
  if (count !== 1) throw new Error("Unescaped note sink drift: " + sink.old);
  html = html.replace(sink.old, sink.new);
}

await writeFile(indexPath, html, "utf8");
console.log("Escaped legacy record HTML attributes and saved notes");
