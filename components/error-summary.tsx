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
  
  // Determine discrepancy direction
  const calculatedTotal = data.totalCharges
  const statedTotal = data.billSubtotal || data.statedTotal || 0
  const difference = Math.abs(calculatedTotal - statedTotal)
  const isOvercharge = calculatedTotal < statedTotal
  const isUndercharge = calculatedTotal > statedTotal
  const percentageDiff = statedTotal > 0 ? (difference / statedTotal) * 100 : 0
  const isCritical = percentageDiff > 20
  const isMinor = difference < 10

  return (
    <div className="space-y-4">
      <Card
        className="p-6 cursor-pointer hover:bg-muted/50 transition-colors border-2 border-yellow-200 dark:border-yellow-800"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-2xl">⚠️</span>
            <div>
              <p className="font-semibold text-foreground text-lg">
                Billing Discrepancy Detected: ₱{data.totalMathErrors.toLocaleString()}
              </p>
              <p className="text-sm text-muted-foreground">
                {flaggedItems.length} issue{flaggedItems.length !== 1 ? "s" : ""} found • Tap for analysis
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
            {/* Calculation Breakdown */}
            <div className="bg-muted p-4 rounded-lg border border-border font-mono text-sm">
              <p className="font-semibold text-foreground mb-2">CALCULATION BREAKDOWN:</p>
              <div className="space-y-1 text-muted-foreground">
                <div className="flex justify-between">
                  <span>Line Items Total:</span>
                  <span className="font-semibold">₱{calculatedTotal.toLocaleString()}</span>
                </div>
                <div className="flex justify-between">
                  <span>Bill's Subtotal:</span>
                  <span className="font-semibold">₱{statedTotal.toLocaleString()}</span>
                </div>
                <div className="flex justify-between pt-2 border-t border-border text-foreground">
                  <span>Difference:</span>
                  <span className="font-bold">₱{difference.toLocaleString()}</span>
                </div>
              </div>
            </div>

            {/* Multi-Perspective Analysis */}
            <div className="space-y-3">
              <p className="font-semibold text-foreground">ANALYSIS:</p>
              
              {/* Patient Perspective */}
              <div className="bg-blue-50 dark:bg-blue-950 p-4 rounded-lg border border-blue-200 dark:border-blue-800">
                <p className="text-sm font-semibold text-blue-900 dark:text-blue-200 mb-1">
                  👤 Patient Perspective:
                </p>
                <p className="text-sm text-blue-700 dark:text-blue-300">
                  {isOvercharge
                    ? `You were charged ₱${difference.toLocaleString()} MORE than itemized services`
                    : isUndercharge
                      ? `You were charged ₱${difference.toLocaleString()} LESS than itemized services`
                      : "Charges match itemized services"}
                </p>
              </div>

              {/* Hospital Perspective */}
              <div className="bg-green-50 dark:bg-green-950 p-4 rounded-lg border border-green-200 dark:border-green-800">
                <p className="text-sm font-semibold text-green-900 dark:text-green-200 mb-1">
                  🏥 Hospital Perspective:
                </p>
                <p className="text-sm text-green-700 dark:text-green-300">
                  {isOvercharge
                    ? "Billing error requiring correction"
                    : isUndercharge
                      ? `Potential revenue loss of ₱${difference.toLocaleString()}`
                      : "Billing is accurate"}
                </p>
              </div>

              {/* Likely Causes */}
              <div className="bg-yellow-50 dark:bg-yellow-950 p-4 rounded-lg border border-yellow-200 dark:border-yellow-800">
                <p className="text-sm font-semibold text-yellow-900 dark:text-yellow-200 mb-2">
                  ⚠️ Likely Causes:
                </p>
                <ul className="text-sm text-yellow-700 dark:text-yellow-300 space-y-1 list-disc list-inside">
                  {isOvercharge ? (
                    <>
                      <li>Calculation error in total</li>
                      <li>Duplicate charges counted</li>
                      <li>Missing line item credits</li>
                    </>
                  ) : (
                    <>
                      <li>Applied discount not documented</li>
                      <li>Calculation error in subtotal</li>
                      <li>Courtesy adjustment without note</li>
                    </>
                  )}
                </ul>
              </div>
            </div>

            {/* Severity Warning */}
            {isCritical && (
              <div className="bg-red-50 dark:bg-red-950 p-4 rounded-lg border-2 border-red-500 dark:border-red-600">
                <p className="text-sm font-bold text-red-900 dark:text-red-200">
                  ⚠️ CRITICAL: ₱{difference.toLocaleString()} difference ({percentageDiff.toFixed(1)}% of bill)
                </p>
                <p className="text-xs text-red-700 dark:text-red-300 mt-1">
                  Recommend immediate in-person review with billing department. This may indicate systemic error or missing pages.
                </p>
              </div>
            )}

            {isMinor && (
              <div className="bg-gray-50 dark:bg-gray-900 p-4 rounded-lg border border-gray-300 dark:border-gray-700">
                <p className="text-sm text-gray-700 dark:text-gray-300">
                  <strong>Note:</strong> Difference of ₱{difference.toLocaleString()} may be due to rounding. Consider accepting if within acceptable tolerance.
                </p>
              </div>
            )}

            {/* Recommended Action */}
            <div className="bg-blue-50 dark:bg-blue-950 p-4 rounded-lg border border-blue-200 dark:border-blue-800">
              <p className="text-sm font-semibold text-blue-900 dark:text-blue-200 mb-2">
                RECOMMENDED ACTION:
              </p>
              <ul className="text-sm text-blue-700 dark:text-blue-300 space-y-1">
                <li>✓ Request itemized verification</li>
                <li>✓ Review charges against medical records</li>
                <li>✓ Resolve collaboratively with billing department</li>
              </ul>
            </div>

            {/* Flagged Items */}
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
        📧 Generate Communication Email
      </Button>
    </div>
  )
}
