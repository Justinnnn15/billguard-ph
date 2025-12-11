"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { ErrorSummary } from "./error-summary"

interface BillItem {
  name: string
  quantity?: number
  unitPrice?: number
  total: number
  status: "fair" | "warning" | "overcharge" | "error"
  reason: string
  expectedPrice?: number
}

interface AnalysisData {
  items: BillItem[]
  overallAssessment: string
  totalCharges: number
  totalOvercharge: number
  hasErrors: boolean
  errorCount: number
}

interface AnalysisResultsProps {
  data: AnalysisData
  billImage: string | null
  onBackToDashboard: () => void
}

export function AnalysisResults({ data, billImage, onBackToDashboard }: AnalysisResultsProps) {
  const [showEmailModal, setShowEmailModal] = useState(false)

  const getStatusColor = (status: string) => {
    switch (status) {
      case "fair":
        return "bg-green-50 border-green-200 dark:bg-green-950 dark:border-green-800"
      case "warning":
        return "bg-yellow-50 border-yellow-200 dark:bg-yellow-950 dark:border-yellow-800"
      case "overcharge":
      case "error":
        return "bg-red-50 border-red-200 dark:bg-red-950 dark:border-red-800"
      default:
        return "bg-muted"
    }
  }

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "fair":
        return "✓"
      case "warning":
        return "!"
      case "overcharge":
      case "error":
        return "✗"
      default:
        return "•"
    }
  }

  const getStatusTextColor = (status: string) => {
    switch (status) {
      case "fair":
        return "text-green-700 dark:text-green-400"
      case "warning":
        return "text-yellow-700 dark:text-yellow-400"
      case "overcharge":
      case "error":
        return "text-red-700 dark:text-red-400"
      default:
        return "text-foreground"
    }
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="bg-white dark:bg-card border-b border-border sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button
              onClick={onBackToDashboard}
              className="inline-flex items-center justify-center w-10 h-10 rounded-lg hover:bg-muted transition-colors"
              aria-label="Back to dashboard"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            <h1 className="text-2xl font-bold text-foreground">Analysis Results</h1>
          </div>
        </div>
      </div>

      {/* Overall Status Banner */}
      {data.hasErrors ? (
        <div className="bg-red-50 dark:bg-red-950 border-b border-red-200 dark:border-red-800">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
            <div className="flex items-center gap-3">
              <span className="text-2xl">⚠</span>
              <div>
                <p className="font-semibold text-red-900 dark:text-red-200">
                  {data.errorCount} issue{data.errorCount > 1 ? "s" : ""} found in your bill
                </p>
                <p className="text-sm text-red-700 dark:text-red-300">
                  Potential overcharge: ₱{data.totalOvercharge.toLocaleString()}
                </p>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="bg-green-50 dark:bg-green-950 border-b border-green-200 dark:border-green-800">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
            <div className="flex items-center gap-3">
              <span className="text-2xl">✓</span>
              <div>
                <p className="font-semibold text-green-900 dark:text-green-200">
                  No issues detected - Your bill looks good!
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Main Content */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* Left Panel - Original Bill */}
          <div>
            <h2 className="text-lg font-semibold text-foreground mb-4">Your Bill</h2>
            {billImage && (
              <Card className="mb-6 overflow-hidden">
                <img
                  src={billImage || "/placeholder.svg"}
                  alt="Bill preview"
                  className="w-full h-auto object-cover max-h-96"
                />
              </Card>
            )}
            <Card className="p-6">
              <div className="space-y-3">
                {data.items.map((item, idx) => (
                  <div key={idx} className="pb-3 border-b border-border last:border-0 last:pb-0">
                    <div className="flex justify-between items-start mb-1">
                      <p className="font-medium text-foreground text-sm line-clamp-2">{item.name}</p>
                      <p className="font-semibold text-foreground ml-2">₱{item.total.toLocaleString()}</p>
                    </div>
                    {(item.quantity || item.unitPrice) && (
                      <p className="text-xs text-muted-foreground">
                        {item.quantity && `Qty: ${item.quantity}`}
                        {item.quantity && item.unitPrice && " • "}
                        {item.unitPrice && `₱${item.unitPrice.toLocaleString()}/unit`}
                      </p>
                    )}
                  </div>
                ))}
              </div>
              <div className="mt-6 pt-6 border-t border-border">
                <div className="flex justify-between items-center">
                  <p className="text-sm font-medium text-muted-foreground">Total Charges</p>
                  <p className="text-2xl font-bold text-foreground">₱{data.totalCharges.toLocaleString()}</p>
                </div>
              </div>
            </Card>
          </div>

          {/* Right Panel - Analysis Results */}
          <div>
            <h2 className="text-lg font-semibold text-foreground mb-4">BillGuard Analysis</h2>
            <Card className="p-6">
              <div className="space-y-4">
                {data.items.map((item, idx) => (
                  <div key={idx} className={`p-4 rounded-lg border-2 transition-colors ${getStatusColor(item.status)}`}>
                    <div className="flex gap-3">
                      <span className={`text-xl flex-shrink-0 font-bold ${getStatusTextColor(item.status)}`}>
                        {getStatusIcon(item.status)}
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className={`font-semibold text-sm mb-1 ${getStatusTextColor(item.status)}`}>{item.name}</p>
                        <p className="text-sm text-foreground">{item.reason}</p>
                        {item.expectedPrice && (
                          <p className="text-xs text-muted-foreground mt-2">
                            Expected price: ₱{item.expectedPrice.toLocaleString()}
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          </div>
        </div>

        {/* Error Summary or Success Message */}
        {data.hasErrors ? (
          <div className="mt-8">
            <ErrorSummary data={data} onGenerateEmail={() => setShowEmailModal(true)} />
          </div>
        ) : (
          <div className="mt-8 text-center">
            <Card className="p-8 bg-green-50 dark:bg-green-950 border-green-200 dark:border-green-800">
              <p className="text-lg font-semibold text-green-900 dark:text-green-200 mb-4">
                Great news! Your bill appears accurate.
              </p>
              <Button onClick={onBackToDashboard} variant="outline">
                Analyze Another Bill
              </Button>
            </Card>
          </div>
        )}
      </div>

      {/* Email Modal */}
      {showEmailModal && <EmailGenerationModal data={data} onClose={() => setShowEmailModal(false)} />}
    </div>
  )
}

function EmailGenerationModal({
  data,
  onClose,
}: {
  data: AnalysisData
  onClose: () => void
}) {
  const [generatedEmail, setGeneratedEmail] = useState<string | null>(null)
  const [isGenerating, setIsGenerating] = useState(true)
  const [copied, setCopied] = useState(false)

  if (!generatedEmail && isGenerating) {
    const generateEmail = async () => {
      try {
        const response = await fetch("/api/generate-email", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            items: data.items.filter((item) => item.status === "overcharge" || item.status === "error"),
            totalOvercharge: data.totalOvercharge,
          }),
        })

        const result = await response.json()
        setGeneratedEmail(result.email)
      } catch (error) {
        console.error("[v0] Error generating email:", error)
        setGeneratedEmail(
          "Subject: Dispute of Hospital Billing Charges\n\n" +
            "Dear Billing Department,\n\n" +
            "I am writing to dispute certain charges on my hospital bill.\n\n" +
            "I have reviewed my bill and identified the following discrepancies:\n" +
            data.items
              .filter((item) => item.status === "overcharge" || item.status === "error")
              .map((item) => `- ${item.name}: ₱${item.total.toLocaleString()} (${item.reason})`)
              .join("\n") +
            "\n\nTotal overcharge identified: ₱" +
            data.totalOvercharge.toLocaleString() +
            "\n\nI kindly request a review and correction of these charges.\n\nThank you for your attention.\n\nBest regards",
        )
      } finally {
        setIsGenerating(false)
      }
    }

    generateEmail()
  }

  const handleCopy = () => {
    if (generatedEmail) {
      navigator.clipboard.writeText(generatedEmail)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
      <Card className="w-full max-w-2xl max-h-[80vh] overflow-hidden flex flex-col">
        <div className="border-b border-border p-6 flex items-center justify-between">
          <h2 className="text-2xl font-bold text-foreground">Generated Dispute Email</h2>
          <button onClick={onClose} className="w-8 h-8 rounded-lg hover:bg-muted flex items-center justify-center">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-auto p-6">
          {isGenerating ? (
            <div className="flex items-center justify-center h-32">
              <div className="text-center">
                <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary mb-2"></div>
                <p className="text-muted-foreground">Generating email...</p>
              </div>
            </div>
          ) : (
            <textarea
              value={generatedEmail || ""}
              readOnly
              className="w-full h-64 p-4 border border-border rounded-lg bg-muted text-foreground font-mono text-sm resize-none"
            />
          )}
        </div>

        <div className="border-t border-border p-6 flex gap-3">
          <Button onClick={handleCopy} variant="outline" className="flex-1 bg-transparent">
            {copied ? "Copied!" : "Copy to Clipboard"}
          </Button>
          <Button onClick={onClose} className="flex-1">
            Close
          </Button>
        </div>
      </Card>
    </div>
  )
}
