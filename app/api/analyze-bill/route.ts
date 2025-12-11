import { type NextRequest, NextResponse } from "next/server"
import { generateText } from "ai"
import { google } from "@ai-sdk/google"
import { createGroq } from "@ai-sdk/groq"

// Initialize AI providers
const groq = createGroq({ apiKey: process.env.GROQ_API_KEY })

// Primary: Groq (better free tier - 30 req/min, 14,400 req/day)
// Llama 4 Scout for vision (current supported model)
const groqVisionModel = groq("meta-llama/llama-4-scout-17b-16e-instruct")
const groqTextModel = groq("llama-3.3-70b-versatile")

// Fallback: Google Gemini
const geminiModel = google("gemini-2.0-flash-exp")

// Keywords that indicate non-billable items (to be excluded)
const excludeKeywords = [
  'tel', 'telephone', 'phone', 'fax', 'email', 'address', 'city', 'street',
  'admission no', 'admission date', 'discharge', 'patient name', 'age:',
  'room no', 'case rate', 'run date', 'datetime', 'page', 'total:',
  'subtotal', 'grand total', 'amount due', 'balance', 'edsa', 'avenue',
  'blk', 'block', 'brgy', 'barangay', 'mandaluyong', 'manila', 'quezon',
  'makati', 'pasig', 'taguig', 'cavite', 'laguna', 'cebu', 'davao'
]

// Keywords that indicate billable medical services
const medicalKeywords = [
  'room', 'emergency', 'laboratory', 'lab', 'pharmacy', 'medicine', 'medication',
  'x-ray', 'xray', 'ct scan', 'mri', 'ultrasound', 'ecg', 'ekg', 'eeg',
  'operating', 'surgery', 'surgical', 'anesthesia', 'professional fee',
  'doctor', 'physician', 'surgeon', 'nursing', 'icu', 'nicu', 'recovery',
  'respiratory', 'dialysis', 'chemotherapy', 'radiation', 'therapy',
  'supplies', 'sterile', 'central', 'housekeeping', 'ambulance',
  'blood', 'transfusion', 'infusion', 'injection', 'iv', 'oxygen',
  'heart station', 'cardio', 'pulmo', 'neuro', 'gastro', 'ortho',
  'ent', 'optha', 'derma', 'ob-gyn', 'pedia', 'internal medicine',
  'floor', 'ward', 'private', 'semi-private', 'suite', 'charges'
]

// Parse bill text using simple regex and structured extraction
function parseBillItems(
  billText: string,
): Array<{ name: string; quantity?: number; unitPrice?: number; total: number }> {
  const items: Array<{ name: string; quantity?: number; unitPrice?: number; total: number }> = []

  // Split by lines
  const lines = billText.split("\n").filter((line) => line.trim())

  // Simple parser to extract item name and price
  for (const line of lines) {
    // Look for patterns like "Item Name: 1000" or "Item Name 1000" or "₱1000"
    const priceMatch = line.match(/₱?\s*(\d+(?:,\d{3})*(?:\.\d{2})?)/)
    if (priceMatch) {
      const price = Number.parseFloat(priceMatch[1].replace(/,/g, ""))
      if (price > 0 && price < 500000) {
        // Reasonable hospital charge range
        let nameMatch = line.replace(priceMatch[0], "").trim()
        
        // Clean up the name - remove asterisks and special characters
        nameMatch = nameMatch.replace(/\*+/g, '').replace(/[:]+$/, '').trim()
        
        if (nameMatch && nameMatch.length > 2) {
          const lowerName = nameMatch.toLowerCase()
          
          // Check if this looks like a non-billable item
          const isExcluded = excludeKeywords.some(keyword => lowerName.includes(keyword))
          
          // Check if this looks like a medical service
          const isMedical = medicalKeywords.some(keyword => lowerName.includes(keyword))
          
          // Only include if it's medical OR (not excluded AND price > 100)
          // Small amounts like ₱1, ₱2, ₱10 are likely reference numbers
          if (isMedical || (!isExcluded && price > 100)) {
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
  const base64 = Buffer.from(buffer).toString("base64")
  const mimeType = file.type || "image/jpeg"

  if (!file.type.startsWith("image/") && file.type !== "application/pdf" && !file.name.endsWith(".pdf")) {
    return "Unable to extract text from file"
  }

  const ocrPrompt = `You are analyzing a hospital/medical bill image. Extract ONLY the billable charges/services and their amounts.

EXTRACT ONLY these types of items:
- Medical services (Emergency Room, Operating Room, etc.)
- Laboratory tests and fees
- Diagnostic services (X-Ray, CT Scan, MRI, Ultrasound, etc.)
- Pharmacy/Medication charges
- Room charges and accommodation
- Professional fees (Doctor fees, Surgeon fees, etc.)
- Supplies and materials
- Nursing care
- Any other medical service with a price

DO NOT EXTRACT:
- Hospital name, address, or contact information
- Patient name, age, or personal details
- Admission numbers or reference numbers
- Dates and timestamps
- Page numbers
- Headers and footers
- Any text without an associated price/charge

Format each item as: "Item Name: ₱Amount"
Example:
Emergency Room: ₱7,753
Laboratory: ₱39,801
X-Ray: ₱4,840

Return ONLY the list of billable items with their prices, nothing else. Remove any asterisks (*) or special formatting characters from item names.`

  // Try Groq Vision first (better free tier)
  try {
    console.log("[v0] Trying Groq Vision for OCR...")
    const { text } = await generateText({
      model: groqVisionModel,
      maxRetries: 1,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              image: `data:${mimeType};base64,${base64}`,
            },
            {
              type: "text",
              text: ocrPrompt,
            },
          ],
        },
      ],
    })

    console.log("[v0] Groq OCR extracted text:", text)
    return text
  } catch (groqError: any) {
    console.log("[v0] Groq failed, trying Google Gemini fallback...", groqError?.message)
    
    // Fallback to Google Gemini
    try {
      const { text } = await generateText({
        model: geminiModel,
        maxRetries: 1,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image",
                image: `data:${mimeType};base64,${base64}`,
              },
              {
                type: "text",
                text: ocrPrompt,
              },
            ],
          },
        ],
      })

      console.log("[v0] Gemini OCR extracted text:", text)
      return text
    } catch (geminiError: any) {
      console.error("[v0] Both AI providers failed:", geminiError?.message)
      
      if (geminiError?.message?.includes("quota") || geminiError?.lastError?.statusCode === 429) {
        throw new Error("All AI services are rate limited. Please wait a moment and try again.")
      }
      
      throw new Error("Failed to extract text from file. Please ensure the image is clear and try again.")
    }
  }
}

async function analyzeBillWithAI(billText: string) {
  const items = parseBillItems(billText)

  const prompt = `You are a healthcare billing expert analyzing a Philippine hospital bill for potential overcharges.

IMPORTANT: Only analyze actual medical charges/services. Ignore any items that are:
- Phone numbers, addresses, or contact info
- Patient details (name, age, admission numbers)
- Dates, times, or reference numbers
- Headers, footers, or page numbers

Analyze ONLY these bill items (medical services with prices):

${items.map((item) => `- ${item.name.replace(/\*+/g, '').trim()}: ₱${item.total.toLocaleString()}`).join("\n")}

Philippine hospital rates reference (2024):
- Emergency Room: ₱5,000-15,000
- Operating Room: ₱30,000-150,000 (depends on procedure complexity)
- Laboratory tests: ₱5,000-50,000 (depends on number of tests)
- X-ray: ₱1,500-5,000
- CT Scan: ₱8,000-25,000
- MRI: ₱15,000-35,000
- Ultrasound: ₱2,000-5,000
- Pharmacy/Medications: ₱10,000-100,000+ (highly variable)
- Hospital Room (per day): ₱3,000-15,000
- ICU (per day): ₱15,000-50,000
- Professional Fees: ₱5,000-50,000
- Respiratory Care: ₱5,000-30,000
- Central Sterile Supply: ₱3,000-15,000
- Housekeeping: ₱500-2,000

For each VALID medical charge, provide analysis in this JSON format ONLY:
{
  "items": [
    {
      "name": "Clean item name without asterisks or special characters",
      "total": number,
      "status": "fair" | "warning" | "overcharge",
      "reason": "Brief 1-sentence explanation",
      "expectedPrice": number or null
    }
  ],
  "overallAssessment": "Summary: X items analyzed, Y potential overcharges found totaling ₱Z"
}

Status criteria:
- "fair": Price is within or below normal range
- "warning": Price is 10-50% above normal range
- "overcharge": Price is 50%+ above normal range

Return ONLY valid JSON, no markdown or extra text.`

  // Try Groq first (better free tier)
  try {
    console.log("[v0] Trying Groq for analysis...")
    const { text } = await generateText({
      model: groqTextModel,
      maxRetries: 1,
      prompt,
    })

    console.log("[v0] Groq analysis response:", text)
    return parseAnalysisResponse(text, items)
  } catch (groqError: any) {
    console.log("[v0] Groq analysis failed, trying Gemini fallback...", groqError?.message)
    
    // Fallback to Google Gemini
    try {
      const { text } = await generateText({
        model: geminiModel,
        maxRetries: 1,
        prompt,
      })

      console.log("[v0] Gemini analysis response:", text)
      return parseAnalysisResponse(text, items)
    } catch (geminiError: any) {
      console.error("[v0] Both AI providers failed for analysis:", geminiError?.message)
      
      // Return basic analysis as last resort
      return {
        items: items.map((item) => ({
          name: item.name,
          total: item.total,
          status: item.total > 5000 ? "warning" : "fair",
          reason: item.total > 5000 ? "Price is above average for this service" : "Price appears reasonable",
          expectedPrice: item.total > 5000 ? item.total * 0.8 : null,
        })),
        overallAssessment: "Basic bill analysis complete (AI services unavailable)",
      }
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

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData()
    const file = formData.get("file") as File

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 })
    }

    console.log("[v0] Processing file:", file.name, file.type)

    // Extract text from image/PDF
    const billText = await extractTextFromFile(file)
    console.log("[v0] Extracted text:", billText)

    // Analyze with AI (Groq primary, Gemini fallback)
    const analysis = await analyzeBillWithAI(billText)

    // Calculate totals and errors
    const totalCharges = analysis.items.reduce((sum: number, item: any) => sum + (item.total || 0), 0)
    const totalOvercharge = analysis.items
      .filter((item: any) => item.status === "overcharge" || item.status === "error")
      .reduce((sum: number, item: any) => {
        if (item.expectedPrice) {
          return sum + Math.max(0, item.total - item.expectedPrice)
        }
        return sum + item.total * 0.2
      }, 0)

    const errorCount = analysis.items.filter(
      (item: any) => item.status === "overcharge" || item.status === "error",
    ).length

    const response = {
      items: analysis.items,
      overallAssessment: analysis.overallAssessment,
      totalCharges,
      totalOvercharge: Math.round(totalOvercharge),
      hasErrors: errorCount > 0,
      errorCount,
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
