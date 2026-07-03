# Edge Cases Handled

Part of our Scavenger Architecture involves implementing robust, programmatic guards against anomalous bills or ambiguous user prompts. Here are the edge cases we considered, tested, and mapped to our API response.

### 1. The Printed Total Does Not Reconcile (Math Mismatch)
* **Input**: A receipt where the printed subtotal + tax + service charge - discount does not equal the printed grand total (perhaps due to an unlisted fee).
* **How we handle it**: We calculate `calculatedSubtotal` dynamically by summing up the extracted line items. In `mathEngine.js`, we verify if `calculatedSubtotal == subtotal`. If not, we push a warning to the `flags` array (e.g., *"Extracted line items sum to ₹980 but printed subtotal is ₹1000"*). We do not blindly assume the receipt math is correct.
* **Verified**: Yes, deterministic programmatic checks guarantee this flag triggers.

### 2. Floating-Point Precision & "Lost Cents"
* **Input**: A ₹100 item shared by 3 people (`100 / 3 = 33.333...`).
* **How we handle it**: We maintain decimal precision until the very end, then round each person's total tax, service, and item shares to the nearest rupee. To ensure the final totals sum perfectly to the grand total, we calculate the rounding remainder (`taxDiff`, `serviceDiff`) and assign the "leftover paise" to the Payer (or the first alphabetical person if there is no payer). We document this in the `assumptions` array (e.g., *"Priya absorbs the leftover rounding paise."*).
* **Verified**: Yes.

### 3. Missing Payer in Description
* **Input**: "Aman had the pasta, Priya had the pizza" (no mention of who paid).
* **How we handle it**: We instruct the LLM to output `null` for the `payer` property instead of guessing. Our `mathEngine.js` detects this `null`, outputs an empty `settle_up` array, and pushes a flag: *"No payer identified in description. Settle-up graph will be empty."*
* **Verified**: Yes, caught in code.

### 4. Ambiguous Group Descriptions
* **Input**: "Aman, Priya, and Karan went out. Aman paid. The rest of us shared the pasta."
* **How we handle it**: The Vision LLM prompt explicitly instructs the model: "If the description uses ambiguous language like 'the rest of us', deduce the names from context if possible and note it in assumptions_made." The LLM outputs `["'rest of us' interpreted as Priya, Karan"]` into the `assumptions` array.
* **Verified**: Yes.
