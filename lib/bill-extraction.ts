/**
 * BillGuard - Hierarchical Bill Total Extraction System
 * 
 * This module implements the CRITICAL SYSTEM PROMPT requirements for
 * accurate medical bill analysis and validation.
 * 
 * CORE PRINCIPLE: Always extract the HIGHEST-LEVEL TOTAL (GRAND TOTAL)
 * from the bill, never intermediate subtotals.
 */

// ═══════════════════════════════════════════════════════════════════════════════
// TYPES & INTERFACES
// ═══════════════════════════════════════════════════════════════════════════════

export interface ExtractedTotal {
  label: string
  amount: number
  level: TotalLevel
  confidence: number
  position: number // Line number or position in document
  components?: string[] // What makes up this total (for verification)
}

export type TotalLevel = 
  | 'line_item'      // Individual charge (e.g., "Room: ₱5,000")
  | 'category_subtotal' // Sum of related items (e.g., "Room and Board Subtotal")
  | 'section_total'    // Major section (e.g., "Total Hospital Charges")
  | 'grand_total'      // Final amount (e.g., "GRAND TOTAL", "Amount Due")

export interface TotalHierarchy {
  lineItems: ExtractedTotal[]
  categorySubtotals: ExtractedTotal[]
  sectionTotals: ExtractedTotal[]
  grandTotal: ExtractedTotal | null
  allTotals: ExtractedTotal[]
  
  // Verification data
  verificationStatus: VerificationStatus
  verificationNotes: string[]
}

export type VerificationStatus = 
  | 'verified'      // Grand total confirmed via multiple checks
  | 'likely_correct' // High confidence but couldn't fully verify
  | 'uncertain'     // Multiple possible grand totals found
  | 'failed'        // Could not identify grand total

export interface BillStructure {
  // Section 1: Hospital Charges
  hospitalCharges: {
    items: ExtractedTotal[]
    subtotal: ExtractedTotal | null
  }
  
  // Section 2: Professional Fees
  professionalFees: {
    items: ExtractedTotal[]
    subtotal: ExtractedTotal | null
  }
  
  // Section 3: Other Charges
  otherCharges: {
    items: ExtractedTotal[]
    subtotal: ExtractedTotal | null
  }
  
  // Grand Total (sum of all sections)
  grandTotal: ExtractedTotal | null
  
  // Deductions
  deductions: {
    discounts: ExtractedTotal[]
    payments: ExtractedTotal[]
    hmoCoverage: ExtractedTotal | null
    philhealthCoverage: ExtractedTotal | null
    totalDeductions: number
  }
  
  // Final Balance
  balanceDue: ExtractedTotal | null
}

// ═══════════════════════════════════════════════════════════════════════════════
// GRAND TOTAL KEYWORD PATTERNS (Priority ordered)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Keywords that indicate the FINAL/GRAND TOTAL - highest priority
 * These should ALWAYS be preferred over intermediate subtotals
 */
export const GRAND_TOTAL_KEYWORDS = [
  // Explicit grand total labels (HIGHEST PRIORITY)
  'grand total',
  'grand total:',
  'total amount due',
  'total amount',
  'amount due',
  'amount payable',
  'final total',
  'final amount',
  'total balance',
  'balance due',
  'net amount due',
  'please pay this amount',
  'patient responsibility',
  'due from patient',
  'patient balance',
  'total due',
  'payable amount',
  
  // Filipino/Tagalog variations
  'kabuuang halaga',
  'total na babayaran',
]

/**
 * Keywords that indicate SECTION totals - these are NOT the grand total
 * These should be EXCLUDED when looking for grand total
 */
export const SECTION_TOTAL_KEYWORDS = [
  'total hospital charges',
  'hospital charges total',
  'total professional fees',
  'professional fees total',
  'total ward charges',
  'total room charges',
  'subtotal',
  'sub-total',
  'sub total',
  'charges subtotal',
]

/**
 * Keywords that indicate this is likely an intermediate subtotal, not grand total
 */
export const INTERMEDIATE_TOTAL_INDICATORS = [
  'hospital charges',
  'professional fee',
  'room and board',
  'drugs and medicine',
  'laboratory',
  'misc',
  'supplies',
  'ward',
]

// ═══════════════════════════════════════════════════════════════════════════════
// TOTAL CLASSIFICATION FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Classify a total line based on its label
 */
export function classifyTotal(label: string, amount: number, allTotals: ExtractedTotal[]): TotalLevel {
  const lowerLabel = label.toLowerCase().trim()
  
  // Check for GRAND TOTAL indicators first (highest priority)
  for (const keyword of GRAND_TOTAL_KEYWORDS) {
    if (lowerLabel.includes(keyword)) {
      return 'grand_total'
    }
  }
  
  // Check for section total indicators
  for (const keyword of SECTION_TOTAL_KEYWORDS) {
    if (lowerLabel.includes(keyword)) {
      return 'section_total'
    }
  }
  
  // Check for intermediate total indicators (category subtotals)
  for (const keyword of INTERMEDIATE_TOTAL_INDICATORS) {
    if (lowerLabel.includes(keyword) && lowerLabel.includes('total')) {
      return 'category_subtotal'
    }
  }
  
  // If it just says "total" without qualifiers and is among the largest amounts
  if (lowerLabel === 'total' || lowerLabel === 'total:') {
    // Could be grand total - need to verify by position and amount
    const sortedAmounts = [...allTotals].sort((a, b) => b.amount - a.amount)
    if (sortedAmounts.length > 0 && amount === sortedAmounts[0].amount) {
      return 'grand_total'
    }
    return 'section_total'
  }
  
  // Default to line item
  return 'line_item'
}

/**
 * Score a potential grand total candidate
 * Higher score = more likely to be the actual grand total
 */
export function scoreGrandTotalCandidate(
  total: ExtractedTotal,
  allTotals: ExtractedTotal[],
  sectionTotals: ExtractedTotal[]
): number {
  let score = 0
  const lowerLabel = total.label.toLowerCase()
  
  // Bonus for explicit grand total keywords
  if (GRAND_TOTAL_KEYWORDS.some(k => lowerLabel.includes(k))) {
    score += 100
  }
  
  // Penalty for section-specific keywords
  if (SECTION_TOTAL_KEYWORDS.some(k => lowerLabel.includes(k))) {
    score -= 50
  }
  
  // Bonus for being the largest amount
  const sortedByAmount = [...allTotals].sort((a, b) => b.amount - a.amount)
  if (sortedByAmount[0]?.amount === total.amount) {
    score += 30
  }
  
  // Bonus for appearing last (grand totals typically at the end)
  const sortedByPosition = [...allTotals].sort((a, b) => b.position - a.position)
  if (sortedByPosition[0]?.position === total.position) {
    score += 20
  }
  
  // Bonus if amount equals sum of section totals (within tolerance)
  if (sectionTotals.length >= 2) {
    const sectionSum = sectionTotals.reduce((sum, t) => sum + t.amount, 0)
    const diff = Math.abs(total.amount - sectionSum)
    if (diff < 10) { // Within ₱10
      score += 50
    } else if (diff < 100) {
      score += 25
    }
  }
  
  // Penalty for being too small relative to other totals
  if (sortedByAmount.length > 1 && total.amount < sortedByAmount[0].amount * 0.5) {
    score -= 40
  }
  
  return score
}

/**
 * Select the best grand total from candidates
 */
export function selectBestGrandTotal(
  candidates: ExtractedTotal[],
  allTotals: ExtractedTotal[],
  sectionTotals: ExtractedTotal[]
): ExtractedTotal | null {
  if (candidates.length === 0) return null
  if (candidates.length === 1) return candidates[0]
  
  // Score each candidate
  const scored = candidates.map(c => ({
    total: c,
    score: scoreGrandTotalCandidate(c, allTotals, sectionTotals)
  }))
  
  // Sort by score descending
  scored.sort((a, b) => b.score - a.score)
  
  // Return the highest scored candidate
  return scored[0].total
}

// ═══════════════════════════════════════════════════════════════════════════════
// TOTAL HIERARCHY BUILDER
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Build a hierarchy of totals from extracted bill data
 */
export function buildTotalHierarchy(extractedTotals: ExtractedTotal[]): TotalHierarchy {
  const lineItems: ExtractedTotal[] = []
  const categorySubtotals: ExtractedTotal[] = []
  const sectionTotals: ExtractedTotal[] = []
  const grandTotalCandidates: ExtractedTotal[] = []
  const verificationNotes: string[] = []
  
  // First pass: classify all totals
  for (const total of extractedTotals) {
    const level = classifyTotal(total.label, total.amount, extractedTotals)
    total.level = level
    
    switch (level) {
      case 'line_item':
        lineItems.push(total)
        break
      case 'category_subtotal':
        categorySubtotals.push(total)
        break
      case 'section_total':
        sectionTotals.push(total)
        break
      case 'grand_total':
        grandTotalCandidates.push(total)
        break
    }
  }
  
  // Select best grand total
  let grandTotal = selectBestGrandTotal(grandTotalCandidates, extractedTotals, sectionTotals)
  
  // If no explicit grand total found, check if largest total is the grand total
  if (!grandTotal && extractedTotals.length > 0) {
    const sortedByAmount = [...extractedTotals].sort((a, b) => b.amount - a.amount)
    const largest = sortedByAmount[0]
    
    // Check if largest amount equals sum of section totals
    if (sectionTotals.length >= 2) {
      const sectionSum = sectionTotals.reduce((sum, t) => sum + t.amount, 0)
      if (Math.abs(largest.amount - sectionSum) < 100) {
        grandTotal = { ...largest, level: 'grand_total' }
        verificationNotes.push(
          `Grand total inferred: ₱${largest.amount.toLocaleString()} matches sum of ${sectionTotals.length} section totals`
        )
      }
    }
    
    // If still no grand total, use the largest amount with a warning
    if (!grandTotal) {
      grandTotal = { ...largest, level: 'grand_total', confidence: 60 }
      verificationNotes.push(
        `⚠️ No explicit grand total found. Using largest amount: ₱${largest.amount.toLocaleString()}`
      )
    }
  }
  
  // Determine verification status
  let verificationStatus: VerificationStatus = 'failed'
  
  if (grandTotal) {
    if (grandTotalCandidates.length === 1) {
      verificationStatus = 'verified'
      verificationNotes.push(`✓ Single grand total found: "${grandTotal.label}" = ₱${grandTotal.amount.toLocaleString()}`)
    } else if (grandTotalCandidates.length > 1) {
      verificationStatus = 'uncertain'
      verificationNotes.push(
        `⚠️ Multiple grand total candidates found (${grandTotalCandidates.length}). Selected: "${grandTotal.label}"`
      )
    } else {
      verificationStatus = 'likely_correct'
    }
    
    // Verify against section totals if available
    if (sectionTotals.length >= 2) {
      const sectionSum = sectionTotals.reduce((sum, t) => sum + t.amount, 0)
      const diff = Math.abs(grandTotal.amount - sectionSum)
      
      if (diff < 10) {
        verificationNotes.push(
          `✓ Grand total verified: equals sum of section totals (${sectionTotals.map(t => t.label).join(' + ')})`
        )
        if (verificationStatus !== 'verified') {
          verificationStatus = 'verified'
        }
      } else if (diff > 100) {
        verificationNotes.push(
          `⚠️ Grand total (₱${grandTotal.amount.toLocaleString()}) differs from section sum (₱${sectionSum.toLocaleString()}) by ₱${diff.toLocaleString()}`
        )
      }
    }
  }
  
  return {
    lineItems,
    categorySubtotals,
    sectionTotals,
    grandTotal,
    allTotals: extractedTotals,
    verificationStatus,
    verificationNotes
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// DISCREPANCY CALCULATION
// ═══════════════════════════════════════════════════════════════════════════════

export interface DiscrepancyResult {
  calculatedTotal: number
  billGrandTotal: number
  discrepancy: number
  discrepancyPercent: number
  status: 'no_discrepancy' | 'undercharge' | 'overcharge' | 'unable_to_verify'
  affectedParty: 'none' | 'hospital' | 'patient'
  shouldFlag: boolean
  explanation: string
  verificationChecks: VerificationCheck[]
}

export interface VerificationCheck {
  name: string
  passed: boolean
  details: string
}

/**
 * Calculate discrepancy between calculated total and bill's grand total
 * Following the CRITICAL SYSTEM PROMPT rules
 */
export function calculateDiscrepancy(
  calculatedTotal: number,
  billGrandTotal: number,
  hierarchy: TotalHierarchy
): DiscrepancyResult {
  const checks: VerificationCheck[] = []
  
  // Check 1: Confirm "Bill's Subtotal" = GRAND TOTAL (not intermediate subtotal)
  const grandTotalCheck: VerificationCheck = {
    name: 'Grand Total Verification',
    passed: hierarchy.verificationStatus === 'verified' || hierarchy.verificationStatus === 'likely_correct',
    details: hierarchy.verificationStatus === 'verified' 
      ? `Grand total confirmed: ₱${billGrandTotal.toLocaleString()}`
      : hierarchy.verificationStatus === 'uncertain'
        ? `Multiple grand totals found - using ₱${billGrandTotal.toLocaleString()}`
        : `Could not verify grand total`
  }
  checks.push(grandTotalCheck)
  
  // Check 2: Confirm calculated total includes ALL line items
  const lineItemsCheck: VerificationCheck = {
    name: 'Line Items Completeness',
    passed: calculatedTotal > 0,
    details: calculatedTotal > 0 
      ? `Calculated from ${hierarchy.lineItems.length} line items: ₱${calculatedTotal.toLocaleString()}`
      : 'No line items extracted'
  }
  checks.push(lineItemsCheck)
  
  // Check 3: Calculate discrepancy
  const discrepancy = Math.abs(calculatedTotal - billGrandTotal)
  const discrepancyPercent = billGrandTotal > 0 
    ? (discrepancy / billGrandTotal) * 100 
    : 0
  
  // Check 4: Verify discrepancy is not due to rounding (< ₱1.00)
  const roundingCheck: VerificationCheck = {
    name: 'Rounding Check',
    passed: discrepancy < 1,
    details: discrepancy < 1 
      ? `Difference (₱${discrepancy.toFixed(2)}) is within rounding tolerance`
      : `Difference (₱${discrepancy.toLocaleString()}) exceeds rounding tolerance`
  }
  checks.push(roundingCheck)
  
  // Determine status based on checks
  let status: DiscrepancyResult['status'] = 'no_discrepancy'
  let affectedParty: DiscrepancyResult['affectedParty'] = 'none'
  let shouldFlag = false
  let explanation = ''
  
  // Check if we can verify
  if (!grandTotalCheck.passed) {
    status = 'unable_to_verify'
    explanation = 'Could not verify grand total from bill. Please check the extracted totals manually.'
    shouldFlag = true
  } else if (discrepancy <= 1) {
    // Within rounding tolerance
    status = 'no_discrepancy'
    explanation = 'Bill calculations are correct (within ₱1.00 tolerance).'
    shouldFlag = false
  } else if (calculatedTotal > billGrandTotal) {
    // We calculated MORE than bill shows = Hospital undercharged
    status = 'undercharge'
    affectedParty = 'hospital'
    shouldFlag = true
    explanation = `Line items sum to ₱${calculatedTotal.toLocaleString()} but bill's grand total is only ₱${billGrandTotal.toLocaleString()}. ` +
      `Hospital may have missed charges worth ₱${discrepancy.toLocaleString()} (${discrepancyPercent.toFixed(1)}% of bill).`
  } else {
    // We calculated LESS than bill shows = Patient overcharged
    status = 'overcharge'
    affectedParty = 'patient'
    shouldFlag = true
    explanation = `Line items sum to ₱${calculatedTotal.toLocaleString()} but bill's grand total is ₱${billGrandTotal.toLocaleString()}. ` +
      `Patient may be overcharged by ₱${discrepancy.toLocaleString()} (${discrepancyPercent.toFixed(1)}% of bill).`
  }
  
  // Additional check for large discrepancies (> 20%)
  if (discrepancyPercent > 20 && status !== 'no_discrepancy' && status !== 'unable_to_verify') {
    explanation += `\n\n🚨 CRITICAL: ${discrepancyPercent.toFixed(1)}% discrepancy is unusually large. ` +
      `This may indicate a system extraction error. Please verify totals manually before taking action.`
    
    checks.push({
      name: 'Large Discrepancy Alert',
      passed: false,
      details: `${discrepancyPercent.toFixed(1)}% discrepancy exceeds 20% threshold - manual review recommended`
    })
  }
  
  return {
    calculatedTotal,
    billGrandTotal,
    discrepancy,
    discrepancyPercent,
    status,
    affectedParty,
    shouldFlag,
    explanation,
    verificationChecks: checks
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// LOGGING UTILITIES
// ═══════════════════════════════════════════════════════════════════════════════

export interface ExtractionLog {
  timestamp: string
  phase: string
  action: string
  details: Record<string, unknown>
  success: boolean
}

const logs: ExtractionLog[] = []

export function logExtraction(
  phase: string,
  action: string,
  details: Record<string, unknown>,
  success: boolean = true
): void {
  const log: ExtractionLog = {
    timestamp: new Date().toISOString(),
    phase,
    action,
    details,
    success
  }
  logs.push(log)
  
  // Also console log for debugging
  const prefix = success ? '✓' : '✗'
  console.log(`[BillGuard][${phase}] ${prefix} ${action}`, details)
}

export function getExtractionLogs(): ExtractionLog[] {
  return [...logs]
}

export function clearExtractionLogs(): void {
  logs.length = 0
}

// ═══════════════════════════════════════════════════════════════════════════════
// ENHANCED AI PROMPT FOR GRAND TOTAL EXTRACTION
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Generate the enhanced AI prompt for extracting bill financials
 * This implements the CRITICAL SYSTEM PROMPT requirements
 */
export function generateEnhancedExtractionPrompt(): string {
  return `# Hospital Bill Grand Total Extraction - CRITICAL ACCURACY FOCUS

## YOUR MISSION
Extract the CORRECT GRAND TOTAL from this Philippine hospital bill. Your primary goal is to identify the HIGHEST-LEVEL TOTAL that represents the FULL amount the patient owes.

## CRITICAL RULES - READ CAREFULLY

### Rule 1: ALWAYS Look for GRAND TOTAL First
Medical bills have a hierarchy of totals:
1. LINE ITEMS (individual charges) - DO NOT use these as the total
2. SUBTOTALS (category sums like "Hospital Charges") - DO NOT use these as the total
3. SECTION TOTALS (e.g., "Total Hospital Charges", "Total Professional Fees") - These are INTERMEDIATE
4. **GRAND TOTAL** ← THIS IS WHAT YOU MUST FIND

### Rule 2: Grand Total Keywords (LOOK FOR THESE)
The grand total is typically labeled as:
- "GRAND TOTAL" (most explicit)
- "TOTAL AMOUNT DUE"
- "AMOUNT DUE"
- "AMOUNT PAYABLE"
- "FINAL TOTAL"
- "TOTAL BALANCE"
- "BALANCE DUE"
- "NET AMOUNT DUE"
- "DUE FROM PATIENT"
- "PLEASE PAY THIS AMOUNT"
- "PATIENT RESPONSIBILITY"

### Rule 3: Grand Total Characteristics
The correct grand total should:
✓ Be the LAST major total in the document
✓ Be the SUM of all section totals (Hospital Charges + Professional Fees + Other)
✓ Be the LARGEST prominent amount (before deductions)
✓ Appear AFTER all individual line items and subtotals

### Rule 4: NEVER Use Intermediate Subtotals
DO NOT use these as the grand total:
✗ "Total Hospital Charges" (this is only ONE section)
✗ "Hospital Charges Subtotal"
✗ "Ward Charges Total"
✗ "Room and Board Total"
✗ Any amount that doesn't include Professional Fees (if present)

### Rule 5: Verify Your Selection
Before reporting the grand total:
1. Check if there are Professional Fees listed AFTER your selected total
2. Check if there's a larger "GRAND TOTAL" below your selection
3. Verify the amount makes sense (should be sum of all sections)

## EXTRACTION TASK

Extract ALL totals you find, classifying each as:

\`\`\`json
{
  "allTotals": [
    {
      "label": "exact label from bill",
      "amount": 12345.00,
      "level": "line_item|category_subtotal|section_total|grand_total",
      "position": 1
    }
  ],
  "grandTotal": {
    "label": "GRAND TOTAL",
    "amount": 25044.00,
    "confidence": 95,
    "verification": "equals sum of Hospital Charges (20044) + Professional Fees (5000)"
  },
  "sectionTotals": [
    {"label": "Total Hospital Charges", "amount": 20044.00},
    {"label": "Total Professional Fees", "amount": 5000.00}
  ],
  "calculatedLineItemsTotal": 25044.00,
  "discounts": 0.00,
  "payments": 0.00,
  "hmoCoverage": 0.00,
  "philhealthCoverage": 0.00,
  "balanceDue": 25044.00,
  "lineItemsMatchSubtotal": true,
  "duplicatesDetected": 0,
  "deductionBreakdown": []
}
\`\`\`

## IMPORTANT REMINDERS

🚨 If you see "Hospital Charges: ₱20,044" AND "Professional Fees: ₱5,000" - the GRAND TOTAL is ₱25,044, NOT ₱20,044!

🚨 Always look for the FINAL total at the bottom of the bill

🚨 If unsure between two totals, ALWAYS choose the larger one (unless it's clearly a pre-discount subtotal)

🚨 The "Bill's Subtotal" we need is the GRAND TOTAL - the sum of ALL charges before any deductions

Return ONLY valid JSON, no other text.`
}
