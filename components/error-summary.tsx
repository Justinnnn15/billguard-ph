"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"

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
  statedTotal?: number | null
  billSubtotal?: number | null
  discounts?: number | null
  payments?: number | null
  hmoCoverage?: number | null
  philhealthCoverage?: number | null
  totalMathErrors: number
  hasErrors: boolean
  errorCount: number
  duplicateCount?: number
  couldVerifyMath?: boolean
}

interface ErrorSummaryProps {
  data: AnalysisData
  onGenerateEmail: () => void
}

export function ErrorSummary({ data, onGenerateEmail }: ErrorSummaryProps) {
  const [isExpanded, setIsExpanded] = useState(false)

  const flaggedItems = data.items.filter((item) => item.status === "overcharge" || item.status === "error")

  return (
    <div className="space-y-4">
      <Card
        className="p-6 cursor-pointer hover:bg-muted/50 transition-colors border-2 border-red-200 dark:border-red-800"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-2xl">⚠️</span>
            <div>
              <p className="font-semibold text-foreground text-lg">Error Summary</p>
              <p className="text-sm text-muted-foreground">
                {flaggedItems.length} issue{flaggedItems.length !== 1 ? "s" : ""} found
              </p>
            </div>
          </div>
          <svg
            className={`w-5 h-5 text-muted-foreground transition-transform ${isExpanded ? "rotate-180" : ""}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
          </svg>
        </div>

        {isExpanded && (
          <div className="mt-6 pt-6 border-t border-border space-y-4">
            <div className="bg-red-50 dark:bg-red-950 p-4 rounded-lg border border-red-200 dark:border-red-800">
              <p className="text-sm text-red-900 dark:text-red-200">
                <span className="font-semibold">Total Billing Errors:</span>
                <span className="ml-2 text-lg font-bold">₱{data.totalMathErrors.toLocaleString()}</span>
              </p>
            </div>

            <div>
              <p className="text-sm font-semibold text-foreground mb-3">Flagged Items:</p>
              <div className="space-y-2">
                {flaggedItems.map((item, idx) => (
                  <div
                    key={idx}
                    className="p-3 bg-red-50 dark:bg-red-950 rounded border border-red-200 dark:border-red-800"
                  >
                    <div className="flex justify-between items-start">
                      <div>
                        <p className="font-medium text-foreground text-sm">{item.name}</p>
                        <p className="text-xs text-muted-foreground mt-1">{item.reason}</p>
                      </div>
                      <p className="font-bold text-red-700 dark:text-red-400 ml-2">₱{item.total.toLocaleString()}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </Card>

      <Button onClick={onGenerateEmail} className="w-full" size="lg">
        Generate Dispute Email
      </Button>
    </div>
  )
}
