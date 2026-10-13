# Persona AI 4.0 — Stage 7: Source-Grounded Local Copilot and Reviewed External AI

## Summary

Stage 7 adds a **local evidence desk** to Persona AI's existing Copilot while preserving the established record schema, all 34 routes, offline single-file packaging, local analysis, secure API-key storage and optional external-AI compatibility.

The upgrade is not a new, independently trained language model. It is a deterministic evidence retrieval and briefing layer with optional, separately consented provider analysis.

## Improvements

1. **Local source-grounded answers:** Asking about commitments, follow-ups, remembered details, past interactions, or conversation preparation retrieves and summarizes existing records belonging to the explicitly selected person. A missing selection produces an honest request to select a person rather than silently using the first contact.
2. **Clickable citations:** Answers show the original record type, recorded date and a short excerpt. A source-inspection dialog displays the stored observation and separately labels any interpretation. The original ID and record remain unchanged.
3. **Conversation briefing:** One action assembles the last recorded interaction, a few saved memories, outstanding commitments, relevant follow-ups and the closest due action with individual source links. Missing records are not filled with invented statements.
4. **Explicit uncertainty:** Answers report when evidence is insufficient and avoid claims about personalities, private intentions, diagnoses, or verified external facts.
5. **Local-default Copilot:** Both the main workspace Ask button and the compact Today Copilot use only local selectors, including when the user has configured an external provider.
6. **Privacy-controlled remote path:** A separate **Review external request** action presents the precise minimal JSON that would leave the device: selected person ID and name, question, and at most six selected source records. A separate, one-time **Send this context once** action is required to call the configured provider. Cancel or opening the preview sends nothing. No consent preference is stored.
7. **Provider-response validation:** Response citations must refer only to source IDs included in the approved packet; empty, unknown, overlong and forbidden-label responses are withheld. The user sees only validated answers; failed provider calls do not change local records.

## Architecture and version boundaries

- `src/domain/grounded-copilot.mjs`: read-only retrieval, conversation briefing, grounded answers, minimal external context and citation validation.
- `src/ui/grounded-copilot.mjs`: evidence desk, escaped source references, record inspections, local Ask, and explicit external-consent modal.
- `src/ui/grounded-copilot.css`: responsive and keyboard-focus-aware styling.
- `scripts/stage7-build.mjs`: deterministic integration into the self-contained `index.html`, after Stages 1–6 and before final security/HTML hardening.
- `tests/v4-grounded-copilot.test.mjs`: source isolation, no unsupported interpretations, safe HTML, citation membership, no schema regression.
- `scripts/full-browser-acceptance.mjs`: real Chrome actions: selected and missing person flows, clickable source, conversation briefing, main/compact Copilot zero-external-requests with provider configured, reviewed-context preview and decline.

**Unchanged:** app version 3.1.1; IndexedDB version 5; record schema version 7; all existing 33 stores and historic backup identities. Stage 7 does not migrate personal records or introduce an external dependency.

## Privacy boundaries and limitations

- Local Ask reads stored records in the current browser; it does not train, host, or contact a language model.
- The older **AI Insights** and other provider-specific analytical actions remain available separately with their existing explicit user activation and settings; the Stage 7 reviewed-context workflow applies to the **new Copilot evidence desk**, not universally to every older AI feature. A global privacy-policy audit remains valuable in Stage 10.
- If the user authorizes the optional provider request, the selected person's name, record excerpts and the question may be transmitted to the endpoint displayed in the preview. Do not imply end-to-end encryption of provider processing.
- The local retrieval is a small, deterministic, relevance-ranked search, not a trained semantic embedding or LLM. It may not understand every question and must not claim to.
- Source citations establish provenance **within the user's own notes**, not independent verification of the underlying event.
- Current remote-response validation checks citation scope and basic unsupported language. It does not prove model factual accuracy or eliminate every prompt-injection risk. Human review remains advisable.
- Data is not automatically persisted during Ask or external analysis. The existing optional model API key stays in the established session-only SecretStore.
- No calendar, background push, contact harvesting, or cross-device sync is added.

## Verification and release

The upgrade must pass `npm run check`, including `npm test`, static security verification, Chrome direct-file/HTTP browser smoke, complete backup and mock-provider acceptance, feature-workflow acceptance, and the new local-vs-provider behavior checks.

After isolated branch success, open a PR; verify PR checks; merge; wait for separate main certification; confirm the live GitHub Pages deployment and exact-artifact smoke test. **Do not call Stage 7 deployed until that last check succeeds.**

Manual Safari and screen-reader QA is an additional Stage 9/10 requirement, not replaced by Chrome automation.
