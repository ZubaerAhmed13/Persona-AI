# Persona AI 4.0 — Stage 9: Mobile, Accessibility & Performance Polish

## Objective

Make the existing local-first relationship workspaces comfortable and usable on narrow screens and with keyboard/assistive technology **without migrating records, replacing views or sacrificing the self-contained offline build**.

## Implemented changes

### Mobile (320px / 390px / 720px tested)

- The six primary mobile destinations remain reachable through a horizontally scrollable rail on narrow phones, rather than squeezing six unreadable labels into a single 320px row.
- The active destination is brought into view on navigation, with no page-wide horizontal scroll.
- Controls receive larger, predictable touch targets, including shortcuts, navigation, review actions, and modal buttons.
- Form input font size is at least 16px on mobile to reduce disruptive automatic zoom.
- Safe-area bottom spacing is respected for the navigation rail, floating capture action, and scrollable page content.
- Cards, headings, imported text, responsive dialog bodies, and wide tables handle narrow layouts more gracefully.
- The mobile dialogue occupies available viewport height while permitting its body to scroll.

### Keyboard and screen-reader navigation

- A visible-on-focus **Skip to main content** link gives keyboard users a shortcut past navigation.
- Displayed page titles gain proper heading semantics and label the main content region without changing the underlying legacy templates.
- When navigation is activated via an existing navigation control, focus moves to the new screen heading; routine CRUD rerenders do not steal focus.
- The sidebar menu button exposes its expanded state. Escape closes an open sidebar and restores focus to the menu button.
- Modal dialogs now have an accessible name, trap both Tab and Shift+Tab, support Escape, clean up listeners when closed, and restore focus to the control that opened them.
- User-specified reduced motion disables decorative view, modal, toast, and sidebar transitions.

### Performance and safety boundaries

- Stage 9 adds no network dependency, external stylesheet, tracking, scheduler, cloud service, font download, or IndexedDB write.
- Modals remove their keydown listeners after closing. This prevents handlers from accumulating after repeated dialog operations.
- The mobile navigation scrolls only when its active destination is outside the currently visible section; avoid unnecessary layout animation.
- Native browser overflow behavior is used for narrow rail, long tables and dialog contents. The app continues to ship as one locally operable HTML file.
- Existing 33 data stores, schema v7, IndexedDB version 5, app/backup v3.1.1 contracts, and the old 34-view navigation are unchanged.

## Source changes

- `src/ui/mobile-accessibility.mjs` — focusable controls, dialog key handling, mobile rail, semantic headings, sidebar behavior.
- `src/ui/mobile-accessibility.css` — adaptive touch targets, safe area, reduced motion, modal and long-text handling.
- `scripts/stage9-build.mjs` — additive, idempotent production-bundle integration and modal lifecycle repair.
- `package.json` — Stage 9 runs after Stage 8 and before final security/HTML hardening.
- `tests/v4-mobile-accessibility.test.mjs` — dialog focus unit tests and offline contract protections.
- `scripts/full-browser-acceptance.mjs` — real Chromium viewport checks at 320px, 390px and 720px across Today, People, Activity, Follow-ups and Copilot; no page overflow, mobile navigation reachability, touch targets, heading semantics, safe focus trap, Escape, restoration, and reduced motion.

## Test evidence and limits

The development branch passed **all established npm build, unit/security, production verification, browser smoke, full product/backup/AI browser acceptance and major feature workflows** in [GitHub Actions #38450387363](https://github.com/ZubaerAhmed13/Persona-AI/actions/runs/38450387363).

Testing at phone-sized Chromium viewports is **not** the same as physical iOS Safari, Android accessibility, VoiceOver or TalkBack certification. Stage 10 should include a manual device and assistive-technology checklist, WCAG contrast/color review, and measurement of actual startup performance before describing broad accessibility or performance compliance.

## Release gate

1. The isolated branch has its compiled single-file `index.html` committed, and repeated builds are deterministic.
2. Independent PR checks pass on the exact PR HEAD.
3. Main-branch verification passes following merge.
4. The GitHub Pages deployment serves the exact certified artifact and passes the live smoke test.
5. No stage is represented as live before the last release gate is complete.
