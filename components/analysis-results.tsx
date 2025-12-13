"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { ErrorSummary } from "./error-summary"

interface DeductionBreakdownItem {
  type: string
  amount: number
  description: string
  hasDocumentation: boolean
  documentationType?: string
  documentationValue?: string
  isVerified: boolean
  verificationIssue?: string
}

interface DeductionValidation {
  totalDeductions: number
  verifiedDeductions: number
  unverifiedDeductions: number
  coverageStatus: 'confirmed' | 'unconfirmed' | 'no_coverage' | 'unknown'
  validationPassed: boolean
  issues: string[]
  deductionBreakdown: DeductionBreakdownItem[]
}

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
  // NEW: Deduction validation (per improvement guidelines)
  deductionValidation?: DeductionValidation
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
                  {data.errorCount} billing error{data.errorCount > 1 ? "s" : ""} detected
                </p>
                <p className="text-sm text-red-700 dark:text-red-300">
                  {data.duplicateCount ? `${data.duplicateCount} duplicate${data.duplicateCount > 1 ? 's' : ''} • ` : ''}Math errors: ₱{data.totalMathErrors.toLocaleString()}
                </p>
              </div>
            </div>
          </div>
        </div>
      ) : data.couldVerifyMath === false ? (
        <div className="bg-yellow-50 dark:bg-yellow-950 border-b border-yellow-200 dark:border-yellow-800">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
            <div className="flex items-center gap-3">
              <span className="text-2xl">⚠️</span>
              <div>
                <p className="font-semibold text-yellow-900 dark:text-yellow-200">
                  Could not verify calculations
                </p>
                <p className="text-sm text-yellow-700 dark:text-yellow-300">
                  Bill totals not detected. Only checked for duplicates. Try uploading a clearer image.
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
                  Math verified - No errors detected!
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
              <div className="mt-6 pt-6 border-t border-border space-y-3">
                {/* Our Calculated Subtotal */}
                <div className="flex justify-between items-center">
                  <p className="text-sm font-medium text-muted-foreground">Our Calculated Subtotal</p>
                  <p className="text-2xl font-bold text-foreground">₱{data.totalCharges.toLocaleString()}</p>
                </div>
                
                {/* Bill's Subtotal */}
                {data.billSubtotal !== null && data.billSubtotal !== undefined && (
                  <>
                    <div className="flex justify-between items-center">
                      <p className="text-sm font-medium text-muted-foreground">Bill's Subtotal</p>
                      <p className={`text-xl font-bold ${Math.abs((data.billSubtotal || 0) - data.totalCharges) > 5 ? 'text-red-600' : 'text-foreground'}`}>
                        ₱{data.billSubtotal.toLocaleString()}
                      </p>
                    </div>
                    {Math.abs((data.billSubtotal || 0) - data.totalCharges) > 5 && (
                      <div className="p-2 bg-red-50 dark:bg-red-950 rounded border border-red-200 dark:border-red-800">
                        <p className="text-xs font-semibold text-red-700 dark:text-red-400">
                          ⚠️ SUBTOTAL ERROR: ₱{Math.abs((data.billSubtotal || 0) - data.totalCharges).toLocaleString()} difference
                        </p>
                      </div>
                    )}
                  </>
                )}
                
                {/* Discounts */}
                {data.discounts !== null && data.discounts !== undefined && data.discounts > 0 && (
                  <div className="flex justify-between items-center text-sm">
                    <div className="flex items-center gap-1">
                      <p className="text-green-600 dark:text-green-400">Less: Discounts</p>
                      {data.deductionValidation && !data.deductionValidation.validationPassed && (
                        <span className="text-yellow-500" title="Requires verification">⚠️</span>
                      )}
                    </div>
                    <p className="font-semibold text-green-600 dark:text-green-400">
                      -₱{data.discounts.toLocaleString()}
                    </p>
                  </div>
                )}
                
                {/* HMO/Company Coverage */}
                {data.hmoCoverage !== null && data.hmoCoverage !== undefined && data.hmoCoverage > 0 && (
                  <div className="flex justify-between items-center text-sm">
                    <div className="flex items-center gap-1">
                      <p className="text-blue-600 dark:text-blue-400">Less: HMO/Company Coverage</p>
                      {data.deductionValidation?.coverageStatus === 'unconfirmed' && (
                        <span className="text-yellow-500" title="Coverage not verified">⚠️</span>
                      )}
                    </div>
                    <p className="font-semibold text-blue-600 dark:text-blue-400">
                      -₱{data.hmoCoverage.toLocaleString()}
                    </p>
                  </div>
                )}
                
                {/* PhilHealth Coverage */}
                {data.philhealthCoverage !== null && data.philhealthCoverage !== undefined && data.philhealthCoverage > 0 && (
                  <div className="flex justify-between items-center text-sm">
                    <div className="flex items-center gap-1">
                      <p className="text-blue-600 dark:text-blue-400">Less: PhilHealth Coverage</p>
                      {data.deductionValidation?.coverageStatus === 'unconfirmed' && (
                        <span className="text-yellow-500" title="Coverage not verified">⚠️</span>
                      )}
                    </div>
                    <p className="font-semibold text-blue-600 dark:text-blue-400">
                      -₱{data.philhealthCoverage.toLocaleString()}
                    </p>
                  </div>
                )}
                
                {/* Payments */}
                {data.payments !== null && data.payments !== undefined && data.payments > 0 && (
                  <div className="flex justify-between items-center text-sm">
                    <div className="flex items-center gap-1">
                      <p className="text-green-600 dark:text-green-400">Less: Payments Made</p>
                      {data.deductionValidation && !data.deductionValidation.validationPassed && (
                        <span className="text-yellow-500" title="Requires verification">⚠️</span>
                      )}
                    </div>
                    <p className="font-semibold text-green-600 dark:text-green-400">
                      -₱{data.payments.toLocaleString()}
                    </p>
                  </div>
                )}
                
                {/* Balance Due */}
                {data.statedTotal !== null && data.statedTotal !== undefined && (
                  <div className="flex justify-between items-center pt-2 border-t">
                    <p className="text-sm font-medium text-foreground">Balance Due</p>
                    <p className="text-xl font-bold text-foreground">
                      ₱{data.statedTotal.toLocaleString()}
                    </p>
                  </div>
                )}
                
                {/* Math Errors Amount */}
                {data.totalMathErrors > 0 && (
                  <div className="pt-2 border-t border-red-200">
                    <div className="flex justify-between items-center">
                      <p className="text-sm font-medium text-red-600 dark:text-red-400">Billing Errors Amount</p>
                      <p className="text-lg font-bold text-red-600 dark:text-red-400">
                        ₱{data.totalMathErrors.toLocaleString()}
                      </p>
                    </div>
                  </div>
                )}
                
                {/* Deduction Validation Status */}
                {data.deductionValidation && data.deductionValidation.totalDeductions > 0 && (
                  <div className="pt-3 mt-3 border-t border-border">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-sm font-semibold text-foreground">Deduction Verification</span>
                      {data.deductionValidation.validationPassed ? (
                        <span className="px-2 py-0.5 text-xs bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-300 rounded-full">
                          ✓ All Verified
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 text-xs bg-yellow-100 dark:bg-yellow-900 text-yellow-700 dark:text-yellow-300 rounded-full">
                          ⚠️ Requires Review
                        </span>
                      )}
                    </div>
                    
                    {/* Deduction breakdown */}
                    {data.deductionValidation.deductionBreakdown && data.deductionValidation.deductionBreakdown.length > 0 && (
                      <div className="space-y-2 text-xs">
                        {data.deductionValidation.deductionBreakdown.map((deduction, idx) => (
                          <div key={idx} className={`p-2 rounded ${deduction.isVerified ? 'bg-green-50 dark:bg-green-950' : 'bg-yellow-50 dark:bg-yellow-950'}`}>
                            <div className="flex justify-between items-start">
                              <div className="flex-1">
                                <p className="font-medium">{deduction.description}</p>
                                <p className="text-muted-foreground">
                                  Type: {deduction.type.toUpperCase()}
                                  {deduction.hasDocumentation && deduction.documentationValue && (
                                    <span> • {deduction.documentationValue}</span>
                                  )}
                                </p>
                                {!deduction.isVerified && deduction.verificationIssue && (
                                  <p className="text-yellow-600 dark:text-yellow-400 mt-1">
                                    ⚠️ {deduction.verificationIssue}
                                  </p>
                                )}
                              </div>
                              <p className="font-semibold ml-2">₱{deduction.amount.toLocaleString()}</p>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                    
                    {/* Coverage status warning */}
                    {data.deductionValidation.coverageStatus === 'unconfirmed' && (
                      <div className="mt-2 p-2 bg-yellow-50 dark:bg-yellow-950 border border-yellow-200 dark:border-yellow-800 rounded text-xs">
                        <p className="font-semibold text-yellow-700 dark:text-yellow-300">
                          ⚠️ Coverage Not Verified
                        </p>
                        <p className="text-yellow-600 dark:text-yellow-400 mt-1">
                          HMO/Insurance coverage is applied but no policy number or LOA is visible. 
                          Default assumption: Patient pays full amount unless coverage is proven.
                        </p>
                      </div>
                    )}
                    
                    {/* Unverified deductions warning */}
                    {data.deductionValidation.unverifiedDeductions > 0 && (
                      <div className="mt-2 p-2 bg-orange-50 dark:bg-orange-950 border border-orange-200 dark:border-orange-800 rounded text-xs">
                        <p className="font-semibold text-orange-700 dark:text-orange-300">
                          ₱{data.deductionValidation.unverifiedDeductions.toLocaleString()} in unverified deductions
                        </p>
                        <p className="text-orange-600 dark:text-orange-400 mt-1">
                          Request itemized breakdown with supporting documents before accepting these deductions.
                        </p>
                      </div>
                    )}
                  </div>
                )}
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
                ✓ No billing errors detected. The math checks out!
              </p>
              <p className="text-sm text-green-700 dark:text-green-300 mb-4">
                All line items are unique and calculations are correct.
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
  const [selectedTemplate, setSelectedTemplate] = useState<string | null>(null)
  const [generatedEmail, setGeneratedEmail] = useState<string | null>(null)
  const [isGenerating, setIsGenerating] = useState(false)
  const [copied, setCopied] = useState(false)

  // Determine discrepancy direction
  const calculatedTotal = data.totalCharges
  const statedTotal = data.billSubtotal || data.statedTotal || 0
  const difference = Math.abs(calculatedTotal - statedTotal)
  const isOvercharge = calculatedTotal < statedTotal // Calculated < Stated = Hospital charged MORE
  const isUndercharge = calculatedTotal > statedTotal // Calculated > Stated = Hospital charged LESS

  const handleGenerateEmail = async (templateType: string) => {
    setSelectedTemplate(templateType)
    setIsGenerating(true)
    
    try {
      const errorItems = data.items.filter((item) => item.status === "overcharge" || item.status === "error")
      const totalDiscrepancy = data.totalMathErrors || 0
      
      const response = await fetch("/api/generate-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: errorItems,
          totalOvercharge: totalDiscrepancy,
          templateType: templateType,
          discrepancyDirection: isOvercharge ? "overcharge" : isUndercharge ? "undercharge" : "match",
          calculatedTotal: calculatedTotal,
          statedTotal: statedTotal,
          difference: difference,
        }),
      })

      const result = await response.json()
      setGeneratedEmail(result.email)
    } catch (error) {
      console.error("Error generating email:", error)
      const errorItems = data.items.filter((item) => item.status === "overcharge" || item.status === "error")
      const totalDiscrepancy = data.totalMathErrors || 0
      
      setGeneratedEmail(
        "Subject: Request for Clarification - Hospital Bill\n\n" +
          "Dear Billing Department,\n\n" +
          "I am writing to request clarification regarding my recent hospital bill.\n\n" +
          "Upon review, I noticed a ₱" + totalDiscrepancy.toLocaleString() + " discrepancy between:\n" +
          "• The stated subtotal: ₱" + statedTotal.toLocaleString() + "\n" +
          "• My calculation of line items: ₱" + calculatedTotal.toLocaleString() + "\n\n" +
          "Identified items:\n" +
          errorItems.map((item) => `- ${item.name}: ₱${item.total.toLocaleString()} (${item.reason})`).join("\n") +
          "\n\nI kindly request your assistance in verifying these charges to ensure accuracy.\n\n" +
          "Thank you for your attention.\n\n" +
          "Respectfully,\n[Your Name]\n\n" +
          "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n" +
          "AUTOMATED ANALYSIS DISCLAIMER\n\n" +
          "This analysis was generated by an AI-powered hospital billing verification\n" +
          "system for informational purposes only.\n\n" +
          "• This system serves as a neutral auditor for both patients and hospitals\n" +
          "• All calculations should be manually verified by qualified billing staff\n" +
          "• Discrepancies may have legitimate explanations (discounts, adjustments)\n" +
          "• Both parties should work collaboratively to resolve any differences\n\n" +
          "The system does not provide legal, medical, or financial advice.\n" +
          "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
      )
    } finally {
      setIsGenerating(false)
    }
  }

  const handleCopy = () => {
    if (generatedEmail) {
      navigator.clipboard.writeText(generatedEmail)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  const handleBack = () => {
    setSelectedTemplate(null)
    setGeneratedEmail(null)
    setIsGenerating(false)
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
      <Card className="w-full max-w-2xl max-h-[80vh] overflow-hidden flex flex-col">
        <div className="border-b border-border p-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            {selectedTemplate && (
              <button
                onClick={handleBack}
                className="w-8 h-8 rounded-lg hover:bg-muted flex items-center justify-center"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
              </button>
            )}
            <h2 className="text-2xl font-bold text-foreground">
              {selectedTemplate ? "Generated Email" : "Choose Email Template"}
            </h2>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-lg hover:bg-muted flex items-center justify-center">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-auto p-6">
          {!selectedTemplate ? (
            <div className="space-y-4">
              <p className="text-muted-foreground text-sm mb-4">
                📧 How would you like to proceed?
              </p>

              {isOvercharge && (
                <>
                  <button
                    onClick={() => handleGenerateEmail("verification")}
                    className="w-full p-4 text-left border-2 border-blue-200 dark:border-blue-800 rounded-lg hover:bg-blue-50 dark:hover:bg-blue-950 transition-colors"
                  >
                    <div className="flex items-start gap-3">
                      <span className="text-2xl">✓</span>
                      <div>
                        <p className="font-semibold text-foreground mb-1">
                          Formal Verification Request (Recommended)
                        </p>
                        <p className="text-sm text-muted-foreground">
                          Request bill correction with evidence
                        </p>
                        <p className="text-xs text-muted-foreground mt-1">
                          Tone: Professional, firm
                        </p>
                      </div>
                    </div>
                  </button>

                  <button
                    onClick={() => handleGenerateEmail("clarification")}
                    className="w-full p-4 text-left border-2 border-border rounded-lg hover:bg-muted transition-colors"
                  >
                    <div className="flex items-start gap-3">
                      <span className="text-2xl">?</span>
                      <div>
                        <p className="font-semibold text-foreground mb-1">Request Clarification</p>
                        <p className="text-sm text-muted-foreground">
                          Ask for explanation before disputing
                        </p>
                        <p className="text-xs text-muted-foreground mt-1">
                          Tone: Neutral inquiry
                        </p>
                      </div>
                    </div>
                  </button>
                </>
              )}

              {isUndercharge && (
                <>
                  <button
                    onClick={() => handleGenerateEmail("courtesy")}
                    className="w-full p-4 text-left border-2 border-green-200 dark:border-green-800 rounded-lg hover:bg-green-50 dark:hover:bg-green-950 transition-colors"
                  >
                    <div className="flex items-start gap-3">
                      <span className="text-2xl">✓</span>
                      <div>
                        <p className="font-semibold text-foreground mb-1">
                          Courtesy Notice (Recommended)
                        </p>
                        <p className="text-sm text-muted-foreground">
                          Alert hospital to potential underbilling
                        </p>
                        <p className="text-xs text-muted-foreground mt-1">
                          Tone: Helpful, collaborative
                        </p>
                      </div>
                    </div>
                  </button>

                  <button
                    onClick={() => handleGenerateEmail("clarification")}
                    className="w-full p-4 text-left border-2 border-border rounded-lg hover:bg-muted transition-colors"
                  >
                    <div className="flex items-start gap-3">
                      <span className="text-2xl">?</span>
                      <div>
                        <p className="font-semibold text-foreground mb-1">Request Clarification</p>
                        <p className="text-sm text-muted-foreground">
                          Ask for explanation of discount/adjustment
                        </p>
                        <p className="text-xs text-muted-foreground mt-1">
                          Tone: Neutral inquiry
                        </p>
                      </div>
                    </div>
                  </button>
                </>
              )}
            </div>
          ) : isGenerating ? (
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
              className="w-full h-96 p-4 border border-border rounded-lg bg-muted text-foreground font-mono text-sm resize-none"
            />
          )}
        </div>

        {selectedTemplate && !isGenerating && (
          <div className="border-t border-border p-6 flex gap-3">
            <Button onClick={handleCopy} variant="outline" className="flex-1 bg-transparent">
              {copied ? "Copied!" : "Copy to Clipboard"}
            </Button>
            <Button onClick={onClose} className="flex-1">
              Close
            </Button>
          </div>
        )}
      </Card>
    </div>
  )
}
