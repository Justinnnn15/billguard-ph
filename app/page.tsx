"use client"

import { useState, useEffect } from "react"
import { LoadingScreen } from "@/components/loading-screen"
import { Dashboard } from "@/components/dashboard"
import { AnalysisResults } from "@/components/analysis-results"
import { ScanningScreen } from "@/components/scanning-screen"

type AppState = "loading" | "dashboard" | "analyzing" | "results" | "error"

interface AnalysisData {
  items: Array<{
    name: string
    quantity?: number
    unitPrice?: number
    totalPrice: number
    status: "fair" | "warning" | "overcharge" | "error"
    reason: string
    expectedPrice?: number
  }>
  overallAssessment: string
  totalOvercharge: number
  hasErrors: boolean
}

export default function Home() {
  const [appState, setAppState] = useState<AppState>("loading")
  const [analysisData, setAnalysisData] = useState<AnalysisData | null>(null)
  const [billImage, setBillImage] = useState<string | null>(null)
  const [errorMessage, setErrorMessage] = useState<string>("")
  const [dashboardKey, setDashboardKey] = useState(0)

  useEffect(() => {
    const timer = setTimeout(() => {
      setAppState("dashboard")
    }, 2500)
    return () => clearTimeout(timer)
  }, [])

  const handleFileSelected = async (file: File, preview: string) => {
    setBillImage(preview)
    setAppState("analyzing")
    setErrorMessage("")

    // Minimum time to show scanning animation (5 seconds)
    const minLoadingTime = 5000
    const startTime = Date.now()

    try {
      const formData = new FormData()
      formData.append("file", file)

      const response = await fetch("/api/analyze-bill", {
        method: "POST",
        body: formData,
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || "Analysis failed")
      }

      const data: AnalysisData = await response.json()
      
      // Ensure minimum loading time has passed
      const elapsedTime = Date.now() - startTime
      if (elapsedTime < minLoadingTime) {
        await new Promise(resolve => setTimeout(resolve, minLoadingTime - elapsedTime))
      }
      
      setAnalysisData(data)
      setAppState("results")
    } catch (error) {
      // Ensure minimum loading time even on error
      const elapsedTime = Date.now() - startTime
      if (elapsedTime < minLoadingTime) {
        await new Promise(resolve => setTimeout(resolve, minLoadingTime - elapsedTime))
      }
      
      console.error("Error analyzing bill:", error)
      setErrorMessage(error instanceof Error ? error.message : "Error analyzing bill. Please try again.")
      setAppState("error")
    }
  }

  const handleBackToDashboard = () => {
    setAppState("dashboard")
    setAnalysisData(null)
    setBillImage(null)
    setErrorMessage("")
    setDashboardKey(prev => prev + 1) // Force dashboard to reset
  }

  return (
    <main className="min-h-screen bg-background">
      {appState === "loading" && <LoadingScreen />}
      {appState === "dashboard" && <Dashboard key={dashboardKey} onFileSelected={handleFileSelected} />}
      {appState === "analyzing" && <ScanningScreen />}
      {appState === "error" && (
        <div className="flex items-center justify-center min-h-screen px-4">
          <div className="text-center max-w-md">
            <div className="text-4xl mb-4 text-destructive">!</div>
            <h2 className="text-2xl font-bold text-foreground mb-2">Analysis Failed</h2>
            <p className="text-muted-foreground mb-6">{errorMessage}</p>
            <button
              onClick={handleBackToDashboard}
              className="px-6 py-2 bg-primary text-primary-foreground rounded-lg hover:opacity-90"
            >
              Try Another Bill
            </button>
          </div>
        </div>
      )}
      {appState === "results" && analysisData && (
        <AnalysisResults data={analysisData} billImage={billImage} onBackToDashboard={handleBackToDashboard} />
      )}
    </main>
  )
}
