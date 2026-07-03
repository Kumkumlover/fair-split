function calculateFairSplit(extractedData) {
    const { items, subtotal, tax, service_charge, discount, printed_grand_total, payer, assumptions_made } = extractedData;

    const people = {};
    const flags = [];
    const assumptions = [...assumptions_made];

    // 1. Calculate base subtotal for each person based on items
    let calculatedSubtotal = 0;
    
    for (const item of items) {
        if (item.amount === 0) continue; // Ignore 0-price modifiers if LLM missed the instruction
        calculatedSubtotal += item.amount;
        if (!item.shared_by || item.shared_by.length === 0) continue;
        
        // Calculate total weight of this item
        const totalWeight = item.shared_by.reduce((sum, sharer) => sum + (sharer.weight || 1), 0);
        if (totalWeight === 0) continue; // Safety check
        
        for (const sharer of item.shared_by) {
            const person = sharer.name;
            const weight = sharer.weight || 1;
            
            if (!people[person]) {
                people[person] = {
                    name: person,
                    items: [],
                    subtotal: 0,
                    tax_share: 0,
                    service_share: 0,
                    discount_share: 0,
                    total: 0
                };
            }
            
            // Calculate exact split for this person based on their weight
            const splitAmount = item.amount * (weight / totalWeight);
            
            // Format item string: e.g., "GINGER ALE (2/5): ₹156.00"
            const fractionStr = (weight === totalWeight) ? '' : ` (${weight}/${totalWeight})`;
            people[person].items.push(`${item.name}${fractionStr}: ₹${splitAmount.toFixed(2)}`);
            people[person].subtotal += splitAmount;
        }
    }

    // Math validation flag
    if (Math.abs(calculatedSubtotal - subtotal) > 0.01) {
        flags.push(`Extracted line items sum to ₹${calculatedSubtotal.toFixed(2)} but printed subtotal is ₹${subtotal.toFixed(2)}`);
    }

    // 2. Proportional Allocation
    // M = Total to allocate / Subtotal
    let totalTaxShare = 0;
    let totalServiceShare = 0;
    let totalDiscountShare = 0;
    let sumOfPersonTotals = 0;

    const personKeys = Object.keys(people);
    
    for (const person of personKeys) {
        const p = people[person];
        
        // Multipliers
        const proportion = subtotal > 0 ? (p.subtotal / subtotal) : 0;
        
        // Edge Case 1: Zero-subtotal consumer (fully comped item)
        if (p.subtotal === 0 || proportion === 0) {
            assumptions.push(`${person} has a zero base subtotal (possibly a fully comped/discounted item). They owe ₹0 for tax and service charges.`);
        }
        
        // Exact shares
        p.tax_share = proportion * tax;
        p.service_share = proportion * service_charge;
        p.discount_share = proportion * discount;
        
        // Round to nearest integer (rupee)
        p.tax_share = Math.round(p.tax_share);
        p.service_share = Math.round(p.service_share);
        p.discount_share = Math.round(p.discount_share);
        
        // Final Total per person
        p.total = Math.round(p.subtotal) + p.tax_share + p.service_share - p.discount_share;
        
        totalTaxShare += p.tax_share;
        totalServiceShare += p.service_share;
        totalDiscountShare += p.discount_share;
        sumOfPersonTotals += p.total;
    }

    // Rounding Resolution (absorbing leftover paise)
    // The sum of rounded taxes/services/subtotals might be off by a few rupees compared to the total printed tax.
    const sumOfRoundedSubtotals = personKeys.reduce((sum, p) => sum + Math.round(people[p].subtotal), 0);
    const subtotalDiff = Math.round(subtotal) - sumOfRoundedSubtotals;
    const taxDiff = Math.round(tax) - totalTaxShare;
    const serviceDiff = Math.round(service_charge) - totalServiceShare;
    const discountDiff = Math.round(discount) - totalDiscountShare;
    
    // We assign leftover to the payer, or the first person if payer not found
    let absorber = payer;
    if (!absorber || !people[absorber]) {
        absorber = personKeys[0];
    }

    if (absorber && people[absorber]) {
        let totalAbsorbed = 0;
        if (subtotalDiff !== 0) { people[absorber].subtotal += subtotalDiff; people[absorber].total += subtotalDiff; totalAbsorbed += subtotalDiff; }
        if (taxDiff !== 0) { people[absorber].tax_share += taxDiff; people[absorber].total += taxDiff; totalAbsorbed += taxDiff; }
        if (serviceDiff !== 0) { people[absorber].service_share += serviceDiff; people[absorber].total += serviceDiff; totalAbsorbed += serviceDiff; }
        if (discountDiff !== 0) { people[absorber].discount_share += discountDiff; people[absorber].total -= discountDiff; totalAbsorbed -= discountDiff; }
        
        if (totalAbsorbed !== 0) {
            assumptions.push(`Leftover rounding ${totalAbsorbed > 0 ? 'deficit' : 'surplus'} of ₹${Math.abs(totalAbsorbed)} absorbed by ${absorber}.`);
            sumOfPersonTotals = sumOfPersonTotals + subtotalDiff + taxDiff + serviceDiff - discountDiff;
        }
    }

    // 3. Reconciliation & Flags
    let calculatedGrandTotal = Math.round(subtotal) + Math.round(tax) + Math.round(service_charge) - Math.round(discount);
    let matches_bill = sumOfPersonTotals === printed_grand_total;

    if (!matches_bill) {
        flags.push(`Calculated grand total (₹${sumOfPersonTotals}) does not match printed grand total (₹${printed_grand_total}).`);
    }

    if (!payer) {
        flags.push(`Payer identity is ambiguous or not stated. Settle-up matrix cannot be generated safely.`);
    }

    // Format per_person output
    const per_person = personKeys.map(k => {
        const p = people[k];
        return {
            name: p.name,
            items: p.items,
            subtotal: Math.round(p.subtotal),
            tax_share: p.tax_share,
            service_share: p.service_share,
            discount_share: -p.discount_share, // output requires negative for discounts
            total: p.total
        };
    });

    // 4. Settle Up (Graph)
    const settle_up = [];
    if (payer) {
        for (const person of personKeys) {
            if (person !== payer) {
                if (people[person].total > 0) {
                    settle_up.push({
                        from: person,
                        to: payer,
                        amount: people[person].total
                    });
                }
            }
        }
    }

    return {
        per_person,
        grand_total: printed_grand_total,
        reconciliation: {
            sum_of_person_totals: sumOfPersonTotals,
            matches_bill
        },
        paid_by: payer || "Unknown",
        settle_up,
        assumptions,
        flags
    };
}

module.exports = { calculateFairSplit };
