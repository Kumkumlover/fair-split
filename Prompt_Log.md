# Prompt Log — Fair Split Development

## Development Methodology & Tooling

### Antigravity CLI + Planning-with-Files Skill
This project was developed using the Antigravity AI coding agent. Before writing a single line of code, the **planning-with-files** skill was installed from the open-source repo `https://github.com/OthmanAdi/planning-with-files` to enforce a structured, persistent planning workflow across the session. This generated three living documents (`task_plan.md`, `findings.md`, `progress.md`) that tracked research, architecture decisions, and task status throughout the entire build.

### Guidelines
A `Guidelines.md` was created upfront to set the ground rules for agent velocity — enforcing verification loops, structured prompting, and a plan-then-execute workflow before any code was generated.

### Inspiration & Scavenger Methodology
Rather than building from scratch, the development strategy was explicitly "extreme code reuse" — scavenging proven patterns from existing open-source repositories:

- **[Nutlope/billsplit](https://github.com/Nutlope/billsplit)**: Cloned and read for its strict JSON schema prompting technique for Vision LLMs. The `scrapeBill.ts` and `response_format: { type: "json_object", schema: jsonSchema }` pattern was directly adapted into our `extractor.js`.
- **[AakashSasikumar/splitmybill](https://github.com/AakashSasikumar/splitmybill)**: Cloned and read for its deterministic proportional math approach. The concept of computing a multiplier `M = Tax / Subtotal` to allocate charges proportionally was ported into `mathEngine.js`.
- **[saketrama-v/SPLIT](https://github.com/saketrama-v/SPLIT)**: Reviewed for Gemini multimodal mapping patterns — passing the plain-text description alongside the image in the same prompt.
- **[maxwellcsutton/discord-receipt-splitter](https://github.com/maxwellcsutton/discord-receipt-splitter)**: Reviewed for headless, stateless API-only architecture patterns.

The user also introduced the **"Ephemeral Zero-Account Architecture"** concept (inspired by Splitkaro and Partly), which confirmed that the no-persistence, one-shot API design was not just a technical constraint of the assignment but a legitimate modern fintech architecture pattern.

---

## The Core Design Question

### Did you let the model do the arithmetic, or extract structured data and compute the totals in code? Why?

**The model was explicitly forbidden from doing any arithmetic. All calculations are performed in code.**

The LLM's only job is to read the receipt image and transcribe raw facts into a strict JSON schema — item names, quantities, amounts as printed, who shared what, and the printed subtotal/tax/total. Every instruction in the prompt reinforces this: *"DO NOT do any math."*

All proportional allocation (tax per person, service charge per person), weighted splitting (uneven portions), rounding resolution, and the debt settlement graph are computed deterministically in `mathEngine.js`.

**Why?** LLMs are autoregressive next-token predictors. They are structurally unreliable at floating-point arithmetic, especially when tracking multi-item fractional splits across several people simultaneously. In our very first iteration (before the schema was strict), the LLM was given freedom and it:
- Hallucinated fractional prices (outputting the already-split price instead of the line price)
- Lost track of rounding and generated totals that didn't add up
- Misread a service charge as tax because the labels looked similar

The solution, directly borrowed from the Nutlope pattern, is to treat the LLM as a **data transcription layer only** — like a very smart OCR with semantic understanding — and let deterministic code own the math entirely.

---

## Prompt Iteration History

### Phase 1: Unstructured Prompt (Discarded Before Code)
**What was planned but avoided**: Asking the model to "split the bill based on this photo and description."  
**Why abandoned**: This approach would let the LLM invent numbers. The scavenger research (Nutlope pattern) made clear that structured schema output was the only reliable approach.

### Phase 2: Strict JSON Schema Extraction (Implemented in `extractor.js`)
The core extraction prompt was designed with these key rules:
1. Extract items EXACTLY as printed. DO NOT do any math.
2. Use the SNc (serial number) column as the sole truth for unique items.
3. Map people to items via the description; use `weight` for uneven splits.
4. Return `null` for payer if no explicit name is given.

This prompt evolved through three real-world iterations based on actual test failures (documented in `AI_Failures.md`).

### Phase 3: Weighted Sharing Schema
The user raised a critical edge case: *"What if someone says 'S ate less of it, M and N evenly shared it and K ate most of the rest'?"*

The solution was to change the `shared_by` schema from an array of strings to an array of `{ name, weight }` objects. The math engine then computes `splitAmount = item.amount * (weight / totalWeight)`, which handles arbitrary proportional splits without requiring the LLM to calculate any numbers.

### Phase 4: SNc Serial Number Rule
After the first live test on a real V&RO Hospitality receipt, the LLM repeatedly extracted the sub-flavor lines of a 10-qty combo item ("Tuesday 1/2 Doz") as separate items with ₹0 amounts. The initial fix attempted to use a "combo splitting" rule, but this was too complex and unreliable.

The user identified the actual solution: **"If the LLM just paid attention to the SNc column which verifies if it's a unique item or not."**  
This became the definitive Rule 2 in the prompt: *"Only rows that have a Serial Number are billable items. Any rows WITHOUT a serial number are continuation lines of the previous item."*

### Phase 5: Edge Case Hardening
After a structured audit of 6 theoretical edge cases (zero-subtotal consumers, compound discounts, rounding cascades, non-numeric quantities, semantic synonyms, ghost payers), further prompt rules were added:
- Qty normalization ("2 pc" → 2)
- Fuzzy match logging in `assumptions_made`
- Ghost payer guard: do not infer payer from "my card" or "birthday boy"
- `item_discount` as a separate schema field to scope item-level discounts
