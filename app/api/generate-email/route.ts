import { type NextRequest, NextResponse } from "next/server"
import { generateText } from "ai"
import { createGoogleGenerativeAI } from "@ai-sdk/google"

const google = createGoogleGenerativeAI({
  apiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY,
})

export async function POST(request: NextRequest) {
  let requestData: any = null
  
  try {
    requestData = await request.json()
    const { items, totalOvercharge } = requestData

    if (!items || items.length === 0) {
      throw new Error("No items provided")
    }

    const itemsList = items
      .map((item: any) => `- ${item.name}: ₱${item.total.toLocaleString()} (${item.reason})`)
      .join("\n")

    const prompt = `Write a professional, polite but firm email to a hospital billing department disputing these charges:

${itemsList}

Total identified overcharge: ₱${totalOvercharge.toLocaleString()}

Email requirements:
- Include appropriate subject line
- Address the billing department professionally
- List each disputed item with amount and reason
- Request review and correction
- Include specific amount of overcharge
- Include call to action for resolution
- Professional closing

Format as complete email ready to send. Do not include any markdown or code blocks.`

    const { text } = await generateText({
      model: google("gemini-2.0-flash-exp"),
      prompt,
    })

    return NextResponse.json({ email: text })
  } catch (error) {
    console.error("Error generating email:", error)

    // Use cached request data if available
    if (requestData) {
      const { items = [], totalOvercharge = 0 } = requestData
      const fallbackEmail = `Subject: Dispute of Hospital Billing Charges

Dear Billing Department,

I am writing to formally dispute certain charges on my recent hospital bill. After careful review, I have identified the following discrepancies:

${items.map((item: any) => `- ${item.name}: ₱${item.total.toLocaleString()} - ${item.reason}`).join("\n")}

Based on my analysis, the total overcharge amounts to ₱${totalOvercharge.toLocaleString()}. I kindly request a thorough review of these charges and correction of the bill accordingly.

Please contact me at your earliest convenience to discuss this matter and provide an explanation or revised bill.

Thank you for your attention to this matter.

Respectfully,
[Your Name]`

      return NextResponse.json({ email: fallbackEmail })
    }
    
    return NextResponse.json(
      { error: "Failed to generate email" },
      { status: 500 }
    )
  }
}
