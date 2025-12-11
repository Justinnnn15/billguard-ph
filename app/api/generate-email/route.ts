import { type NextRequest, NextResponse } from "next/server"
import { generateText } from "ai"

export async function POST(request: NextRequest) {
  try {
    const { items, totalOvercharge } = await request.json()

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
      model: "google/gemini-2.0-flash",
      prompt,
    })

    return NextResponse.json({ email: text })
  } catch (error) {
    console.error("[v0] Error generating email:", error)

    const { items, totalOvercharge } = await request.json()
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
}
