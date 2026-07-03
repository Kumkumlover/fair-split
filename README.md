# Fair Split 🧾

> **AI-powered receipt splitting.** Upload a photo of any restaurant bill, describe who had what in plain English, and get exact per-person shares — down to the last rupee.

**Live Demo →** [fair-split-eight.vercel.app](https://fair-split-eight.vercel.app)

---

## How It Works

Fair Split uses a two-stage pipeline:

```
Receipt Image + Plain English Description
          │
          ▼
  ┌─────────────────────┐
  │  LLM Extraction     │  Gemini 2.5 Flash (Vision)
  │  (Nutlope pattern)  │  Strict JSON Schema — no math allowed
  └────────┬────────────┘
           │ Structured JSON (items, subtotal, tax, payer…)
           ▼
  ┌─────────────────────┐
  │  Math Engine        │  Pure Node.js — deterministic
  │  (AakashSasikumar   │  Proportional allocation + rounding fix
  │   pattern)         │  Debt settlement graph
  └────────┬────────────┘
           │
           ▼
    Final JSON Response
    (per_person, settle_up, flags, assumptions)
```

**The LLM never does arithmetic.** It only extracts facts from the image. All calculations — proportional tax/service allocation, rounding, debt simplification — are handled by a deterministic Node.js math engine, eliminating hallucination risk.

---

## Features

- 📷 **Receipt Vision Extraction** — reads any restaurant receipt photo
- 🧮 **Proportional Tax/Service Allocation** — tax is split by each person's food share, not equally
- ⚖️ **Weighted Splits** — handles "most of", "just a sip", unequal sharing via relative weights
- 🔄 **Rounding Resolution** — leftover paise are assigned to the payer, `matches_bill` is always correct
- 🏷️ **SNc Column Rule** — uses the serial number column to correctly group multi-line combo items
- ⚠️ **Programmatic Edge Case Flags** — missing payer, math mismatches, ghost payer, zero-subtotal consumers
- 💡 **Transparent Assumptions** — every LLM inference is logged (fuzzy matches, ambiguous descriptions)
- 🎨 **Premium Dark UI** — with per-person cards, settle-up arrows, flags panel, and image compression

---

## Tech Stack

| Layer | Technology |
|---|---|
| Backend | Node.js + Express |
| AI / Vision | Google Gemini 2.5 Flash (`@google/genai`) |
| Extraction Pattern | Nutlope/billsplit (strict JSON schema prompting) |
| Math Pattern | AakashSasikumar/splitmybill (proportional allocation) |
| Frontend | Vanilla HTML/CSS/JS |
| Deployment | Vercel (serverless) |

---

## API Contract

### `POST /api/split`

**Request Body**
```json
{
  "receipt_base64": "<base64 encoded image string>",
  "description": "We are 4 people. Aman paid. Priya and I shared the pasta..."
}
```

**Response**
```json
{
  "per_person": [
    {
      "name": "Aman",
      "items": ["Pasta (1/2): ₹160.00", "Fries: ₹120.00"],
      "subtotal": 280,
      "tax_share": 14,
      "service_share": 28,
      "discount_share": 0,
      "total": 322
    }
  ],
  "grand_total": 1250,
  "reconciliation": {
    "sum_of_person_totals": 1250,
    "matches_bill": true
  },
  "paid_by": "Aman",
  "settle_up": [
    { "from": "Priya", "to": "Aman", "amount": 310 }
  ],
  "assumptions": [
    "Leftover rounding deficit of ₹1 absorbed by Aman."
  ],
  "flags": []
}
```

---

## Local Development

### Prerequisites
- Node.js 18+
- A Google Gemini API Key ([get one here](https://aistudio.google.com/app/apikey))

### Setup

```bash
# Clone the repo
git clone https://github.com/<your-username>/fair-split.git
cd fair-split

# Install dependencies
npm install

# Create environment file
echo "GEMINI_API_KEY=your_key_here" > .env

# Start the dev server
node server.js
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

---

## Edge Cases Handled

| Edge Case | How It's Handled |
|---|---|
| Zero-subtotal consumer (fully comped item) | Logs explicit assumption: they owe ₹0 for tax/service |
| Compound discounts (item-level + bill-level) | `item_discount` field scopes item discounts to those consumers only |
| Rounding cascade (8+ people, multi-rupee deficit) | Math engine absorbs exact deficit amount to payer and logs it |
| Non-numeric quantities ("2 pc", "half dozen") | LLM normalizes to integers via schema + prompt rule |
| Semantic synonyms ("Chkn Briyani" ≈ "Chicken Biryani") | LLM flags fuzzy matches in `assumptions` array |
| Ghost payer ("paid by the birthday boy") | LLM returns `null`; `flags` warns the settle-up matrix is unsafe |
| SNc-grouped combo items | Serial Number column used as the sole truth for item boundaries |

---

## Project Structure

```
fair-split/
├── server.js          # Express API server + route handler
├── extractor.js       # Gemini Vision LLM extraction layer
├── mathEngine.js      # Deterministic split calculator
├── public/
│   └── index.html     # Frontend UI
├── vercel.json        # Vercel deployment config
├── Prompt_Log.md      # Prompt iteration history & design decisions
├── Edge_Cases.md      # Edge case documentation
└── AI_Failures.md     # Where the LLM was wrong & how we fixed it
```

---

## Deployment

This project is pre-configured for [Vercel](https://vercel.com).

```bash
npx vercel --prod
```

Set the `GEMINI_API_KEY` environment variable in your Vercel project dashboard under **Settings → Environment Variables**.

> ⚠️ **Note**: Vercel Hobby plan enforces a 10-second serverless timeout. Complex receipts may require upgrading to Vercel Pro for the 60-second limit.

---

## Scavenger Architecture Credit

This project was built using the **"Scavenger Methodology"** — extracting and adapting proven patterns from existing open-source solutions rather than building from scratch:

- **[Nutlope/billsplit](https://github.com/Nutlope/billsplit)** — Strict JSON schema prompting for Vision LLMs
- **[AakashSasikumar/splitmybill](https://github.com/AakashSasikumar/splitmybill)** — Proportional math engine and debt graph

---

## License

MIT
