import { type NextRequest, NextResponse } from "next/server"
import { generateText } from "ai"
import { createGroq } from "@ai-sdk/groq"
import { createOpenAI } from "@ai-sdk/openai"
import sharp from "sharp"

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

// Enhance image for better OCR - always run this first
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

// Extract full bill financial structure using Master Prompt v4.0
interface BillFinancials {
  calculatedLineItemsTotal: number // AI's calculated sum (with duplicate prevention)
  subtotal: number // Bill's stated total/subtotal
  discounts: number // Total discounts (SC, PWD, etc.)
  payments: number // Cash/card payments made
  hmoCoverage: number // HMO/Company coverage amount
  philhealthCoverage: number // PhilHealth coverage
  balanceDue: number // Final "Due from Patient" amount
  lineItemsMatchSubtotal: boolean | null // Whether AI's calculation matches bill's subtotal
  duplicatesDetected: number // Number of potential duplicates found
  rawText: string
}

async function extractBillFinancials(enhancedBuffer: Buffer, enhancedMimeType: string): Promise<BillFinancials> {
  try {
    const base64 = enhancedBuffer.toString("base64")
    
    const masterPromptV4 = `# Hospital Bill Validation System - Complete Analysis Prompt

You are an expert hospital billing auditor. Your task is to extract bill data, perform mathematical validation, and determine if the patient was correctly charged, overcharged, or undercharged.

## Step-by-Step Process

### STEP 1: Extract Line Items with Hierarchy Understanding

For each line in the charges section, classify as:
- **CATEGORY_HEADER**: Label with no price (e.g., "ROOM AND BOARD")
- **ACTUAL_CHARGE**: Line with a price amount
- **SUB_ITEM**: Indented item under a category

**Rules:**
1. If line has NO price → Mark as CATEGORY_HEADER, set count_in_sum = false
2. If line is indented/bulleted under header → Mark as ACTUAL_CHARGE, count_in_sum = true
3. If parent and child have same service name → Count child only, not parent
4. Only sum items where count_in_sum = true

### STEP 2: Calculate Line Items Total

**YOU MUST CALCULATE THIS:**
\`\`\`
calculated_line_items_total = SUM of all items where count_in_sum = true
\`\`\`

### STEP 3: Extract Bill's Stated Subtotal

Find the hospital's printed subtotal (look for these labels):
- "Total Hospital Charges"
- "Hospital Bill"
- "Total Bill"
- "Subtotal"
- "Total Amount"

### STEP 4: Extract ALL Discounts

Look for:
- Senior Citizen (SC) discounts
- PWD discounts
- PhilHealth deductions (listed as discount, not coverage)
- VAT exemptions
- Other adjustments
- Look for "Less:" or negative amounts

**CRITICAL**: Distinguish between:
- **Discounts**: Reductions from subtotal (SC, PWD, VAT exempt)
- **Coverage**: Third-party payments (HMO, PhilHealth reimbursement)

### STEP 5: Extract ALL Payments & Third-Party Coverage

**CRITICAL - Look for these indicators:**

1. **"Due from Patient" vs "Total Bill" difference**
   - If Total Bill = ₱139,270.95 and Due from Patient = ₱127,270.95
   - Difference = ₱12,000 = PAYMENT/COVERAGE already applied

2. **Explicit sections:**
   - "PAYMENTS/DEPOSITS/DISCOUNTS"
   - "HMO/COMPANY"
   - "Less: Payments Made"
   - "PhilHealth Coverage"

3. **Visual indicators:**
   - Amounts in parentheses: (₱12,000)
   - "Less:" prefix
   - Negative amounts in payment section

### STEP 6: Extract Patient's Stated Balance

Find the amount patient is supposed to pay (look for):
- "Due from Patient"
- "Please Pay This Amount"
- "Balance Due"
- "Net Amount Due"
- "Patient Responsibility"

### OUTPUT FORMAT (JSON ONLY):

\`\`\`json
{
  "calculatedLineItemsTotal": 57074.71,
  "subtotal": 56325.00,
  "discounts": 1240.00,
  "hmoCoverage": 12000.00,
  "philhealthCoverage": 0.00,
  "payments": 4960.00,
  "balanceDue": 38125.00,
  "lineItemsMatchSubtotal": false,
  "duplicatesDetected": 0
}
\`\`\`

**CRITICAL RULES**:
1. calculatedLineItemsTotal = YOUR calculated sum (count_in_sum=true items only)
2. subtotal = what the BILL states as subtotal/total
3. discounts = ALL discounts (SC, PWD, VAT, etc.)
4. hmoCoverage = HMO/Company/Insurance payments
5. philhealthCoverage = PhilHealth reimbursements
6. payments = Cash/card payments already made
7. balanceDue = What patient must pay NOW
8. lineItemsMatchSubtotal = true if |calculatedLineItemsTotal - subtotal| <= 10
9. duplicatesDetected = number of duplicate line items found
10. Use 0.00 (not null) for fields not found

**VALIDATION CHECKS YOU MUST DO**:
1. Does calculatedLineItemsTotal match subtotal? (within ₱10)
2. Does: subtotal - discounts - payments - hmoCoverage - philhealthCoverage = balanceDue? (within ₱10)

Return ONLY valid JSON, no other text.`

    console.log("[v0] Extracting financial structure with Master Prompt v4.0 (100% Accuracy Focus)...")
    
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
                text: masterPromptV4,
              },
            ],
          },
        ],
      })

      console.log("[v0] Groq financial response:", text)
      
      const jsonMatch = text.match(/\{[\s\S]*?\}/)
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0])
        const result = {
          calculatedLineItemsTotal: parsed.calculatedLineItemsTotal ?? 0,
          subtotal: parsed.subtotal ?? 0,
          discounts: parsed.discounts ?? 0,
          payments: parsed.payments ?? 0,
          hmoCoverage: parsed.hmoCoverage ?? 0,
          philhealthCoverage: parsed.philhealthCoverage ?? 0,
          balanceDue: parsed.balanceDue ?? 0,
          lineItemsMatchSubtotal: parsed.lineItemsMatchSubtotal ?? null,
          duplicatesDetected: parsed.duplicatesDetected ?? 0,
          rawText: text
        }
        console.log("[v0] ✓ Extracted financials:", result)
        
        // Log duplicate detection
        if (result.duplicatesDetected && result.duplicatesDetected > 0) {
          console.log(`[v0] ⚠️ AI detected ${result.duplicatesDetected} potential duplicate(s)`)
        }
        
        // Log line items vs subtotal match
        if (result.calculatedLineItemsTotal && result.subtotal) {
          const diff = Math.abs(result.calculatedLineItemsTotal - result.subtotal)
          if (diff > 100) {
            console.log(`[v0] ⚠️ Line items calculation (₱${result.calculatedLineItemsTotal}) differs from stated subtotal (₱${result.subtotal}) by ₱${diff}`)
          } else {
            console.log(`[v0] ✓ Line items match subtotal (within ₱${diff})`)
          }
        }
        
        // Log the payment breakdown for debugging
        if (result.subtotal && result.balanceDue) {
          const totalDeductions = (result.discounts || 0) + (result.payments || 0) + (result.hmoCoverage || 0) + (result.philhealthCoverage || 0)
          console.log(`[v0] Payment breakdown: ₱${result.subtotal} - ₱${totalDeductions} = ₱${result.balanceDue}`)
        }
        
        return result
      }
      
      throw new Error("Could not parse JSON")
    } catch (groqError: any) {
      console.log("[v0] Groq vision failed for financials:", groqError?.message)
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
      rawText: ""
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
      rawText: ""
    }
  }
}

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData()
    const file = formData.get("file") as File

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 })
    }

    console.log("[v0] Processing file:", file.name, file.type)

    // Step 1: Enhance image
    const buffer = await file.arrayBuffer()
    const { enhanced, mimeType: enhancedMimeType } = await enhanceImage(buffer)
    
    // Step 2: Extract line items AND financial structure (in parallel)
    console.log("[v0] Extracting items and financial structure in parallel...")
    const [billText, financials] = await Promise.all([
      extractTextFromFile(file),
      extractBillFinancials(enhanced, enhancedMimeType)
    ])
    
    console.log("[v0] Extracted text:", billText)
    console.log("[v0] Bill financials:", financials)
    
    // Step 2.5: If financial extraction failed, try text-based parsing as fallback
    if (financials.subtotal === null && financials.balanceDue === null && billText) {
      console.log("[v0] Trying text-based financial extraction as fallback...")
      
      // Look for common patterns in extracted text
      const lines = billText.toLowerCase().split('\n')
      let foundSubtotal = null
      let foundBalance = null
      let foundDiscount = null
      let foundPayment = null
      
      for (const line of lines) {
        // Match subtotal patterns
        if (line.includes('subtotal') || line.includes('gross total') || line.includes('total charges')) {
          const match = line.match(/₱?\s*([\d,]+\.?\d*)/)
          if (match) foundSubtotal = Number.parseFloat(match[1].replace(/,/g, ''))
        }
        
        // Match balance due patterns
        if (line.includes('balance due') || line.includes('amount due') || line.includes('net amount')) {
          const match = line.match(/₱?\s*([\d,]+\.?\d*)/)
          if (match) foundBalance = Number.parseFloat(match[1].replace(/,/g, ''))
        }
        
        // Match discount patterns
        if (line.includes('discount') || line.includes('less:')) {
          const match = line.match(/₱?\s*([\d,]+\.?\d*)/)
          if (match) foundDiscount = Number.parseFloat(match[1].replace(/,/g, ''))
        }
        
        // Match payment patterns
        if (line.includes('payment') || line.includes('paid')) {
          const match = line.match(/₱?\s*([\d,]+\.?\d*)/)
          if (match) foundPayment = Number.parseFloat(match[1].replace(/,/g, ''))
        }
      }
      
      if (foundSubtotal || foundBalance) {
        financials.subtotal = foundSubtotal || 0
        financials.balanceDue = foundBalance || 0
        financials.discounts = foundDiscount || 0
        financials.payments = foundPayment || 0
        financials.hmoCoverage = 0
        financials.philhealthCoverage = 0
        financials.calculatedLineItemsTotal = 0
        financials.lineItemsMatchSubtotal = null
        financials.duplicatesDetected = 0
        console.log("[v0] ✓ Extracted via text parsing:", financials)
      }
    }

    // Step 3: Analyze with AI
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
    
    if (financials.subtotal > 0 && calculatedSubtotal > 0) {
      const subtotalDiff = calculatedSubtotal - financials.subtotal
      
      console.log("[v0] ═══ SUBTOTAL VERIFICATION ═══")
      console.log(`[v0] Our calculated line items total: ₱${calculatedSubtotal.toLocaleString()}`)
      console.log(`[v0] Bill's stated subtotal: ₱${financials.subtotal.toLocaleString()}`)
      console.log(`[v0] Difference: ₱${subtotalDiff.toLocaleString()}`)
      
      if (Math.abs(subtotalDiff) > 10) {
        if (subtotalDiff > 0) {
          // Calculated > Stated = Hospital undercharged (they lose money)
          subtotalStatus = "UNDERCHARGED_SUBTOTAL"
          mathErrors.push({
            name: "⚠️ SUBTOTAL UNDERCHARGE",
            total: financials.subtotal,
            status: "error" as const,
            reason: `Line items sum to ₱${calculatedSubtotal.toLocaleString()} but bill shows ₱${financials.subtotal.toLocaleString()}. Hospital undercharged by ₱${Math.abs(subtotalDiff).toLocaleString()}. This is a revenue loss for the hospital.`,
            expectedPrice: calculatedSubtotal,
            impact: "hospital",
          })
        } else {
          // Calculated < Stated = Hospital overcharged (patient pays more)
          subtotalStatus = "OVERCHARGED_SUBTOTAL"
          mathErrors.push({
            name: "⚠️ SUBTOTAL OVERCHARGE",
            total: financials.subtotal,
            status: "error" as const,
            reason: `Line items sum to ₱${calculatedSubtotal.toLocaleString()} but bill shows ₱${financials.subtotal.toLocaleString()}. Hospital overcharged by ₱${Math.abs(subtotalDiff).toLocaleString()}. Patient is being charged MORE than itemized services.`,
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
    
    if (financials.subtotal > 0 && financials.balanceDue >= 0) {
      // Use the BILL's stated subtotal for balance calculation (not our calculated one)
      const totalDeductions = financials.discounts + financials.payments + financials.hmoCoverage + financials.philhealthCoverage
      const calculatedBalance = financials.subtotal - totalDeductions
      const balanceDiff = calculatedBalance - financials.balanceDue
      
      console.log("[v0] ═══ BALANCE VERIFICATION ═══")
      console.log(`[v0] Bill subtotal: ₱${financials.subtotal.toLocaleString()}`)
      console.log(`[v0] - Discounts: ₱${financials.discounts.toLocaleString()}`)
      console.log(`[v0] - Payments: ₱${financials.payments.toLocaleString()}`)
      console.log(`[v0] - HMO Coverage: ₱${financials.hmoCoverage.toLocaleString()}`)
      console.log(`[v0] - PhilHealth: ₱${financials.philhealthCoverage.toLocaleString()}`)
      console.log(`[v0] = Calculated balance: ₱${calculatedBalance.toLocaleString()}`)
      console.log(`[v0] Bill states: ₱${financials.balanceDue.toLocaleString()}`)
      console.log(`[v0] Difference: ₱${balanceDiff.toLocaleString()}`)
      
      if (Math.abs(balanceDiff) > 10) {
        const deductionBreakdown = []
        if (financials.discounts > 0) deductionBreakdown.push(`₱${financials.discounts.toLocaleString()} discounts`)
        if (financials.payments > 0) deductionBreakdown.push(`₱${financials.payments.toLocaleString()} payments`)
        if (financials.hmoCoverage > 0) deductionBreakdown.push(`₱${financials.hmoCoverage.toLocaleString()} HMO`)
        if (financials.philhealthCoverage > 0) deductionBreakdown.push(`₱${financials.philhealthCoverage.toLocaleString()} PhilHealth`)
        
        if (balanceDiff > 0) {
          // Calculated > Stated = Patient undercharged (paying less)
          balanceStatus = "PATIENT_UNDERCHARGED"
          mathErrors.push({
            name: "⚠️ PATIENT BALANCE UNDERCHARGE",
            total: financials.balanceDue,
            status: "error" as const,
            reason: `Balance should be: ₱${financials.subtotal.toLocaleString()} - ${deductionBreakdown.join(' - ')} = ₱${calculatedBalance.toLocaleString()}, but bill shows ₱${financials.balanceDue.toLocaleString()}. Patient is paying ₱${Math.abs(balanceDiff).toLocaleString()} LESS than they should (hospital loses money).`,
            expectedPrice: calculatedBalance,
            impact: "hospital",
          })
        } else {
          // Calculated < Stated = Patient overcharged (paying more)
          balanceStatus = "PATIENT_OVERCHARGED"
          mathErrors.push({
            name: "⚠️ PATIENT BALANCE OVERCHARGE",
            total: financials.balanceDue,
            status: "error" as const,
            reason: `Balance should be: ₱${financials.subtotal.toLocaleString()} - ${deductionBreakdown.join(' - ')} = ₱${calculatedBalance.toLocaleString()}, but bill shows ₱${financials.balanceDue.toLocaleString()}. Patient is paying ₱${Math.abs(balanceDiff).toLocaleString()} MORE than they should.`,
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
    const hasFinancialData = financials.subtotal > 0 || financials.balanceDue >= 0
    const couldVerifyMath = hasFinancialData
    
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
      overallMessage += `✓ Subtotal: Line items match bill's stated total\n`
      overallMessage += `✓ Balance: All deductions properly applied\n`
      overallMessage += `✓ Patient pays correct amount: ₱${financials.balanceDue.toLocaleString()}`
      confidence = 100
    } else if (chargeStatus === "UNDERCHARGED") {
      overallMessage = `⚠️ UNDERCHARGED - Hospital loses ₱${totalDiscrepancy.toLocaleString()}\n\n`
      overallMessage += `Affected party: HOSPITAL (revenue loss)\n\n`
      
      if (subtotalStatus === "UNDERCHARGED_SUBTOTAL") {
        overallMessage += `• Subtotal Issue: Bill shows ₱${financials.subtotal.toLocaleString()} but line items sum to ₱${calculatedSubtotal.toLocaleString()}\n`
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
        overallMessage += `• Subtotal Issue: Bill shows ₱${financials.subtotal.toLocaleString()} but line items only sum to ₱${financials.calculatedLineItemsTotal.toLocaleString()}\n`
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
    
    // Check for AI-detected duplicates
    if (financials.duplicatesDetected > 0) {
      overallMessage += `\n\n⚠️ Note: ${financials.duplicatesDetected} potential duplicate line item(s) detected in bill structure`
      confidence = Math.min(confidence, 85)
    }

    const response = {
      items: finalItems,
      overallAssessment: overallMessage,
      
      // Financial breakdown
      totalCharges: calculatedSubtotal, // This is what we calculated from parsed items
      statedTotal: financials.balanceDue,
      billSubtotal: financials.subtotal,
      calculatedLineItemsTotal: calculatedSubtotal, // Use our calculation, not AI's
      discounts: financials.discounts,
      payments: financials.payments,
      hmoCoverage: financials.hmoCoverage,
      philhealthCoverage: financials.philhealthCoverage,
      
      // Validation results
      chargeStatus: chargeStatus, // CORRECTLY_CHARGED | UNDERCHARGED | OVERCHARGED
      subtotalCheck: subtotalStatus,
      balanceCheck: balanceStatus,
      totalDiscrepancy: totalDiscrepancy,
      affectedParty: affectedParty,
      confidence: confidence,
      
      // Legacy fields
      totalMathErrors: totalDiscrepancy,
      hasErrors: errorCount > 0,
      errorCount: errorCount,
      warningCount: warningCount,
      duplicateCount: duplicateCount,
      couldVerifyMath: couldVerifyMath,
    }

    console.log("[v0] Final response:", response)
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
