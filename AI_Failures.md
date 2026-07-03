# Where the AI Was Wrong

During development and testing of the LLM Extraction Layer (`extractor.js`), we encountered three explicit instances where the model's first answer was wrong. Here is how we caught and fixed them:

### 1. Hallucinating Fractional Prices (Botched Total)
* **What went wrong**: When parsing "Priya and I shared the pasta (₹320)", the LLM tried to do the math and extracted the item price as `160`.
* **How we caught it**: The math engine's reconciliation check failed because the sum of the line items no longer matched the printed subtotal on the receipt.
* **How we fixed it**: We added `CRITICAL INSTRUCTIONS: Extract line items EXACTLY as they appear with their price. DO NOT do any math.` to the system prompt. We offloaded the fractional split (`amount / shared_by.length`) entirely to `mathEngine.js`.

### 2. Misreading Service Charge as Tax
* **What went wrong**: On a receipt with "SGST", "CGST", and "S.C." (Service Charge), the LLM lumped all three into the `tax` field and output `0` for `service_charge`.
* **How we caught it**: Manual inspection of the JSON output against Sample Receipt R1.
* **How we fixed it**: We updated the Zod schema descriptions to be highly specific: `tax: "Total tax amount (e.g., GST)"` and `service_charge: "Service charge amount. 0 if not present."`. 

### 3. Missing the Payer
* **What went wrong**: The text said "I paid the bill." Since the LLM didn't know who "I" was, it guessed "Aman" because Aman was the first name mentioned.
* **How we caught it**: The `settle_up` directed graph generated edges that incorrectly charged Aman.
* **How we fixed it**: We explicitly told the LLM: `Identify the payer. If not explicitly stated, return null for payer.` We then let the code generate a flag (`flags.push("No payer identified")`) instead of allowing a silent hallucination.
