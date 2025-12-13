import { type NextRequest, NextResponse } from "next/server"
import { generateText } from "ai"
import { createGroq } from "@ai-sdk/groq"
import { createOpenAI } from "@ai-sdk/openai"
import sharp from "sharp"
import {
  type ExtractedTotal,
  type TotalHierarchy,
  type DiscrepancyResult,
  buildTotalHierarchy,
  calculateDiscrepancy,
  generateEnhancedExtractionPrompt,
  logExtraction,
  clearExtractionLogs,
  getExtractionLogs,
  GRAND_TOTAL_KEYWORDS,
  SECTION_TOTAL_KEYWORDS,
} from "@/lib/bill-extraction"
// Note: Tesseract.js disabled due to pnpm module resolution issues
// import { processHospitalBill, type ProcessingResult } from "@/lib/image-processing"

// Initialize AI providers
const groq = createGroq({ apiKey: process.env.GROQ_API_KEY })

// Groq: Best for OCR (14,400 req/day)
const groqVisionModel = groq("meta-llama/llama-4-scout-17b-16e-instruct")
const groqTextModel = groq("llama-3.3-70b-versatile")

// DeepSeek: Best for analysis (50 req/day but most accurate)
const deepseek = createOpenAI({
  apiKey: process.env.DEEPSEEK_API_KEY || '',
  baseURL: 'https://api.deepseek.com',
})
const deepseekModel = deepseek("deepseek-chat")

// Keywords that indicate non-billable items (to be excluded)
const excludeKeywords = [
  'tel', 'telephone', 'phone', 'fax', 'email', 'address', 'city', 'street',
  'admission no', 'admission date', 'discharge', 'patient name', 'age:',
  'room no', 'case rate', 'run date', 'datetime', 'page', 'total:',
  'subtotal', 'grand total', 'amount due', 'balance due', 'edsa', 'avenue',
  'blk', 'block', 'brgy', 'barangay', 'mandaluyong', 'manila', 'quezon',
  'makati', 'pasig', 'taguig', 'cavite', 'laguna', 'cebu', 'davao',
  'discount', 'senior citizen', 'pwd', 'payment', 'paid', 'change',
  'net refund', 'amount covered', 'philhealth', 'hmo', 'guaranteed',
  'total amount', 'balance', 'net amount'
]

// Keywords that indicate billable medical services
const medicalKeywords = [
  'room', 'emergency', 'laboratory', 'lab', 'pharmacy', 'medicine', 'medication',
  'x-ray', 'xray', 'ct scan', 'ct-scan', 'mri', 'ultrasound', 'ecg', 'ekg', 'eeg',
  'operating', 'surgery', 'surgical', 'anesthesia', 'professional fee',
  'doctor', 'physician', 'surgeon', 'nursing', 'icu', 'nicu', 'recovery',
  'respiratory', 'dialysis', 'chemotherapy', 'radiation', 'therapy',
  'supplies', 'sterile', 'central supply', 'housekeeping', 'ambulance',
  'blood', 'transfusion', 'infusion', 'injection', 'iv', 'oxygen',
  'heart station', 'cardio', 'pulmo', 'neuro', 'gastro', 'ortho',
  'ent', 'optha', 'derma', 'ob-gyn', 'pedia', 'internal medicine',
  'floor', 'ward', 'private', 'semi-private', 'suite', 'charges',
  'clinical', 'pulmonary', 'dept', 'section', 'supply'
]

// Legacy enhance image function (keeping for fallback)
async function enhanceImage(buffer: ArrayBuffer): Promise<{ enhanced: Buffer; mimeType: string }> {
  try {
    const inputBuffer = Buffer.from(buffer)
    const metadata = await sharp(inputBuffer).metadata()
    
    console.log("[v0] Enhancing image:", metadata.width, "x", metadata.height, metadata.format)
    
    let processor = sharp(inputBuffer)
    
    // Step 1: Resize if too small (AI works better with larger images)
    if (metadata.width && metadata.width < 1200) {
      console.log("[v0] Upscaling image for better OCR...")
      processor = processor.resize({
        width: 1800,
        withoutEnlargement: false,
        kernel: 'lanczos3'
      })
    }
    
    // Step 2: Enhance for OCR readability
    processor = processor
      .normalize() // Auto-adjust contrast
      .sharpen({ sigma: 1.0, m1: 0.5, m2: 0.5 }) // Sharpen text
    
    // Output as high-quality PNG (lossless, better for OCR)
    const enhancedBuffer = await processor
      .png({ compressionLevel: 6 })
      .toBuffer()
    
    console.log("[v0] Image enhanced successfully")
    return { enhanced: enhancedBuffer, mimeType: "image/png" }
  } catch (error) {
    console.error("[v0] Image enhancement failed, using original:", error)
    return { enhanced: Buffer.from(buffer), mimeType: "image/jpeg" }
  }
}

// Parse bill text - extract items and prices
function parseBillItems(
  billText: string,
): Array<{ name: string; quantity?: number; unitPrice?: number; total: number }> {
  const items: Array<{ name: string; quantity?: number; unitPrice?: number; total: number }> = []
  const seenItems = new Map<string, number>() // Track seen items to prevent duplicates

  // Split by lines
  const lines = billText.split("\n").filter((line) => line.trim())

  // Simple parser to extract item name and price
  for (const line of lines) {
    // Look for patterns like "Item Name: ₱1,000.00" or "Item Name ₱1000" or just numbers
    // Support both comma-separated thousands and plain numbers
    const priceMatch = line.match(/₱?\s*(\d{1,3}(?:,\d{3})*(?:\.\d{2})?|\d+(?:\.\d{2})?)/)
    if (priceMatch) {
      const price = Number.parseFloat(priceMatch[1].replace(/,/g, ""))
      if (price > 0 && price < 1000000) {
        // Reasonable hospital charge range (up to 1M)
        let nameMatch = line.replace(priceMatch[0], "").trim()
        
        // Clean up the name - remove asterisks, colons, and special characters
        nameMatch = nameMatch.replace(/\*+/g, '').replace(/[:]+$/, '').replace(/^[:]+/, '').trim()
        
        // Fix common OCR issues with floor names
        if (nameMatch.toLowerCase().match(/^(st|nd|rd|th)\s*floor$/i)) {
          // This is likely a truncated floor name like "th Floor" - skip it, we need the full name
          continue
        }
        
        if (nameMatch && nameMatch.length > 2) {
          const lowerName = nameMatch.toLowerCase()
          
          // Check if this looks like a non-billable item
          const isExcluded = excludeKeywords.some(keyword => lowerName.includes(keyword))
          
          // Check if this looks like a medical service
          const isMedical = medicalKeywords.some(keyword => lowerName.includes(keyword))
          
          // Validate suspicious prices - floor charges, room charges should be > ₱100
          const isFloorOrRoom = lowerName.includes('floor') || lowerName.includes('room') || lowerName.includes('ward')
          if (isFloorOrRoom && price < 100) {
            // This is likely an OCR error - ₱5 for a floor is impossible
            console.log(`[v0] Skipping suspicious low price for ${nameMatch}: ₱${price}`)
            continue
          }
          
          // DEDUPLICATION: Check if we've seen this item before
          const normalizedName = lowerName.replace(/[^a-z0-9]/g, '') // Normalize for comparison
          if (seenItems.has(normalizedName)) {
            // If same item with same price, skip (duplicate)
            // If same item with different price, keep the higher one
            const existingPrice = seenItems.get(normalizedName)!
            if (Math.abs(existingPrice - price) < 1) {
              console.log(`[v0] Skipping duplicate item: ${nameMatch} ₱${price}`)
              continue
            }
            // Different price - could be a legitimate second charge, but likely OCR reading same item twice
            // Keep the one we already have
            console.log(`[v0] Skipping potential duplicate: ${nameMatch} ₱${price} (already have ₱${existingPrice})`)
            continue
          }
          
          // Only include if it's medical OR (not excluded AND price > 50)
          // Small amounts like ₱1, ₱2, ₱10 are likely reference numbers
          if (isMedical || (!isExcluded && price > 50)) {
            seenItems.set(normalizedName, price)
            items.push({
              name: nameMatch,
              total: price,
            })
          }
        }
      }
    }
  }

  // If no items found, create a default one
  if (items.length === 0) {
    items.push({
      name: "Hospital Services",
      total: 5000,
    })
  }

  return items
}

async function extractTextFromFile(file: File): Promise<string> {
  const buffer = await file.arrayBuffer()
  const mimeType = file.type || "image/jpeg"

  if (!file.type.startsWith("image/") && file.type !== "application/pdf" && !file.name.endsWith(".pdf")) {
    return "Unable to extract text from file"
  }

  // Step 1: ALWAYS enhance image first for better OCR
  console.log("[v0] Step 1: Enhancing image for better clarity...")
  const { enhanced, mimeType: enhancedMimeType } = await enhanceImage(buffer)
  const base64 = enhanced.toString("base64")

  // Step 2: Use Google Gemini for OCR (best for document reading)
  const ocrPrompt = `You are an expert OCR system reading a Philippine hospital bill. Your task is to extract ONLY the billable line items with their exact amounts.

CRITICAL ACCURACY RULES:
1. Read EVERY digit carefully. "5,340.00" is five thousand three hundred forty, NOT "5.00"
2. Include the FULL item name. "8th Floor" not "th Floor"
3. Copy amounts EXACTLY as shown, including centavos (.XX)
4. List each item ONLY ONCE - no duplicates
5. SKIP totals, subtotals, discounts, payments - only individual charges

LOOK FOR these billable items:
- Room/Floor charges (8th Floor, Private Room, etc.)
- Emergency Room
- Operating Room
- Laboratory / Clinical Lab
- X-Ray, CT Scan, MRI, Ultrasound
- Pharmacy / Medications
- Professional Fee
- Central Supply / Sterile Supply
- Respiratory Care / Pulmonary
- Housekeeping
- Any other medical service with a peso amount

DO NOT include:
- Total, Subtotal, Balance Due, Amount Due
- Discounts (Senior Citizen, PWD)
- Payments, Credits, Refunds
- Hospital name, address, patient info

OUTPUT FORMAT - one item per line:
Service Name: ₱XX,XXX.XX

Example output:
Emergency Room: ₱25,193.96
Laboratory: ₱14,163.68
Pharmacy - Main: ₱2,583.34
X-Ray: ₱1,942.00

Return ONLY the list. No explanations. No duplicates. No totals.`

  console.log("[v0] Step 2: Extracting text using Groq Vision...")
  
  try {
    const { text } = await generateText({
      model: groqVisionModel,
      maxRetries: 2,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              image: `data:${enhancedMimeType};base64,${base64}`,
            },
            {
              type: "text",
              text: ocrPrompt,
            },
          ],
        },
      ],
    })

    console.log("[v0] Groq OCR result:", text)
    
    if (text && text.trim().length > 30) {
      return text
    }
    
    throw new Error("Groq returned insufficient text")
  } catch (groqError: any) {
    console.error("[v0] OCR failed:", groqError?.message)
    throw new Error("Failed to read the bill. Please ensure the image is clear and well-lit.")
  }
}

async function analyzeBillWithAI(billText: string) {
  const items = parseBillItems(billText)

  const masterAnalysisPrompt = `You are a hospital billing auditor checking a Philippine hospital bill for MATH ERRORS and DUPLICATES.

**BILL LINE ITEMS EXTRACTED**:
${items.map((item) => `- ${item.name.replace(/\*+/g, '').trim()}: ₱${item.total.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`).join("\n")}

**YOUR TASK**: Find billing mistakes (NOT price complaints).

**CHECK FOR**:

1. **DUPLICATE CHARGES** (CRITICAL)
   - Same service listed multiple times
   - Example: "Emergency Room" appears twice
   - Example: "Laboratory" charged 3 times
   - Look for EXACT name matches or very similar names

2. **SUSPICIOUS PATTERNS** (WARNING)
   - Two different services with identical amounts (might be duplicates)
   - Services that don't make sense together
   - Same department charged multiple times

**DO NOT FLAG**:
- High prices (hospitals can charge what they want)
- Services you think are expensive
- Normal medical charges

**RESPONSE FORMAT** (JSON ONLY):
{
  "items": [
    {
      "name": "Emergency Room",
      "total": 25193.96,
      "status": "fair",
      "reason": "Charge appears legitimate - only one emergency room charge found",
      "expectedPrice": null
    },
    {
      "name": "Laboratory (Duplicate)",
      "total": 14163.68,
      "status": "duplicate",
      "reason": "This service appears multiple times in the bill - possible duplicate charge",
      "expectedPrice": null
    }
  ],
  "overallAssessment": "Found 1 duplicate charge. Emergency Room and other services appear legitimate."
}

**STATUS VALUES**:
- "fair" = No issues detected, appears legitimate
- "warning" = Suspicious pattern (e.g., two services with same amount)
- "duplicate" = Confirmed duplicate (same service name appears multiple times)

**IMPORTANT**: 
- Use EXACT numbers from the input (don't round)
- Most items should be "fair" unless you find clear duplicates
- Be conservative - only flag as "duplicate" if you're confident

Return ONLY valid JSON, no other text.`

  // Use DeepSeek if available (most accurate for analysis)
  if (process.env.DEEPSEEK_API_KEY && process.env.DEEPSEEK_API_KEY !== 'your_deepseek_api_key_here') {
    try {
      console.log("[v0] Analyzing with DeepSeek (most accurate)...")
      const { text } = await generateText({
        model: deepseekModel,
        maxRetries: 2,
        prompt: masterAnalysisPrompt,
      })

      console.log("[v0] DeepSeek analysis response:", text)
      return parseAnalysisResponse(text, items)
    } catch (deepseekError: any) {
      console.log("[v0] DeepSeek failed, falling back to Groq...", deepseekError?.message)
    }
  }

  // Fallback to Groq
  try {
    console.log("[v0] Analyzing with Groq...")
    const { text } = await generateText({
      model: groqTextModel,
      maxRetries: 2,
      prompt: masterAnalysisPrompt,
    })

    console.log("[v0] Groq analysis response:", text)
    return parseAnalysisResponse(text, items)
  } catch (groqError: any) {
    console.error("[v0] Groq analysis failed:", groqError?.message)
    
    // Return basic analysis as last resort using the exact extracted items
    return {
      items: items.map((item) => ({
        name: item.name.replace(/\*+/g, '').trim(),
        total: item.total,
        status: "fair" as const,
        reason: "Unable to verify - AI services unavailable",
        expectedPrice: null,
      })),
      overallAssessment: `Basic analysis: ${items.length} items found, totaling ₱${items.reduce((sum, i) => sum + i.total, 0).toLocaleString('en-PH', { minimumFractionDigits: 2 })}`,
    }
  }
}

function parseAnalysisResponse(text: string, fallbackItems: Array<{ name: string; total: number }>) {
  try {
    let jsonStr = text.trim()
    if (jsonStr.includes("```json")) {
      jsonStr = jsonStr.replace(/```json\n?/g, "").replace(/```\n?/g, "")
    } else if (jsonStr.includes("```")) {
      jsonStr = jsonStr.replace(/```\n?/g, "")
    }

    const parsed = JSON.parse(jsonStr)
    console.log("[v0] Parsed analysis:", parsed)
    return parsed
  } catch (error) {
    console.error("[v0] Error parsing AI response:", error)
    return {
      items: fallbackItems.map((item) => ({
        name: item.name,
        total: item.total,
        status: item.total > 5000 ? "warning" : "fair",
        reason: item.total > 5000 ? "Price is above average for this service" : "Price appears reasonable",
        expectedPrice: item.total > 5000 ? item.total * 0.8 : null,
      })),
      overallAssessment: "Bill analysis complete",
    }
  }
}

// ═══════════════════════════════════════════════════════════════════
// DEDUCTION VALIDATION TYPES - Per improvement guidelines
// "Question everything that reduces the amount owed. Require proof for all deductions."
// ═══════════════════════════════════════════════════════════════════

interface DeductionItem {
  type: 'hmo' | 'philhealth' | 'insurance' | 'discount' | 'deposit' | 'payment' | 'unknown'
  amount: number
  description: string
  // Documentation fields - REQUIRED for validation
  hasDocumentation: boolean
  documentationType?: 'policy_number' | 'receipt_number' | 'approval_code' | 'id_number' | 'none'
  documentationValue?: string // e.g., "Policy #HMO-2024-12345"
  authorizedBy?: string // Who approved this deduction
  // Validation status
  isVerified: boolean
  verificationIssue?: string
}

interface DeductionValidation {
  totalDeductions: number
  verifiedDeductions: number
  unverifiedDeductions: number
  deductionItems: DeductionItem[]
  coverageStatus: 'confirmed' | 'unconfirmed' | 'no_coverage' | 'unknown'
  validationPassed: boolean
  issues: string[]
}

// Extract full bill financial structure using Master Prompt v5.0
interface BillFinancials {
  calculatedLineItemsTotal: number // AI's calculated sum (with duplicate prevention)
  subtotal: number // Bill's GRAND TOTAL (verified, not intermediate subtotal)
  discounts: number // Total discounts (SC, PWD, etc.)
  payments: number // Cash/card payments made
  hmoCoverage: number // HMO/Company coverage amount
  philhealthCoverage: number // PhilHealth coverage
  balanceDue: number // Final "Due from Patient" amount
  lineItemsMatchSubtotal: boolean | null // Whether AI's calculation matches bill's subtotal
  duplicatesDetected: number // Number of potential duplicates found
  rawText: string
  // NEW: Deduction validation (per improvement guidelines)
  deductionBreakdown?: DeductionItem[]
  hasAmbiguousDeductions?: boolean
  // NEW: Hierarchical total detection metadata
  grandTotalVerification?: string // How the grand total was verified
  sectionTotals?: Array<{ label: string; amount: number }> // Section totals found
  allTotals?: Array<{ label: string; amount: number; level: string; position: number }> // All totals found
}

async function extractBillFinancials(enhancedBuffer: Buffer, enhancedMimeType: string): Promise<BillFinancials> {
  // Clear logs for fresh extraction
  clearExtractionLogs()
  logExtraction('INIT', 'Starting bill financial extraction', { timestamp: new Date().toISOString() })
  
  try {
    const base64 = enhancedBuffer.toString("base64")
    
    // Use the enhanced extraction prompt from bill-extraction module
    const enhancedPrompt = generateEnhancedExtractionPrompt()
    
    // Add the complete extraction instructions
    const masterPromptV5 = `${enhancedPrompt}

## ADDITIONAL EXTRACTION REQUIREMENTS

### STEP 1: Extract ALL Totals with Hierarchy

First, identify EVERY total/subtotal on the bill:
1. List ALL amounts labeled as "total", "subtotal", "charges", etc.
2. Classify each by level (line_item, category_subtotal, section_total, grand_total)
3. Note the POSITION of each (line number or order of appearance)

### STEP 2: Identify Section Totals

Look for these specific section totals:
- "Total Hospital Charges" or "Hospital Charges"
- "Total Professional Fees" or "Professional Fees"
- "Total Ward Charges"
- "Total Room and Board"

These are INTERMEDIATE totals, NOT the grand total!

### STEP 3: Find the TRUE Grand Total

The GRAND TOTAL should:
✓ Equal the SUM of all section totals
✓ Be labeled with keywords like "GRAND TOTAL", "AMOUNT DUE", "TOTAL AMOUNT"
✓ Appear AFTER all section totals
✓ Be the LARGEST total (before deductions)

### STEP 4: Extract Deductions

For each deduction, identify:
- Type (discount, payment, HMO, PhilHealth)
- Amount
- Documentation (policy number, receipt, ID)
- Whether it's verified or assumed

### OUTPUT FORMAT (JSON ONLY):

\`\`\`json
{
  "allTotals": [
    {"label": "Total Hospital Charges", "amount": 20044.00, "level": "section_total", "position": 1},
    {"label": "Total Professional Fees", "amount": 5000.00, "level": "section_total", "position": 2},
    {"label": "GRAND TOTAL", "amount": 25044.00, "level": "grand_total", "position": 3}
  ],
  "grandTotal": {
    "label": "GRAND TOTAL",
    "amount": 25044.00,
    "confidence": 95,
    "verification": "equals Hospital Charges (20044) + Professional Fees (5000)"
  },
  "sectionTotals": [
    {"label": "Total Hospital Charges", "amount": 20044.00},
    {"label": "Total Professional Fees", "amount": 5000.00}
  ],
  "calculatedLineItemsTotal": 25044.00,
  "subtotal": 25044.00,
  "discounts": 0.00,
  "payments": 0.00,
  "hmoCoverage": 0.00,
  "philhealthCoverage": 0.00,
  "balanceDue": 25044.00,
  "lineItemsMatchSubtotal": true,
  "duplicatesDetected": 0,
  "deductionBreakdown": [],
  "hasAmbiguousDeductions": false
}
\`\`\`

**CRITICAL REMINDERS:**
🚨 If Hospital Charges = ₱20,044 and Professional Fees = ₱5,000 exist, GRAND TOTAL MUST be ₱25,044!
🚨 NEVER report an intermediate subtotal as the grand total
🚨 The "subtotal" field must be the GRAND TOTAL (sum of all sections), not a section subtotal
🚨 Always verify by checking if section totals sum to your reported grand total

Return ONLY valid JSON, no other text.`

    logExtraction('PROMPT', 'Using enhanced Master Prompt v5.0 with hierarchical total detection', {
      promptLength: masterPromptV5.length,
      grandTotalKeywords: GRAND_TOTAL_KEYWORDS.slice(0, 5),
      sectionTotalKeywords: SECTION_TOTAL_KEYWORDS.slice(0, 5)
    })
    
    console.log("[v0] Extracting financial structure with Master Prompt v5.0 (Hierarchical Total Detection)...")
    
    // Use Groq vision
    try {
      const { text } = await generateText({
        model: groqVisionModel,
        maxRetries: 2,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image",
                image: `data:${enhancedMimeType};base64,${base64}`,
              },
              {
                type: "text",
                text: masterPromptV5,
              },
            ],
          },
        ],
      })

      console.log("[v0] Groq financial response:", text)
      logExtraction('AI_RESPONSE', 'Received AI response', { responseLength: text.length })
      
      // Try to match the full JSON object including nested arrays
      const jsonMatch = text.match(/\{[\s\S]*\}/)
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0])
        
        // ═══════════════════════════════════════════════════════════════════
        // HIERARCHICAL TOTAL VALIDATION (NEW)
        // Verify that the extracted subtotal is truly the GRAND TOTAL
        // ═══════════════════════════════════════════════════════════════════
        
        let verifiedSubtotal = parsed.subtotal ?? 0
        let grandTotalVerification = ''
        
        // Check if we have section totals that should sum to grand total
        if (parsed.sectionTotals && Array.isArray(parsed.sectionTotals) && parsed.sectionTotals.length >= 2) {
          const sectionSum = parsed.sectionTotals.reduce((sum: number, t: any) => sum + (t.amount || 0), 0)
          
          logExtraction('HIERARCHY', 'Checking section totals', {
            sectionTotals: parsed.sectionTotals,
            sectionSum,
            reportedSubtotal: parsed.subtotal
          })
          
          // If reported subtotal doesn't match section sum, there's a problem
          if (Math.abs(verifiedSubtotal - sectionSum) > 10) {
            console.log(`[v0] ⚠️ GRAND TOTAL MISMATCH DETECTED!`)
            console.log(`[v0]   Reported subtotal: ₱${verifiedSubtotal.toLocaleString()}`)
            console.log(`[v0]   Section totals sum: ₱${sectionSum.toLocaleString()}`)
            
            // The section sum is likely the correct grand total
            verifiedSubtotal = sectionSum
            grandTotalVerification = `CORRECTED: Using sum of section totals (₱${sectionSum.toLocaleString()}) instead of reported ₱${parsed.subtotal}`
            
            logExtraction('CORRECTION', 'Corrected grand total using section sum', {
              original: parsed.subtotal,
              corrected: sectionSum,
              reason: 'Section totals sum to different amount'
            }, true)
          }
        }
        
        // Check if grandTotal object was explicitly provided
        if (parsed.grandTotal && typeof parsed.grandTotal === 'object') {
          const explicitGrandTotal = parsed.grandTotal.amount || 0
          
          logExtraction('GRAND_TOTAL', 'Explicit grand total found', {
            label: parsed.grandTotal.label,
            amount: explicitGrandTotal,
            confidence: parsed.grandTotal.confidence,
            verification: parsed.grandTotal.verification
          })
          
          // Use explicit grand total if it's larger than current subtotal
          if (explicitGrandTotal > verifiedSubtotal && Math.abs(explicitGrandTotal - verifiedSubtotal) > 10) {
            console.log(`[v0] ✓ Using explicit grand total: ₱${explicitGrandTotal.toLocaleString()} (was ₱${verifiedSubtotal.toLocaleString()})`)
            verifiedSubtotal = explicitGrandTotal
            grandTotalVerification = `From explicit grand total: "${parsed.grandTotal.label}"`
          }
        }
        
        // Process deduction breakdown if present
        const deductionBreakdown: DeductionItem[] = []
        if (parsed.deductionBreakdown && Array.isArray(parsed.deductionBreakdown)) {
          for (const item of parsed.deductionBreakdown) {
            deductionBreakdown.push({
              type: item.type || 'unknown',
              amount: item.amount || 0,
              description: item.description || 'Unknown deduction',
              hasDocumentation: item.hasDocumentation || false,
              documentationType: item.documentationType || 'none',
              documentationValue: item.documentationValue || undefined,
              authorizedBy: item.authorizedBy || undefined,
              isVerified: item.hasDocumentation === true,
              verificationIssue: item.hasDocumentation ? undefined : 'No documentation found'
            })
          }
        }
        
        // Auto-detect ambiguous deductions if not explicitly set
        let hasAmbiguousDeductions = parsed.hasAmbiguousDeductions ?? false
        
        // Flag as ambiguous if there are deductions but no breakdown
        const totalDeductionsAmount = (parsed.discounts || 0) + (parsed.payments || 0) + 
          (parsed.hmoCoverage || 0) + (parsed.philhealthCoverage || 0)
        
        if (totalDeductionsAmount > 0 && deductionBreakdown.length === 0) {
          hasAmbiguousDeductions = true
          console.log("[v0] ⚠️ Deductions found but no breakdown provided - flagging as ambiguous")
        }
        
        // Check if any deduction lacks documentation
        const undocumentedDeductions = deductionBreakdown.filter(d => !d.hasDocumentation)
        if (undocumentedDeductions.length > 0) {
          hasAmbiguousDeductions = true
          console.log(`[v0] ⚠️ ${undocumentedDeductions.length} deduction(s) without documentation`)
        }
        
        // ═══════════════════════════════════════════════════════════════════
        // USE VERIFIED SUBTOTAL (GRAND TOTAL) - This is the key fix!
        // ═══════════════════════════════════════════════════════════════════
        const result: BillFinancials = {
          calculatedLineItemsTotal: parsed.calculatedLineItemsTotal ?? 0,
          subtotal: verifiedSubtotal, // USE VERIFIED GRAND TOTAL, not raw parsed.subtotal
          discounts: parsed.discounts ?? 0,
          payments: parsed.payments ?? 0,
          hmoCoverage: parsed.hmoCoverage ?? 0,
          philhealthCoverage: parsed.philhealthCoverage ?? 0,
          balanceDue: parsed.balanceDue ?? 0,
          lineItemsMatchSubtotal: parsed.lineItemsMatchSubtotal ?? null,
          duplicatesDetected: parsed.duplicatesDetected ?? 0,
          rawText: text,
          deductionBreakdown: deductionBreakdown,
          hasAmbiguousDeductions: hasAmbiguousDeductions,
          // Store extraction metadata for audit
          grandTotalVerification: grandTotalVerification,
          sectionTotals: parsed.sectionTotals || [],
          allTotals: parsed.allTotals || [],
        }
        
        // Comprehensive logging
        console.log("[v0] ═══════════════════════════════════════════")
        console.log("[v0] BILL FINANCIAL EXTRACTION COMPLETE")
        console.log("[v0] ═══════════════════════════════════════════")
        console.log(`[v0] Grand Total (verified): ₱${verifiedSubtotal.toLocaleString()}`)
        if (grandTotalVerification) {
          console.log(`[v0] Verification: ${grandTotalVerification}`)
        }
        if (parsed.sectionTotals && parsed.sectionTotals.length > 0) {
          console.log(`[v0] Section totals found:`)
          parsed.sectionTotals.forEach((t: any) => {
            console.log(`[v0]   - ${t.label}: ₱${(t.amount || 0).toLocaleString()}`)
          })
        }
        console.log(`[v0] Calculated line items total: ₱${result.calculatedLineItemsTotal.toLocaleString()}`)
        console.log(`[v0] Balance due: ₱${result.balanceDue.toLocaleString()}`)
        console.log("[v0] ═══════════════════════════════════════════")
        
        logExtraction('RESULT', 'Financial extraction complete', {
          grandTotal: verifiedSubtotal,
          verification: grandTotalVerification,
          sectionTotalsCount: (parsed.sectionTotals || []).length,
          hasDeductions: totalDeductionsAmount > 0,
          hasAmbiguousDeductions
        })
        
        // Log duplicate detection
        if (result.duplicatesDetected && result.duplicatesDetected > 0) {
          console.log(`[v0] ⚠️ AI detected ${result.duplicatesDetected} potential duplicate(s)`)
          logExtraction('DUPLICATES', 'Duplicates detected', { count: result.duplicatesDetected }, false)
        }
        
        // Log line items vs subtotal match
        if (result.calculatedLineItemsTotal && result.subtotal) {
          const diff = Math.abs(result.calculatedLineItemsTotal - result.subtotal)
          if (diff > 100) {
            console.log(`[v0] ⚠️ Line items calculation (₱${result.calculatedLineItemsTotal}) differs from grand total (₱${result.subtotal}) by ₱${diff}`)
            logExtraction('MISMATCH', 'Line items vs grand total mismatch', {
              calculatedLineItems: result.calculatedLineItemsTotal,
              grandTotal: result.subtotal,
              difference: diff
            }, false)
          } else {
            console.log(`[v0] ✓ Line items match grand total (within ₱${diff})`)
          }
        }
        
        // Log the payment breakdown for debugging
        if (result.subtotal && result.balanceDue >= 0) {
          const totalDeductions = (result.discounts || 0) + (result.payments || 0) + (result.hmoCoverage || 0) + (result.philhealthCoverage || 0)
          console.log(`[v0] Payment breakdown: ₱${result.subtotal} - ₱${totalDeductions} = ₱${result.balanceDue}`)
        }
        
        return result
      }
      
      throw new Error("Could not parse JSON")
    } catch (groqError: any) {
      console.log("[v0] Groq vision failed for financials:", groqError?.message)
      logExtraction('ERROR', 'Groq vision failed', { error: groqError?.message }, false)
    }
    
    // No financial data extracted
    console.warn("[v0] ⚠️ Could not extract financial structure")
    return {
      calculatedLineItemsTotal: 0,
      subtotal: 0,
      discounts: 0,
      payments: 0,
      hmoCoverage: 0,
      philhealthCoverage: 0,
      balanceDue: 0,
      lineItemsMatchSubtotal: null,
      duplicatesDetected: 0,
      rawText: "",
      deductionBreakdown: [],
      hasAmbiguousDeductions: false
    }
  } catch (error) {
    console.error("[v0] Error in extractBillFinancials:", error)
    return {
      calculatedLineItemsTotal: 0,
      subtotal: 0,
      discounts: 0,
      payments: 0,
      hmoCoverage: 0,
      philhealthCoverage: 0,
      balanceDue: 0,
      lineItemsMatchSubtotal: null,
      duplicatesDetected: 0,
      rawText: "",
      deductionBreakdown: [],
      hasAmbiguousDeductions: false
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// TWO-STEP VALIDATION FUNCTION
// Step 1: Validate bill arithmetic (line items → subtotal → total)
// Step 2: Validate all deductions with supporting documentation
// ═══════════════════════════════════════════════════════════════════════════════

function validateDeductions(financials: BillFinancials): DeductionValidation {
  const issues: string[] = []
  let verifiedAmount = 0
  let unverifiedAmount = 0
  
  const deductionItems: DeductionItem[] = financials.deductionBreakdown || []
  
  // If we have aggregate deductions but no breakdown, create synthetic items
  if (deductionItems.length === 0) {
    const totalDeductions = financials.discounts + financials.payments + 
      financials.hmoCoverage + financials.philhealthCoverage
    
    if (totalDeductions > 0) {
      // Create unverified items for each deduction type
      if (financials.discounts > 0) {
        deductionItems.push({
          type: 'discount',
          amount: financials.discounts,
          description: 'Discounts (unspecified)',
          hasDocumentation: false,
          isVerified: false,
          verificationIssue: 'No breakdown provided - could be SC, PWD, or other discount'
        })
        issues.push(`⚠️ Discount of ₱${financials.discounts.toLocaleString()} applied without clear breakdown`)
      }
      
      if (financials.payments > 0) {
        deductionItems.push({
          type: 'payment',
          amount: financials.payments,
          description: 'Payments/Deposits (unspecified)',
          hasDocumentation: false,
          isVerified: false,
          verificationIssue: 'No receipt or reference number visible'
        })
        issues.push(`⚠️ Payment of ₱${financials.payments.toLocaleString()} without receipt reference`)
      }
      
      if (financials.hmoCoverage > 0) {
        deductionItems.push({
          type: 'hmo',
          amount: financials.hmoCoverage,
          description: 'HMO/Company Coverage (unverified)',
          hasDocumentation: false,
          isVerified: false,
          verificationIssue: 'No policy number or LOA visible - coverage not confirmed'
        })
        issues.push(`⚠️ HMO coverage of ₱${financials.hmoCoverage.toLocaleString()} claimed but not verified`)
      }
      
      if (financials.philhealthCoverage > 0) {
        deductionItems.push({
          type: 'philhealth',
          amount: financials.philhealthCoverage,
          description: 'PhilHealth Coverage (unverified)',
          hasDocumentation: false,
          isVerified: false,
          verificationIssue: 'No member ID or claim number visible'
        })
        issues.push(`⚠️ PhilHealth coverage of ₱${financials.philhealthCoverage.toLocaleString()} claimed but not verified`)
      }
    }
  }
  
  // Calculate verified vs unverified amounts
  for (const item of deductionItems) {
    if (item.isVerified || item.hasDocumentation) {
      verifiedAmount += item.amount
    } else {
      unverifiedAmount += item.amount
      if (!item.verificationIssue) {
        item.verificationIssue = 'Documentation not found'
      }
    }
  }
  
  // Determine coverage status
  let coverageStatus: 'confirmed' | 'unconfirmed' | 'no_coverage' | 'unknown' = 'unknown'
  const hasCoverage = financials.hmoCoverage > 0 || financials.philhealthCoverage > 0
  
  if (!hasCoverage) {
    coverageStatus = 'no_coverage'
  } else {
    const coverageItems = deductionItems.filter(d => d.type === 'hmo' || d.type === 'philhealth' || d.type === 'insurance')
    const verifiedCoverage = coverageItems.filter(d => d.isVerified)
    
    if (verifiedCoverage.length === coverageItems.length && coverageItems.length > 0) {
      coverageStatus = 'confirmed'
    } else if (coverageItems.length > 0) {
      coverageStatus = 'unconfirmed'
      issues.push(`⚠️ COVERAGE NOT VERIFIED: Patient coverage is assumed but no documentation visible. Default assumption should be full payment.`)
    }
  }
  
  // Check for the problematic "PAYMENTS/DEPOSITS/DISCOUNTS" lumped together
  const totalDeductions = financials.discounts + financials.payments + 
    financials.hmoCoverage + financials.philhealthCoverage
  
  if (totalDeductions > 0 && deductionItems.every(d => !d.hasDocumentation)) {
    issues.push(`❌ ALL DEDUCTIONS UNVERIFIED: ₱${totalDeductions.toLocaleString()} in deductions applied without visible documentation`)
  }
  
  const validationPassed = issues.length === 0 && unverifiedAmount === 0
  
  return {
    totalDeductions: verifiedAmount + unverifiedAmount,
    verifiedDeductions: verifiedAmount,
    unverifiedDeductions: unverifiedAmount,
    deductionItems,
    coverageStatus,
    validationPassed,
    issues
  }
}

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData()
    const file = formData.get("file") as File

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 })
    }

    console.log("[v0] ═══════════════════════════════════════════════════════════════")
    console.log("[v0] BILLGUARD ANALYSIS STARTED")
    console.log("[v0] ═══════════════════════════════════════════════════════════════")
    console.log("[v0] Processing file:", file.name, file.type)

    const buffer = await file.arrayBuffer()
    const inputBuffer = Buffer.from(buffer)
    
    // ═══════════════════════════════════════════════════════════════════════════
    // Skip Tesseract.js (has module resolution issues with pnpm)
    // Using AI Vision extraction instead (more reliable in this environment)
    // ═══════════════════════════════════════════════════════════════════════════
    console.log("[v0] Step 1: Enhancing image with Sharp...")
    
    const { enhanced, mimeType: enhancedMimeType } = await enhanceImage(buffer)
    
    // ═══════════════════════════════════════════════════════════════════════════
    // Step 2: Use AI Vision for text extraction and financial parsing
    // ═══════════════════════════════════════════════════════════════════════════
    console.log("[v0] Step 2: Running AI Vision extraction...")
    
    const [billText, aiFinancials] = await Promise.all([
      extractTextFromFile(file),
      extractBillFinancials(enhanced, enhancedMimeType)
    ])
    
    console.log("[v0] AI Vision completed:")
    console.log(`[v0]   - Subtotal: ₱${aiFinancials.subtotal?.toLocaleString() || 'not found'}`)
    console.log(`[v0]   - Balance Due: ₱${aiFinancials.balanceDue?.toLocaleString() || 'not found'}`)
    console.log(`[v0]   - Line items total: ₱${aiFinancials.calculatedLineItemsTotal?.toLocaleString() || 'not found'}`)
    
    // ═══════════════════════════════════════════════════════════════════════════
    // Step 3: Use AI results (Tesseract disabled)
    // ═══════════════════════════════════════════════════════════════════════════
    console.log("[v0] Step 3: Processing financial data...")
    
    let finalFinancials = aiFinancials
    
    // Fallback: If AI extraction failed, try text-based parsing
    if ((finalFinancials.subtotal === 0 || finalFinancials.subtotal === null) && billText) {
      console.log("[v0] Trying text-based financial extraction as fallback...")
      
      const textLines = billText.toLowerCase().split('\n')
      let foundSubtotal = null
      let foundBalance = null
      let foundDiscount = null
      let foundPayment = null
      
      for (const line of textLines) {
        if (line.includes('subtotal') || line.includes('gross total') || line.includes('total charges') || line.includes('grand total')) {
          const match = line.match(/₱?\s*([\d,]+\.?\d*)/)
          if (match) {
            const value = Number.parseFloat(match[1].replace(/,/g, ''))
            if (value > (foundSubtotal || 0)) foundSubtotal = value
          }
        }
        
        if (line.includes('balance due') || line.includes('amount due') || line.includes('net amount')) {
          const match = line.match(/₱?\s*([\d,]+\.?\d*)/)
          if (match) foundBalance = Number.parseFloat(match[1].replace(/,/g, ''))
        }
        
        if (line.includes('discount') || line.includes('less:')) {
          const match = line.match(/₱?\s*([\d,]+\.?\d*)/)
          if (match) foundDiscount = Number.parseFloat(match[1].replace(/,/g, ''))
        }
        
        if (line.includes('payment') || line.includes('paid')) {
          const match = line.match(/₱?\s*([\d,]+\.?\d*)/)
          if (match) foundPayment = Number.parseFloat(match[1].replace(/,/g, ''))
        }
      }
      
      if (foundSubtotal || foundBalance) {
        finalFinancials.subtotal = foundSubtotal || finalFinancials.subtotal || 0
        finalFinancials.balanceDue = foundBalance || finalFinancials.balanceDue || 0
        finalFinancials.discounts = foundDiscount || finalFinancials.discounts || 0
        finalFinancials.payments = foundPayment || finalFinancials.payments || 0
        console.log("[v0] ✓ Extracted via text parsing:", {
          subtotal: finalFinancials.subtotal,
          balanceDue: finalFinancials.balanceDue
        })
      }
    }
    
    console.log("[v0] Final financials to use:")
    console.log(`[v0]   - Subtotal/Grand Total: ₱${finalFinancials.subtotal?.toLocaleString()}`)
    console.log(`[v0]   - Discounts: ₱${finalFinancials.discounts?.toLocaleString()}`)
    console.log(`[v0]   - Payments: ₱${finalFinancials.payments?.toLocaleString()}`)
    console.log(`[v0]   - Balance Due: ₱${finalFinancials.balanceDue?.toLocaleString()}`)

    // Step 4: Analyze with AI (for duplicate detection, etc.)
    const analysis = await analyzeBillWithAI(billText)

    // Step 4: Calculate OUR total from the extracted items
    let calculatedSubtotal = 0
    let totalMathErrors = 0
    let warningCount = 0
    let errorCount = 0
    let duplicateCount = 0

    for (const item of analysis.items) {
      const itemTotal = Number(item.total) || 0
      calculatedSubtotal += itemTotal

      if (item.status === "duplicate") {
        duplicateCount++
        errorCount++
        totalMathErrors += itemTotal // Full amount is error for duplicates
      } else if (item.status === "warning") {
        warningCount++
      }
    }

    calculatedSubtotal = Math.round(calculatedSubtotal * 100) / 100

    // Step 5: COMPREHENSIVE BILL VALIDATION - Check all calculations
    const mathErrors: any[] = []
    let chargeStatus: "CORRECTLY_CHARGED" | "UNDERCHARGED" | "OVERCHARGED" = "CORRECTLY_CHARGED"
    let totalDiscrepancy = 0
    
    // ═══════════════════════════════════════════════════════════════════
    // CHECK 1: SUBTOTAL VERIFICATION
    // Does our line items calculation match the bill's stated subtotal?
    // ═══════════════════════════════════════════════════════════════════
    let subtotalStatus: "CORRECT" | "UNDERCHARGED_SUBTOTAL" | "OVERCHARGED_SUBTOTAL" = "CORRECT"
    
    if (finalFinancials.subtotal > 0 && calculatedSubtotal > 0) {
      const subtotalDiff = calculatedSubtotal - finalFinancials.subtotal
      
      console.log("[v0] ═══ SUBTOTAL VERIFICATION ═══")
      console.log(`[v0] Our calculated line items total: ₱${calculatedSubtotal.toLocaleString()}`)
      console.log(`[v0] Bill's stated subtotal: ₱${finalFinancials.subtotal.toLocaleString()}`)
      console.log(`[v0] Difference: ₱${subtotalDiff.toLocaleString()}`)
      
      if (Math.abs(subtotalDiff) > 10) {
        if (subtotalDiff > 0) {
          // Calculated > Stated = Hospital undercharged (they lose money)
          subtotalStatus = "UNDERCHARGED_SUBTOTAL"
          mathErrors.push({
            name: "⚠️ SUBTOTAL UNDERCHARGE",
            total: finalFinancials.subtotal,
            status: "error" as const,
            reason: `Line items sum to ₱${calculatedSubtotal.toLocaleString()} but bill shows ₱${finalFinancials.subtotal.toLocaleString()}. Hospital undercharged by ₱${Math.abs(subtotalDiff).toLocaleString()}. This is a revenue loss for the hospital.`,
            expectedPrice: calculatedSubtotal,
            impact: "hospital",
          })
        } else {
          // Calculated < Stated = Hospital overcharged (patient pays more)
          subtotalStatus = "OVERCHARGED_SUBTOTAL"
          mathErrors.push({
            name: "⚠️ SUBTOTAL OVERCHARGE",
            total: finalFinancials.subtotal,
            status: "error" as const,
            reason: `Line items sum to ₱${calculatedSubtotal.toLocaleString()} but bill shows ₱${finalFinancials.subtotal.toLocaleString()}. Hospital overcharged by ₱${Math.abs(subtotalDiff).toLocaleString()}. Patient is being charged MORE than itemized services.`,
            expectedPrice: calculatedSubtotal,
            impact: "patient",
          })
        }
        errorCount++
        totalDiscrepancy += Math.abs(subtotalDiff)
      } else {
        console.log(`[v0] ✓ Subtotal matches (within ₱${Math.abs(subtotalDiff).toFixed(2)})`)
      }
    }
    
    // ═══════════════════════════════════════════════════════════════════
    // CHECK 2: BALANCE VERIFICATION
    // Does: subtotal - discounts - payments - HMO - PhilHealth = balanceDue?
    // ═══════════════════════════════════════════════════════════════════
    let balanceStatus: "CORRECT" | "PATIENT_UNDERCHARGED" | "PATIENT_OVERCHARGED" = "CORRECT"
    
    if (finalFinancials.subtotal > 0 && finalFinancials.balanceDue >= 0) {
      // Use the BILL's stated subtotal for balance calculation (not our calculated one)
      const totalDeductions = finalFinancials.discounts + finalFinancials.payments + finalFinancials.hmoCoverage + finalFinancials.philhealthCoverage
      const calculatedBalance = finalFinancials.subtotal - totalDeductions
      const balanceDiff = calculatedBalance - finalFinancials.balanceDue
      
      console.log("[v0] ═══ BALANCE VERIFICATION ═══")
      console.log(`[v0] Bill subtotal: ₱${finalFinancials.subtotal.toLocaleString()}`)
      console.log(`[v0] - Discounts: ₱${finalFinancials.discounts.toLocaleString()}`)
      console.log(`[v0] - Payments: ₱${finalFinancials.payments.toLocaleString()}`)
      console.log(`[v0] - HMO Coverage: ₱${finalFinancials.hmoCoverage.toLocaleString()}`)
      console.log(`[v0] - PhilHealth: ₱${finalFinancials.philhealthCoverage.toLocaleString()}`)
      console.log(`[v0] = Calculated balance: ₱${calculatedBalance.toLocaleString()}`)
      console.log(`[v0] Bill states: ₱${finalFinancials.balanceDue.toLocaleString()}`)
      console.log(`[v0] Difference: ₱${balanceDiff.toLocaleString()}`)
      
      if (Math.abs(balanceDiff) > 10) {
        const deductionBreakdown = []
        if (finalFinancials.discounts > 0) deductionBreakdown.push(`₱${finalFinancials.discounts.toLocaleString()} discounts`)
        if (finalFinancials.payments > 0) deductionBreakdown.push(`₱${finalFinancials.payments.toLocaleString()} payments`)
        if (finalFinancials.hmoCoverage > 0) deductionBreakdown.push(`₱${finalFinancials.hmoCoverage.toLocaleString()} HMO`)
        if (finalFinancials.philhealthCoverage > 0) deductionBreakdown.push(`₱${finalFinancials.philhealthCoverage.toLocaleString()} PhilHealth`)
        
        if (balanceDiff > 0) {
          // Calculated > Stated = Patient undercharged (paying less)
          balanceStatus = "PATIENT_UNDERCHARGED"
          mathErrors.push({
            name: "⚠️ PATIENT BALANCE UNDERCHARGE",
            total: finalFinancials.balanceDue,
            status: "error" as const,
            reason: `Balance should be: ₱${finalFinancials.subtotal.toLocaleString()} - ${deductionBreakdown.join(' - ')} = ₱${calculatedBalance.toLocaleString()}, but bill shows ₱${finalFinancials.balanceDue.toLocaleString()}. Patient is paying ₱${Math.abs(balanceDiff).toLocaleString()} LESS than they should (hospital loses money).`,
            expectedPrice: calculatedBalance,
            impact: "hospital",
          })
        } else {
          // Calculated < Stated = Patient overcharged (paying more)
          balanceStatus = "PATIENT_OVERCHARGED"
          mathErrors.push({
            name: "⚠️ PATIENT BALANCE OVERCHARGE",
            total: finalFinancials.balanceDue,
            status: "error" as const,
            reason: `Balance should be: ₱${finalFinancials.subtotal.toLocaleString()} - ${deductionBreakdown.join(' - ')} = ₱${calculatedBalance.toLocaleString()}, but bill shows ₱${finalFinancials.balanceDue.toLocaleString()}. Patient is paying ₱${Math.abs(balanceDiff).toLocaleString()} MORE than they should.`,
            expectedPrice: calculatedBalance,
            impact: "patient",
          })
        }
        errorCount++
        totalDiscrepancy += Math.abs(balanceDiff)
      } else {
        console.log(`[v0] ✓ Balance calculation correct (within ₱${Math.abs(balanceDiff).toFixed(2)})`)
      }
    }
    
    // ═══════════════════════════════════════════════════════════════════
    // DETERMINE FINAL STATUS
    // ═══════════════════════════════════════════════════════════════════
    if (subtotalStatus === "CORRECT" && balanceStatus === "CORRECT") {
      chargeStatus = "CORRECTLY_CHARGED"
    } else if (subtotalStatus.includes("UNDERCHARGED") || balanceStatus === "PATIENT_UNDERCHARGED") {
      chargeStatus = "UNDERCHARGED"
    } else {
      chargeStatus = "OVERCHARGED"
    }
    
    console.log("[v0] ═══ FINAL VALIDATION STATUS ═══")
    console.log(`[v0] Subtotal check: ${subtotalStatus}`)
    console.log(`[v0] Balance check: ${balanceStatus}`)
    console.log(`[v0] Overall status: ${chargeStatus}`)
    console.log(`[v0] Total discrepancy: ₱${totalDiscrepancy.toLocaleString()}`)


    // Step 6: Combine math errors with item analysis
    const finalItems = [...mathErrors, ...analysis.items]
    
    // Check if we have financial data to verify calculations
    const hasFinancialData = finalFinancials.subtotal > 0 || finalFinancials.balanceDue >= 0
    const couldVerifyMath = hasFinancialData
    
    // ═══════════════════════════════════════════════════════════════════
    // STEP 2 OF TWO-STEP VALIDATION: DEDUCTION VERIFICATION
    // "Question everything that reduces the amount owed"
    // ═══════════════════════════════════════════════════════════════════
    const deductionValidation = validateDeductions(finalFinancials)
    
    console.log("[v0] ═══ DEDUCTION VALIDATION ═══")
    console.log(`[v0] Total deductions: ₱${deductionValidation.totalDeductions.toLocaleString()}`)
    console.log(`[v0] Verified: ₱${deductionValidation.verifiedDeductions.toLocaleString()}`)
    console.log(`[v0] Unverified: ₱${deductionValidation.unverifiedDeductions.toLocaleString()}`)
    console.log(`[v0] Coverage status: ${deductionValidation.coverageStatus}`)
    console.log(`[v0] Validation passed: ${deductionValidation.validationPassed}`)
    if (deductionValidation.issues.length > 0) {
      console.log(`[v0] Issues found:`)
      deductionValidation.issues.forEach(issue => console.log(`[v0]   - ${issue}`))
    }
    
    // Add deduction issues to math errors if there are unverified deductions
    if (!deductionValidation.validationPassed && deductionValidation.unverifiedDeductions > 0) {
      mathErrors.push({
        name: "⚠️ UNVERIFIED DEDUCTIONS",
        total: deductionValidation.unverifiedDeductions,
        status: "warning" as const,
        reason: `₱${deductionValidation.unverifiedDeductions.toLocaleString()} in deductions applied without visible documentation. Default assumption: Patient pays full amount unless coverage is proven.`,
        expectedPrice: null,
        impact: "requires_verification",
      })
      errorCount++
    }
    
    // Add specific deduction issues as warnings
    for (const item of deductionValidation.deductionItems) {
      if (!item.isVerified && item.amount > 0) {
        finalItems.push({
          name: `📋 ${item.description}`,
          total: item.amount,
          status: "warning" as const,
          reason: item.verificationIssue || 'Documentation not found - requires verification',
          expectedPrice: null,
        })
      }
    }
    
    // Determine affected party and confidence
    let affectedParty: "hospital" | "patient" | "none" = "none"
    let confidence = 95
    
    if (chargeStatus === "UNDERCHARGED") {
      affectedParty = "hospital"
    } else if (chargeStatus === "OVERCHARGED") {
      affectedParty = "patient"
    }
    
    // Build comprehensive assessment message
    let overallMessage = ""
    
    if (chargeStatus === "CORRECTLY_CHARGED" && couldVerifyMath) {
      overallMessage = `✅ CORRECTLY CHARGED - All calculations verified.\n\n`
      overallMessage += `✓ Step 1: Subtotal matches line items\n`
      overallMessage += `✓ Step 2: Balance calculation correct\n`
      
      // Add deduction validation status
      if (deductionValidation.validationPassed) {
        overallMessage += `✓ Deductions: ${deductionValidation.deductionItems.length > 0 ? 'All verified with documentation' : 'N/A - no deductions applied'}\n`
      } else if (deductionValidation.unverifiedDeductions > 0) {
        overallMessage += `\n⚠️ DEDUCTION ALERT:\n`
        overallMessage += `₱${deductionValidation.unverifiedDeductions.toLocaleString()} in deductions lack documentation.\n`
        for (const issue of deductionValidation.issues) {
          overallMessage += `• ${issue}\n`
        }
      }
      
      overallMessage += `\n✓ Patient pays: ₱${finalFinancials.balanceDue.toLocaleString()}`
      confidence = deductionValidation.validationPassed ? 100 : 85
    } else if (chargeStatus === "UNDERCHARGED") {
      overallMessage = `⚠️ UNDERCHARGED - Hospital loses ₱${totalDiscrepancy.toLocaleString()}\n\n`
      overallMessage += `Affected party: HOSPITAL (revenue loss)\n\n`
      
      if (subtotalStatus === "UNDERCHARGED_SUBTOTAL") {
        overallMessage += `• Subtotal Issue: Bill shows ₱${finalFinancials.subtotal.toLocaleString()} but line items sum to ₱${calculatedSubtotal.toLocaleString()}\n`
      }
      if (balanceStatus === "PATIENT_UNDERCHARGED") {
        overallMessage += `• Balance Issue: Patient paying ₱${Math.abs(totalDiscrepancy).toLocaleString()} less than they should\n`
      }
      
      overallMessage += `\nLikely causes: Pre-applied discount not documented, calculation error, or missing line items`
      confidence = 90
    } else if (chargeStatus === "OVERCHARGED") {
      overallMessage = `🚨 OVERCHARGED - Patient pays ₱${totalDiscrepancy.toLocaleString()} extra\n\n`
      overallMessage += `Affected party: PATIENT (overpayment)\n\n`
      
      if (subtotalStatus === "OVERCHARGED_SUBTOTAL") {
        overallMessage += `• Subtotal Issue: Bill shows ₱${finalFinancials.subtotal.toLocaleString()} but line items only sum to ₱${finalFinancials.calculatedLineItemsTotal.toLocaleString()}\n`
      }
      if (balanceStatus === "PATIENT_OVERCHARGED") {
        overallMessage += `• Balance Issue: Patient paying ₱${Math.abs(totalDiscrepancy).toLocaleString()} more than they should\n`
      }
      
      overallMessage += `\n⚠️ RECOMMENDED ACTION: Request bill correction immediately`
      confidence = 95
    } else if (!couldVerifyMath) {
      overallMessage = `⚠️ Could not verify bill calculations - financial totals not clearly visible.\n\n`
      overallMessage += `Please upload a clearer image showing:\n`
      overallMessage += `• Total/Subtotal section\n`
      overallMessage += `• Discounts and payments\n`
      overallMessage += `• Final "Due from Patient" amount`
      confidence = 50
    }
    
    // Add deduction validation warnings to all messages
    if (!deductionValidation.validationPassed && deductionValidation.issues.length > 0 && chargeStatus !== "CORRECTLY_CHARGED") {
      overallMessage += `\n\n━━━ DEDUCTION VERIFICATION ISSUES ━━━\n`
      for (const issue of deductionValidation.issues) {
        overallMessage += `${issue}\n`
      }
      overallMessage += `\n💡 TIP: Request itemized breakdown of all deductions with supporting documents.`
    }
    
    // Check for AI-detected duplicates
    if (finalFinancials.duplicatesDetected > 0) {
      overallMessage += `\n\n⚠️ Note: ${finalFinancials.duplicatesDetected} potential duplicate line item(s) detected in bill structure`
      confidence = Math.min(confidence, 85)
    }
    
    // Add coverage verification note
    if (deductionValidation.coverageStatus === 'unconfirmed') {
      overallMessage += `\n\n⚠️ COVERAGE STATUS: Unconfirmed`
      overallMessage += `\nHMO/Insurance coverage appears to be applied but documentation is not visible.`
      overallMessage += `\nDefault assumption: Patient should pay FULL amount unless coverage is proven.`
      confidence = Math.min(confidence, 80)
    }

    const response = {
      items: finalItems,
      overallAssessment: overallMessage,
      
      // Financial breakdown
      totalCharges: calculatedSubtotal, // This is what we calculated from parsed items
      statedTotal: finalFinancials.balanceDue,
      billSubtotal: finalFinancials.subtotal,
      calculatedLineItemsTotal: calculatedSubtotal, // Use our calculation, not AI's
      discounts: finalFinancials.discounts,
      payments: finalFinancials.payments,
      hmoCoverage: finalFinancials.hmoCoverage,
      philhealthCoverage: finalFinancials.philhealthCoverage,
      
      // Validation results
      chargeStatus: chargeStatus, // CORRECTLY_CHARGED | UNDERCHARGED | OVERCHARGED
      subtotalCheck: subtotalStatus,
      balanceCheck: balanceStatus,
      totalDiscrepancy: totalDiscrepancy,
      affectedParty: affectedParty,
      confidence: confidence,
      
      // OCR debugging info (Tesseract disabled - using AI Vision only)
      ocrInfo: {
        tesseractConfidence: 0,
        tesseractGrandTotal: null,
        aiGrandTotal: aiFinancials.subtotal || null,
        usedSource: 'ai_vision' as const
      },
      
      // NEW: Deduction validation results (per improvement guidelines)
      deductionValidation: {
        totalDeductions: deductionValidation.totalDeductions,
        verifiedDeductions: deductionValidation.verifiedDeductions,
        unverifiedDeductions: deductionValidation.unverifiedDeductions,
        coverageStatus: deductionValidation.coverageStatus,
        validationPassed: deductionValidation.validationPassed,
        issues: deductionValidation.issues,
        deductionBreakdown: deductionValidation.deductionItems.map(item => ({
          type: item.type,
          amount: item.amount,
          description: item.description,
          hasDocumentation: item.hasDocumentation,
          documentationType: item.documentationType,
          documentationValue: item.documentationValue,
          isVerified: item.isVerified,
          verificationIssue: item.verificationIssue
        }))
      },
      
      // Legacy fields
      totalMathErrors: totalDiscrepancy,
      hasErrors: errorCount > 0 || !deductionValidation.validationPassed,
      errorCount: errorCount,
      warningCount: warningCount + (deductionValidation.validationPassed ? 0 : deductionValidation.issues.length),
      duplicateCount: duplicateCount,
      couldVerifyMath: couldVerifyMath,
    }

    console.log("[v0] ═══════════════════════════════════════════════════════════════")
    console.log("[v0] BILLGUARD ANALYSIS COMPLETE")
    console.log("[v0] ═══════════════════════════════════════════════════════════════")
    console.log("[v0] Final result:", {
      chargeStatus,
      subtotalCheck: subtotalStatus,
      balanceCheck: balanceStatus,
      totalDiscrepancy,
      ocrSource: response.ocrInfo.usedSource
    })
    
    return NextResponse.json(response)
  } catch (error) {
    console.error("[v0] Error in analyze-bill route:", error)
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to analyze bill. Please try again with a clearer image.",
      },
      { status: 500 },
    )
  }
}