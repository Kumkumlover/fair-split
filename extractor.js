const { GoogleGenAI, Type } = require('@google/genai');
const dotenv = require('dotenv');
dotenv.config();

const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
    console.error("GEMINI_API_KEY is not set in the environment.");
}

const ai = new GoogleGenAI({ apiKey: apiKey });

const extractionSchema = {
    type: Type.OBJECT,
    properties: {
        items: {
            type: Type.ARRAY,
            description: "List of items ordered from the receipt.",
            items: {
                type: Type.OBJECT,
                properties: {
                    name: { type: Type.STRING, description: "Name of the item on the receipt." },
                    qty: { type: Type.INTEGER, description: "Quantity ordered. Normalize strings like '2 pc', 'half', 'dozen' to their integer equivalent." },
                    amount: { type: Type.NUMBER, description: "Total amount for this item as printed AFTER any item-level discount." },
                    item_discount: { type: Type.NUMBER, description: "Item-level discount applied to this specific item (e.g. BOGO, coupon). Positive number. 0 if none." },
                    shared_by: {
                        type: Type.ARRAY,
                        description: "List of people who shared this item. If shared evenly, give everyone weight 1. If unevenly (e.g. 'most of'), assign relative weights (e.g. 2 and 1).",
                        items: {
                            type: Type.OBJECT,
                            properties: {
                                name: { type: Type.STRING },
                                weight: { type: Type.NUMBER, description: "Relative portion of the item consumed." }
                            },
                            required: ["name", "weight"]
                        }
                    }
                },
                required: ["name", "qty", "amount", "item_discount", "shared_by"]
            }
        },
        subtotal: { type: Type.NUMBER, description: "The subtotal amount before tax/service charge." },
        tax: { type: Type.NUMBER, description: "Total tax amount (e.g., GST)." },
        service_charge: { type: Type.NUMBER, description: "Service charge amount. 0 if not present." },
        discount: { type: Type.NUMBER, description: "Any discount applied. Positive number. 0 if not present." },
        printed_grand_total: { type: Type.NUMBER, description: "The final grand total printed on the receipt." },
        payer: { type: Type.STRING, nullable: true, description: "The person who paid the bill. Null if not specified." },
        assumptions_made: {
            type: Type.ARRAY,
            description: "Any assumptions made during extraction (e.g., mapping 'the rest of us' to specific names based on context).",
            items: { type: Type.STRING }
        }
    },
    required: ["items", "subtotal", "tax", "service_charge", "discount", "printed_grand_total", "assumptions_made"]
};

async function extractReceiptData(base64Image, description) {
    const prompt = `
You are an expert data extractor for restaurant receipts.
Extract the structured data from the provided receipt image according to the schema.
Also read the following description to determine who shared which items, and who paid the bill.

Description: "${description}"

CRITICAL INSTRUCTIONS:
1. Extract line items EXACTLY as they appear with their price. DO NOT do any math.
2. SERIAL NUMBER RULE (most important): The 'SNc' or 'S.No' column is the SOLE source of truth for identifying unique items. Only rows that have a Serial Number (e.g., 1, 2, 3...) are billable items. Any rows WITHOUT a serial number are continuation lines of the previous item — they are either long item name wraps, flavor names, or modifiers. They must be MERGED into the parent item's name and are NOT separate items. Do NOT extract them separately. Use the parent item's Qty and Amount.
3. For each item, determine who shared it. Use the 'weight' property for uneven splits (e.g., 'most' = weight 3, 'less' = weight 1). If shared equally, weight is 1. If an item is not mentioned in the description, assume it was shared by everyone mentioned in the description with weight 1. If a specific sub-flavor is mentioned (e.g., "Fire Cracker"), you may split that parent item proportionally: assign the mentioned flavors' qty-worth to the right people and the remainder to everyone else.
4. ITEM-LEVEL DISCOUNTS: If a specific item has a discount applied to it (e.g. 'BOGO', 'Coupon -₹50'), extract the discounted amount in 'item_discount' for that item only. The 'amount' field must reflect the final net price printed. Bill-level discounts (applied at the bottom of the receipt) go into the top-level 'discount' field.
5. QTY NORMALIZATION: Normalize non-integer quantities to integers (e.g., '2 pc' → 2, 'half' → 1, 'dozen' → 12).
6. FUZZY MATCHING: If you map a description item to a receipt item via abbreviation or typo matching (e.g., 'Chicken Biryani' → 'Chkn Briyani'), you MUST add an entry to assumptions_made: "Description mentions '[description term]' but bill contains '[receipt term]'. Assumed matching."
7. GHOST PAYER: Do NOT guess the payer from indirect references like 'my card', 'the birthday boy', 'I paid', or 'we put it on X'. Only extract the payer if an explicit name is stated. Otherwise return null for payer.
8. Identify the subtotal, tax, service charge, discount, and grand total EXACTLY as printed.
9. If a value is missing, use 0 (e.g., no discount).
10. If the description uses ambiguous language like "the rest of us", deduce the names from context if possible and note it in assumptions_made.
11. Return raw JSON that satisfies the schema.
`;

    // Try to guess mime type from base64 string signature, default to image/jpeg
    let mimeType = 'image/jpeg';
    if (base64Image.startsWith('iVBORw0KGgo')) mimeType = 'image/png';
    
    const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: [
            prompt,
            {
                inlineData: {
                    data: base64Image,
                    mimeType: mimeType
                }
            }
        ],
        config: {
            responseMimeType: "application/json",
            responseSchema: extractionSchema,
            temperature: 0.1,
        }
    });

    try {
        const textResponse = response.text;
        const parsed = JSON.parse(textResponse);
        return parsed;
    } catch (e) {
        throw new Error("Failed to parse LLM output: " + e.message);
    }
}

module.exports = { extractReceiptData };
