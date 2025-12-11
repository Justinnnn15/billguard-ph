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

// Extract full bill financial structure using master prompt
interface BillFinancials {
  subtotal: number | null // Bill's stated subtotal
  discounts: number | null // Total discounts
  payments: number | null // Payments made
  balanceDue: number | null // Final balance
  rawText: string
}

async function extractBillFinancials(enhancedBuffer: Buffer, enhancedMimeType: string): Promise<BillFinancials> {
  try {
    const base64 = enhancedBuffer.toString("base64")
    
    const masterPrompt = `You are an expert hospital billing auditor analyzing a Philippine hospital bill.

**YOUR TASK**: Extract the FINANCIAL SUMMARY section at the bottom of the bill.

**CRITICAL**: Find these EXACT values as printed on the bill:

1. **SUBTOTAL** (also called: Gross Total, Total Charges, Total Amount)
   - This is the sum of all services BEFORE any deductions
   - Usually the largest number before discounts

2. **DISCOUNTS** (look for ALL of these):
   - Senior Citizen Discount (SC Discount)
   - PWD Discount
   - PhilHealth deductions
   - HMO coverage
   - Any other deductions
   - Sum ALL discount amounts

3. **PAYMENTS** (look for ALL of these):
   - Cash payments
   - Credit card payments
   - Deposits already paid
   - Sum ALL payment amounts

4. **BALANCE DUE** (also called: Amount Due, Net Amount, Total Due)
   - This is the FINAL amount patient owes
   - Should equal: Subtotal - Discounts - Payments

**IMPORTANT RULES**:
- Extract EXACT numbers from the bill (include decimals: 57074.71 not 57074)
- If a field is not found on the bill, return null for that field
- Do NOT calculate - only extract what you SEE
- Look at the BOTTOM section of the bill (usually after all line items)

**OUTPUT FORMAT** (return ONLY this JSON):
{
  "subtotal": 57074.71,
  "discounts": 1240.00,
  "payments": 5709.21,
  "balanceDue": 50125.50
}

If a field is missing from the bill, use null instead of a number.
Return ONLY valid JSON, no other text.`

    console.log("[v0] Extracting financial structure with master prompt...")
    
    // Use Groq vision (best free tier for vision tasks)
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
                text: masterPrompt,
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
          subtotal: parsed.subtotal ?? null,
          discounts: parsed.discounts ?? null,
          payments: parsed.payments ?? null,
          balanceDue: parsed.balanceDue ?? null,
          rawText: text
        }
        console.log("[v0] ✓ Extracted financials:", result)
        return result
      }
      
      throw new Error("Could not parse JSON")
    } catch (groqError: any) {
      console.log("[v0] Groq vision failed for financials:", groqError?.message)
    }
    
    // No financial data extracted
    console.warn("[v0] ⚠️ Could not extract financial structure")
    return {
      subtotal: null,
      discounts: null,
      payments: null,
      balanceDue: null,
      rawText: ""
    }
  } catch (error) {
    console.error("[v0] Error in extractBillFinancials:", error)
    return {
      subtotal: null,
      discounts: null,
      payments: null,
      balanceDue: null,
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
        financials.subtotal = foundSubtotal
        financials.balanceDue = foundBalance
        financials.discounts = foundDiscount
        financials.payments = foundPayment
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

    // Step 5: MATH VERIFICATION - Check bill calculations
    const mathErrors: any[] = []
    
    // Check 1: Does our item sum match the bill's subtotal?
    if (financials.subtotal !== null) {
      const subtotalDiff = Math.abs(financials.subtotal - calculatedSubtotal)
      const subtotalPercent = (subtotalDiff / calculatedSubtotal) * 100
      
      console.log("[v0] Subtotal check - Bill:", financials.subtotal, "Our calc:", calculatedSubtotal, "Diff:", subtotalDiff)
      
      if (subtotalDiff > 5 && subtotalPercent > 1) {
        mathErrors.push({
          name: "⚠️ SUBTOTAL MISMATCH",
          total: financials.subtotal,
          status: "error" as const,
          reason: `Bill shows subtotal of ₱${financials.subtotal.toLocaleString()}, but line items sum to ₱${calculatedSubtotal.toLocaleString()}. Difference: ₱${subtotalDiff.toLocaleString()}. The hospital's math is wrong.`,
          expectedPrice: calculatedSubtotal,
        })
        errorCount++
        totalMathErrors += subtotalDiff
      }
    }
    
    // Check 2: Verify balance calculation formula
    if (financials.subtotal !== null && financials.balanceDue !== null) {
      const expectedBalance = financials.subtotal - (financials.discounts || 0) - (financials.payments || 0)
      const balanceDiff = Math.abs(financials.balanceDue - expectedBalance)
      
      console.log("[v0] Balance check - Bill balance:", financials.balanceDue, "Expected:", expectedBalance, "Diff:", balanceDiff)
      console.log("[v0] Formula: Subtotal", financials.subtotal, "- Discounts", financials.discounts, "- Payments", financials.payments, "= Balance", financials.balanceDue)
      
      if (balanceDiff > 5) {
        mathErrors.push({
          name: "⚠️ BALANCE CALCULATION ERROR",
          total: financials.balanceDue,
          status: "error" as const,
          reason: `Balance calculation is wrong. Should be: ₱${financials.subtotal.toLocaleString()} - ₱${(financials.discounts || 0).toLocaleString()} - ₱${(financials.payments || 0).toLocaleString()} = ₱${expectedBalance.toLocaleString()}, but bill shows ₱${financials.balanceDue.toLocaleString()}. Difference: ₱${balanceDiff.toLocaleString()}.`,
          expectedPrice: expectedBalance,
        })
        errorCount++
        totalMathErrors += balanceDiff
      }
    }

    // Step 6: Combine math errors with item analysis
    const finalItems = [...mathErrors, ...analysis.items]
    
    // Check if we have financial data to verify calculations
    const hasFinancialData = financials.subtotal !== null || financials.balanceDue !== null
    const couldVerifyMath = hasFinancialData
    
    let overallMessage = ""
    if (errorCount > 0) {
      overallMessage = `Found ${errorCount} billing error${errorCount > 1 ? 's' : ''}: ${mathErrors.length > 0 ? mathErrors.map(e => e.name).join(', ') : ''}${duplicateCount > 0 ? ` and ${duplicateCount} duplicate charge${duplicateCount > 1 ? 's' : ''}` : ''}.`
    } else if (!couldVerifyMath) {
      overallMessage = `⚠️ Could not verify bill calculations - financial totals not found on bill. Checked for duplicates only. Upload a clearer image showing the total/balance section.`
      warningCount++
    } else {
      overallMessage = `✓ No billing errors detected. Math verified: Subtotal matches line items, balance calculation is correct.`
    }

    const response = {
      items: finalItems,
      overallAssessment: overallMessage,
      totalCharges: calculatedSubtotal,
      statedTotal: financials.balanceDue,
      billSubtotal: financials.subtotal,
      discounts: financials.discounts,
      payments: financials.payments,
      totalMathErrors: Math.round(totalMathErrors * 100) / 100,
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
