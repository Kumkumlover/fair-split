# AI Failures — Where the Model Got It Wrong

These are the real failures we encountered during development when testing on an actual restaurant receipt (V&RO Hospitality Pvt Ltd, Plan B, Bengaluru). No hypothetical scenarios — these are exact issues observed from the actual API output.

---

## Failure 1: LLM Split the Ginger Ale Evenly Despite "Most Of"

**Receipt**: SN 1 — Ginger Ale, Qty 3, Rate ₹130, Amount ₹390.  
**Description prompt**: *"I Shikhar had most of the ginger ale, but shared some with Anushka."*

**What the model did (first iteration)**:
```json
"shared_by": [
  { "name": "Shikhar", "weight": 1 },
  { "name": "Anushka", "weight": 1 }
]
```
It split the ₹390 evenly — ₹195 each — completely ignoring the word "most".

**How we caught it**: Visual inspection of the first live test output. Shikhar's Ginger Ale showed `(1/2): ₹195.00` which was clearly wrong given the description.

**How we fixed it**: Changed the `shared_by` schema from an array of strings to an array of `{ name, weight }` objects and updated the prompt: *"Use the weight property for uneven splits (e.g., 'most' = weight 3, 'less' = weight 1)."* The model then correctly returned `Shikhar weight 3, Anushka weight 1`, splitting it as ₹292.50 / ₹97.50.

**Key takeaway**: Vague natural language quantifiers ("most", "a bit", "the rest") are semantically meaningful but the model needs an explicit schema field to express them numerically. Without `weight`, the model had no output slot to encode the inequality and defaulted to an even split.

---

## Failure 2: 0-Price Sub-Items Treated as Separate Line Items

**Receipt**: SN 5 — "Tuesday 1/2 Doz", Qty 10, Rate ₹225, Amount ₹2250. Followed by 9 rows with no serial number (NAKED PERI PERI, SPICY GARLIC, FIRE CRACKER, ABS, FLAMING JALAPENO, FIRE CRACKER, CREAMY BUFFALO, HONEY CHILLI, ABS) all with ₹0.00.

**What the model did (first iteration)**:
The model extracted each ₹0 flavor row as a separate item. The output contained 14 line items per person instead of 5, all with `:  ₹0.00` costs, cluttering the breakdown and making the per-person item list completely unreadable.

**What the model did (second iteration — after "ignore 0-price items" rule)**:
The model ignored ALL ₹0 rows, including the Fire Cracker flavor which the user mentioned in the description. The Fire Cracker attribution was completely lost.

**How we caught it**: The user observed the output and noted: *"If you look at the actual bill, Tuesday 1/2 Doz naked peri peri spicy garlic creamy buffalo honey chilli abs is just one item which had 10 qty."*

**How we fixed it**: The user identified the root insight — **the SNc (serial number) column is the definitive boundary between unique items**. Any row without a serial number is a continuation of the previous item, not a new one. The prompt was updated with the SNc Rule: *"Only rows that have a Serial Number are billable items. Any rows WITHOUT a serial number are continuation lines of the previous item."* This correctly merged all flavor names into the single SN 5 entry.

**Key takeaway**: Asking the model to "ignore 0-price items" was too broad and broke attribution. The correct fix was to teach the model the structural meaning of the receipt's formatting columns, not just filter by price.

---

## Failure 3: Grand Total Mismatch Due to Fractional Rounding

**Receipt**: Printed grand total ₹5226.

**What happened**: After introducing the `weight`-based split for Ginger Ale, Shikhar's share became ₹292.50. The math engine rounded this to ₹293. This created an extra 50 paise "out of thin air". The sum of all person totals came out as ₹5227 or ₹5228, with `matches_bill: false` in the reconciliation.

**How we caught it**: The API response showed `"sum_of_person_totals": 5228` vs `"grand_total": 5226` with a flag.

**How we fixed it**: The rounding absorber in `mathEngine.js` was already handling `taxDiff` and `serviceDiff`, but not `subtotalDiff`. We added:
```js
const sumOfRoundedSubtotals = personKeys.reduce((sum, p) => sum + Math.round(people[p].subtotal), 0);
const subtotalDiff = Math.round(subtotal) - sumOfRoundedSubtotals;
```
The drift is then assigned to the payer (or first person) and explicitly logged: *"Leftover rounding deficit of ₹2 absorbed by Shikhar."* This ensures `matches_bill` is always `true` when the extraction itself is correct.

**Key takeaway**: Floating-point rounding is a cascade problem. Rounding each person independently creates a systematic drift proportional to the number of people. The fix must absorb the total drift at the bill level, not just at the tax level.
