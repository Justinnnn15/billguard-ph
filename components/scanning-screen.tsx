"use client"

import { useEffect, useState } from "react"

const scanningSteps = [
  { text: "Enhancing image clarity...", icon: "enhance" },
  { text: "Extracting text from bill...", icon: "scan" },
  { text: "Identifying line items...", icon: "analyze" },
  { text: "Comparing with hospital rates...", icon: "compare" },
  { text: "Generating analysis report...", icon: "report" },
]

export function ScanningScreen() {
  const [currentStep, setCurrentStep] = useState(0)
  const [progress, setProgress] = useState(0)

  useEffect(() => {
    // Progress animation
    const progressInterval = setInterval(() => {
      setProgress((prev) => {
        if (prev >= 95) return prev
        return prev + Math.random() * 3
      })
    }, 200)

    // Step animation
    const stepInterval = setInterval(() => {
      setCurrentStep((prev) => {
        if (prev >= scanningSteps.length - 1) return prev
        return prev + 1
      })
    }, 2500)

    return () => {
      clearInterval(progressInterval)
      clearInterval(stepInterval)
    }
  }, [])

  const getStepIcon = (icon: string) => {
    switch (icon) {
      case "enhance":
        return (
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>
        )
      case "scan":
        return (
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
          </svg>
        )
      case "analyze":
        return (
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
          </svg>
        )
      case "compare":
        return (
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 6l3 1m0 0l-3 9a5.002 5.002 0 006.001 0M6 7l3 9M6 7l6-2m6 2l3-1m-3 1l-3 9a5.002 5.002 0 006.001 0M18 7l3 9m-3-9l-6-2m0-2v2m0 16V5m0 16H9m3 0h3" />
          </svg>
        )
      case "report":
        return (
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
        )
      default:
        return null
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-secondary via-background to-accent/5 flex items-center justify-center p-4">
      <div className="max-w-md w-full">
        {/* Main scanning animation */}
        <div className="text-center mb-8">
          <div className="relative inline-block mb-6">
            {/* Outer ring */}
            <div className="w-32 h-32 rounded-full border-4 border-primary/20 relative">
              {/* Spinning ring */}
              <div className="absolute inset-0 rounded-full border-4 border-transparent border-t-primary animate-spin"></div>
              
              {/* Inner content */}
              <div className="absolute inset-4 rounded-full bg-primary/10 flex items-center justify-center">
                <div className="text-primary animate-pulse">
                  {getStepIcon(scanningSteps[currentStep].icon)}
                </div>
              </div>
            </div>
            
            {/* Scanning line effect */}
            <div className="absolute inset-0 overflow-hidden rounded-full">
              <div className="absolute w-full h-1 bg-gradient-to-r from-transparent via-primary to-transparent animate-scan"></div>
            </div>
          </div>

          <h2 className="text-2xl font-bold text-foreground mb-2">Scanning Your Bill</h2>
          <p className="text-muted-foreground mb-6">{scanningSteps[currentStep].text}</p>
        </div>

        {/* Progress bar */}
        <div className="mb-8">
          <div className="h-2 bg-secondary rounded-full overflow-hidden">
            <div 
              className="h-full bg-primary transition-all duration-300 ease-out rounded-full"
              style={{ width: `${progress}%` }}
            ></div>
          </div>
          <p className="text-sm text-muted-foreground text-center mt-2">{Math.round(progress)}% complete</p>
        </div>

        {/* Steps indicator */}
        <div className="space-y-3">
          {scanningSteps.map((step, index) => (
            <div 
              key={index}
              className={`flex items-center gap-3 p-3 rounded-lg transition-all duration-300 ${
                index < currentStep 
                  ? "bg-primary/10 text-primary" 
                  : index === currentStep 
                    ? "bg-primary/5 text-foreground" 
                    : "text-muted-foreground"
              }`}
            >
              <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-medium ${
                index < currentStep 
                  ? "bg-primary text-primary-foreground" 
                  : index === currentStep 
                    ? "bg-primary/20 text-primary border-2 border-primary" 
                    : "bg-secondary text-muted-foreground"
              }`}>
                {index < currentStep ? (
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                  </svg>
                ) : (
                  index + 1
                )}
              </div>
              <span className={`text-sm ${index <= currentStep ? "font-medium" : ""}`}>
                {step.text}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Add scanning animation keyframes */}
      <style jsx>{`
        @keyframes scan {
          0% { top: 0; }
          50% { top: 100%; }
          100% { top: 0; }
        }
        .animate-scan {
          animation: scan 2s ease-in-out infinite;
        }
      `}</style>
    </div>
  )
}
