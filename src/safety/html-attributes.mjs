// Build-only hardening: escape template expressions in HTML attribute values.
// Historical IDs are unchanged in IndexedDB, backups and click callbacks.
export function escapeDynamicTemplateAttributes(source) {
  const attr = /\b((?:data-[a-zA-Z0-9-]+|value|for|id|aria-label|title|placeholder)=")\$\{([^{}]+)\}(")/g;
  let count = 0;
  const result = source.replace(attr, (_all, prefix, expression, suffix) => {
    const expr = expression.trim();
    if (/^(?:esc(?:2|3)|personaV4EscapeActivity)\s*\(/.test(expr)) return _all;
    count++;
    return prefix + "${esc2(" + expr + ")}" + suffix;
  });
  return { source: result, changed: count };
}
