# Edge Cases — Fair Split

This document covers all edge cases addressed during development. It is divided into two sections:

1. **Real Edge Cases** — problems actually encountered during live testing on a real restaurant receipt (V&RO Hospitality Pvt Ltd, Bengaluru).
2. **Trained Edge Cases** — theoretical scenarios introduced by the developer to stress-test and harden the system before company review.

---

## Part 1: Real Edge Cases (Encountered During Testing)

### EC-R1: 0-Price Sub-Items Extracted as Separate Line Items

**Receipt context**: SN 5 — "Tuesday 1/2 Doz", Qty 10, ₹2250. Followed by 9 continuation rows (NAKED PERI PERI, SPICY GARLIC, FIRE CRACKER, ABS, etc.) with no serial number and ₹0.00.

**Problem**: The LLM extracted each ₹0 flavor row as a distinct item, resulting in 14 line items per person instead of 5. The per-person breakdown was completely unreadable.

**First attempted fix (failed)**: Instructed LLM to "ignore all 0-price items". This caused the Fire Cracker attribution to be lost entirely because Fire Cracker was one of the ₹0 sub-items mentioned in the description.

**Final fix**: The user identified the root cause — use the **SNc (serial number) column** as the definitive item boundary. Prompt Rule 2 now states: *"Only rows with a Serial Number are billable items. Any rows WITHOUT a serial number are continuation lines of the previous item."* This correctly groups all flavor names under SN 5.

**How it's handled now**: The LLM merges all continuation rows into the parent item's name and uses only the parent's Qty and Amount. Zero-price orphan rows never appear in the output.

---

### EC-R2: Uneven Split Defaulted to Equal Split ("Most Of")

**Description prompt**: *"I Shikhar had most of the ginger ale, but shared some with Anushka."*

**Problem**: Despite the word "most", the LLM split the ₹390 Ginger Ale 50/50 (₹195 each) because the original `shared_by` schema was an array of strings with no way to express proportions.

**Fix**: Changed `shared_by` to an array of `{ name, weight }` objects. The prompt instructs: *"'most' = weight 3, 'less' or 'some' = weight 1."* The math engine splits using `amount × (weight / totalWeight)`.

**How it's handled now**: Ginger Ale (Qty 3, ₹390) → Shikhar weight 3 = ₹292.50, Anushka weight 1 = ₹97.50.

---

### EC-R3: Grand Total Rounding Mismatch

**Problem**: After the weighted Ginger Ale split, Shikhar's fractional subtotal was ₹292.50. The math engine rounded this to ₹293, creating an extra 50 paise. Across 5 people, the sum of rounded totals came out as ₹5228 against the printed ₹5226 (`matches_bill: false`).

**Root cause**: The rounding absorber was only catching `taxDiff` and `serviceDiff`, not `subtotalDiff` — the drift introduced by rounding each person's food share independently.

**Fix**: Added `subtotalDiff = Math.round(subtotal) - sumOfRoundedSubtotals` to the absorber logic. All rounding drift (subtotal + tax + service) is now assigned to the payer (or first person alphabetically) with an explicit assumption logged: *"Leftover rounding deficit of ₹2 absorbed by Shikhar."*

**How it's handled now**: `matches_bill` is always `true` when extraction is correct. The deficit is never silently swallowed.

---

### EC-R4: Fire Cracker Attribution Lost After Prompt Fix

**Problem**: After fixing EC-R1 with the "ignore 0-price items" rule, the Fire Cracker flavor — which the user mentioned in the description ("Except Anushka, we all shared Fire Cracker equally") — was silently dropped from the output. The constraint was too broad.

**Fix**: The SNc-based rule replaced the 0-price filter. By treating the entire SN 5 block as one item, the LLM can still be instructed (in Rule 3) that if a specific sub-flavor is mentioned in the description, it may split the parent item proportionally by qty-worth and assign the flavors to the correct people.

---

### EC-R5: Gemini API 503 High-Demand Errors

**Problem**: During testing, the live API returned `503: This model is currently experiencing high demand`. This was a transient upstream error from Google's model servers, not a bug in the application.

**How it's handled now**: The frontend shows a specific, user-friendly message: *"The AI model is under high demand right now. Please wait 30 seconds and try again."* (differentiated from other 5xx errors). A 55-second client-side timeout with a clear message is also in place.

---

## Part 2: Trained Edge Cases (Developer-Introduced Stress Tests)

These were introduced by the developer after the first successful test to audit the system's robustness before company review.

---

### EC-T1: Zero-Subtotal Consumer (The "Just a Sip" Dilemma)

**Scenario**: A participant is mentioned in the description but only consumed an item that was 100% discounted (BOGO, fully comped coupon). Their individual pre-tax subtotal evaluates to exactly ₹0.

**Mathematical trap**: The proportional tax formula `Tax_Share = Individual_Subtotal × (Tax / Subtotal)` produces ₹0 for this person. Without explicit logging, this is a silent outcome with no transparency.

**How it's handled**: After the proportional loop, `mathEngine.js` checks `if (p.subtotal === 0 || proportion === 0)` and pushes an explicit assumption: *"[Person] has a zero base subtotal (possibly a fully comped/discounted item). They owe ₹0 for tax and service charges."* Their total correctly stays ₹0.

---

### EC-T2: Compound Multi-Layer Discounts

**Scenario**: The receipt has both an item-level discount (e.g., "Paneer Butter Masala — ₹50 off") AND a bill-level promotional code (e.g., "WELCOME15" -15%) at the bottom. The description says "Aman and Priya shared the Paneer."

**Trap**: If both discounts are merged into the single `discount` field, the item-level discount is spread across all consumers proportionally instead of being scoped only to Aman and Priya.

**How it's handled**: A dedicated `item_discount` field was added to the item schema. The LLM maps item-level discounts to that field for that specific item only. The `amount` field reflects the post-item-discount net price. The top-level `discount` field is reserved exclusively for bill-level discounts, which are then applied proportionally across everyone by the math engine.

---

### EC-T3: Negative Rounding Cascade (Large Groups)

**Scenario**: 8 people splitting a small bill where every person's total rounds down by ~0.49 paise, creating a multi-rupee deficit against the printed grand total.

**Trap**: If 8 people all round down by ₹0.49, the sum is ₹3.92 short of the actual total — `matches_bill` fails.

**How it's handled**: The absorber in `mathEngine.js` computes the total drift across subtotal, tax, and service charge diffs and assigns the exact deficit to the payer. The assumption log explicitly states the amount: *"Leftover rounding deficit of ₹4 absorbed by Priya."* `matches_bill` is then forced correct.

---

### EC-T4: Non-Numeric / Itemized Quantities ("2 pc")

**Scenario**: The receipt prints a quantity as "2 pc" or "half dozen" rather than a plain integer. The description says "Karan had one gulab jamun and Sara had the other."

**Trap**: The `qty` field in the schema is typed `INTEGER`. If the LLM outputs `"2 pc"` as a string, schema validation fails and the entire request errors out with no helpful feedback.

**How it's handled**: The `qty` schema description now explicitly instructs: *"Normalize strings like '2 pc', 'half', 'dozen' to their integer equivalent (e.g., 2, 1, 12)."* Gemini's strict schema mode enforces the INTEGER type, so the LLM must normalize before outputting.

---

### EC-T5: Semantic Synonyms & Abbreviations ("Chkn Briyani" vs "Chicken Biryani")

**Scenario**: The receipt prints an abbreviated item name like "Chkn Briyani" but the user types "Chicken Biryani" in the description.

**Trap**: A strict string-match approach fails entirely. If the LLM silently fuzzy-matches without disclosure, the user has no visibility into whether the mapping was correct.

**How it's handled**: Prompt Rule 6 instructs: *"If you map a description item to a receipt item via abbreviation or typo matching, you MUST add an entry to assumptions_made: 'Description mentions [X] but bill contains [Y]. Assumed matching.'"* This creates an auditable trail for every fuzzy match in the `assumptions` array of the API response.

---

### EC-T6: Ghost Payer (Ambiguous Context)

**Scenario**: The description says *"We put it on my card"* or *"Paid by the birthday boy"* — referring to the payer indirectly without stating their name.

**Trap**: The LLM may hallucinate a name based on context (e.g., guessing the first person mentioned) and silently generate an incorrect settle-up graph.

**How it's handled**: Prompt Rule 7 explicitly prohibits inference from indirect references: *"Do NOT guess the payer from indirect references like 'my card', 'birthday boy', 'I paid', or 'we put it on X'. Only extract the payer if an explicit name is stated. Otherwise return null."* The math engine then flags: *"Payer identity is ambiguous or not stated. Settle-up matrix cannot be generated safely."* and returns an empty `settle_up` array.
