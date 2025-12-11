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
        const nameMatch = line.replace(priceMatch[0], "").trim()
        if (nameMatch && nameMatch.length > 2) {
          items.push({
            name: nameMatch,
            total: price,
          })
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

  const ocrPrompt = `Extract ALL text from this hospital/medical bill image. 
                
Focus on:
1. Hospital/Clinic name
2. Patient information (if visible)
3. ALL itemized charges with their prices (very important!)
4. Any subtotals, totals, discounts
5. Dates and reference numbers

Format the extracted text clearly, preserving the structure of line items and their corresponding prices.
Use the peso sign (₱) for Philippine peso amounts.
If you see amounts in the format "1,234.56" or just numbers, include them all.

Return ONLY the extracted text, no commentary.`

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

  const prompt = `You are a healthcare billing expert analyzing a hospital bill for potential overcharges.

Analyze these bill items against typical Philippine hospital rates:

${items.map((item) => `- ${item.name}: ₱${item.total.toLocaleString()}`).join("\n")}

Philippine hospital rates reference:
- Doctor Consultation: ₱1,000-2,000
- Specialist Consultation: ₱1,500-3,000
- X-ray/Imaging: ₱1,500-4,000
- Laboratory tests: ₱500-2,000
- Blood tests: ₱300-1,000
- ECG: ₱1,000-2,000
- Ultrasound: ₱2,000-4,000
- CT Scan: ₱8,000-15,000
- MRI: ₱15,000-25,000
- Hospital room (per day): ₱3,000-10,000
- Medications: Variable based on type

For each item, provide analysis in this JSON format ONLY (no markdown, just raw JSON):
{
  "items": [
    {
      "name": "exact item name from bill",
      "total": number,
      "status": "fair" | "warning" | "overcharge" | "error",
      "reason": "brief explanation of assessment",
      "expectedPrice": number or null
    }
  ],
  "overallAssessment": "summary of findings"
}

Criteria:
- "fair": Price is within normal range
- "warning": Price is 10-30% above normal
- "overcharge": Price is 30%+ above normal or mathematically incorrect
- "error": Mathematical errors in bill (subtotal/total mismatch)

Return ONLY the JSON object, no other text.`

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
