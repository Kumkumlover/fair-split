# Prompt Log & Iteration History

### Question: Did you let the model do the arithmetic, or extract structured data and compute the totals in code? Why?
**Answer**: I explicitly forced the model to *only* extract structured data and computed all totals, splits, and taxes via code in `mathEngine.js`. 
**Why?**: LLMs (even Vision ones) are autoregressive language models, meaning they are inherently unreliable at floating-point arithmetic and complex rule-based state tracking across many line items. If we ask the LLM to do math, it is prone to hallucinate fractional splits or forget to carry remainders, leading to silent failures where debts don't add up. By restricting the LLM to just reading the receipt (via strict JSON Schema) and writing a deterministic algorithm to distribute taxes proportionally, we guarantee absolute mathematical fairness and accuracy.

---

## Iteration 1: Unstructured Extraction
* **Prompt used**: "Extract the items from this bill and tell me who owes what based on this description..."
* **Result**: The model hallucinated the tax split and output conversational text instead of JSON.
* **Why it changed**: We needed a deterministic output shape to feed into our math engine.

## Iteration 2: Structured Outputs (Nutlope Pattern)
* **Prompt used**: "Extract the structured data according to the schema. Do not do any math. Identify subtotal, tax, service charge, and line items."
* **Result**: The model returned valid JSON, but sometimes forgot to map the "description" to the individual line items if a name wasn't explicitly mentioned.
* **Why it changed**: We needed to handle implicit sharing (e.g., "the rest of us shared the pizza").

## Iteration 3: Final Scavenger Prompt
* **Prompt used**: "CRITICAL INSTRUCTIONS: 1. Extract line items EXACTLY as they appear with their price. DO NOT do any math. 2. For each item, determine who shared it... If the description uses ambiguous language like 'the rest of us', deduce the names from context if possible and note it in assumptions_made."
* **Result**: Flawless extraction of raw facts into `extractor.js`, completely offloading the cognitive load of calculations to the Node.js math engine.
