# Avoid AI Writing in the editorial pipeline

Effective for newly written or actively resumed drafts from 2026-11-10. This is a host-side editorial workflow using the installed Avoid AI Writing plugin, not a Telegram API method or a server-side AI detector. The only queue and publisher remain unchanged.

## Load the actual plugin

Before writing or materially revising a draft, discover and read the installed `avoid-ai-writing:avoid-ai-writing-router` and its canonical `avoid-ai-writing` rulebook. Follow its `voice-preserving-rewriter` and `preservation-verifier` instructions. For a detect-only review use `ai-writing-detector`. The rulebook observed at integration was version 3.29.0; record the version actually read, not this historical value by assumption.

In this host the observed package root is `skill://plugins_6a9b77b18b8881918efa9c1255868164/`. Resolve the named installed skills through the current catalog and skills reader; this URI is a resource locator, not an HTTP endpoint. The canonical rulebook is the `avoid-ai-writing` package, even when only specialized skills are advertised. Do not replace reading the plugin with a copied blacklist or claim an invented tool such as "humanize_text". If plugin instructions cannot be loaded, keep the new draft at writing/review with the exact blocker. Report it through the existing task only, without another scheduled check.

## Writer stage

1. Research and draft first. Preserve an immutable before-version: actual Git commit/path or a durable draft checkpoint containing the complete source text. Extract prose from queue JSON for the returned-text rewrite workflow; never pass configuration, queue JSON, source code, ledger or receipts to file-edit-in-place.
2. Use the router's audit -> targeted rewrite -> preservation verification sequence. Carry Russian language, Money Psychology's existing thoughtful magazine voice, destination and protected constraints through the handoff. Prefer the existing draft register and accepted channel samples over a generic blunt persona.
3. Audit Russian by meaning and construction: interchangeable openings, inflated importance, empty transitions, mechanical "не X, а Y", repetitive triads/paragraph shapes, moralizing, generic conclusions and fabricated personal experience. This is editorial judgment. Do not blindly translate an English blacklist, impose English punctuation on Russian, remove grammatical Russian dashes or introduce deliberate mistakes.
4. Edit only the passages that need it. Preserve sound passages. Protect facts, names, dates, currency, numbers, denominators, assumptions, causal scope, evidence limits, jurisdiction, direct quotations, attributed text, tables, URLs, technical terms and the distinction between research and a teaching example. Financial/legal uncertainty stays when substantively necessary. No invented first person, facts, scenes, claims or artificial staccato voice.
5. Compare the before-version with the final prose using preservation-verifier. Check semantic constraints as well as structure. PASS is required for this draft stage. REVIEW requires resolving the material warnings; FAIL returns only implicated spans to the writer for one bounded repair. Maximum two rewrite passes total, including any corrective/repair pass; verify again once. A remaining failure becomes a truthful draft blocker, not another rewrite cycle.
6. Only the final corrected prose enters the canonical article and queue. Keep audit notes out of the Telegram text. Recompute payload hashes, update the matching article copy and obtain genuine renewed writer/final reviews after any payload change.

When safe Node execution and the plugin's bundled scripts are available, run the actual `ai-writing-detector/scripts/detect.js` and `preservation-verifier/scripts/validate.js` with their actual dependencies. Otherwise apply the loaded rules and compare manually, recording `model_only`. Execution requires actual tool evidence. Never invent a score or substitute a model judgment for script output. The detector's coverage is predominantly English; a low score on Russian cannot establish natural writing, factual accuracy or authorship. In the integration smoke run on a real Russian draft, the bundled detector treated ordinary Cyrillic letters as thousands of homoglyph substitutions and emitted an AI_ONLY classification. Treat that normalization/classification output on Cyrillic prose as an inapplicable false positive; never require transliteration, retyping, stripping Cyrillic or a numerical score target. Use the Russian editorial audit and protected-content comparison. There is no zero-score quota or new detector threshold that decides publication.

## Evidence and independent review

For new/resumed drafts record `editorial_review.style_review` alongside, not inside or instead of, existing pipeline/release reviews:

- plugin name and the rulebook version actually read;
- actual writer/run reference and timestamp;
- immutable before_ref and before/after UTF-8 prose SHA256;
- exact final payload_hash using the canonical recipe;
- `execution_evidence.detector` and `.verifier`: `model_only` or `executed`; include command/result references only for actual executions;
- specific findings and edits, any contextually retained pattern and why;
- passes actually performed, preservation_status and unresolved errors.

This is an editorial attestation, not proof of authorship or cryptographic proof that a model obeyed a skill. The current MCP server does not execute ChatGPT skills or independently enforce this new style metadata. Do not describe a saved note as such a server gate.

The independent editor checks the exact final text, the writer's specific findings, before/after preservation and hash binding as part of the existing language/evidence review. Do not repeat the complete rewrite when nothing changed. A necessary material repair returns to the writer under the same pass cap; final release still requires the existing genuinely independent review. No self-signed independence, invented PASS or merely replaced hashes.

## Other existing roles and compatibility

- Preparation and an independent preflight resuming an unfinished draft apply this stage before its release. Existing approved queued payloads and every sending/published/uncertain/failed entry are preserved; absent historical style metadata is not a reason to stop delivery.
- The 11:00 preflight may audit existing approved copy without mutation. It does not retroactively add a fabricated style history or rewrite queued material.
- The noon publisher performs no rewrite or detector run and adds no style dependency to its sending path. Keep the exact reviewed payload, durable claim, receipt reconciliation and one-send rules.
- The weekly editorial audit uses detect-only on sampled actual texts, reports concrete repeated patterns and incorporates them into future briefs. It never rewrites published articles.
- Success remains quiet in existing scheduled checks. Do not create another automation, chat-generating monitor, sender, API key, external detector subscription or new public transport.
