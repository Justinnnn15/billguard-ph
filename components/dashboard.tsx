"use client"

import type React from "react"

import { useRef, useState } from "react"
import { Card } from "@/components/ui/card"

interface DashboardProps {
  onFileSelected: (file: File, preview: string) => void
}

export function Dashboard({ onFileSelected }: DashboardProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [selectedFile, setSelectedFile] = useState<File | null>(null)

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      const reader = new FileReader()
      reader.onload = (event) => {
        const preview = event.target?.result as string
        setSelectedFile(file)
        onFileSelected(file, preview)
      }
      reader.readAsDataURL(file)
    }
  }

  const handleUploadClick = () => {
    fileInputRef.current?.click()
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-secondary via-background to-accent/5 flex items-center justify-center p-4">
      <div className="max-w-2xl w-full">
        {/* Header */}
        <div className="text-center mb-12">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-primary/10 mb-4">
            <svg className="w-6 h-6 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
          </div>
          <h1 className="text-4xl font-bold text-foreground mb-3">BillGuard</h1>
          <p className="text-xl text-muted-foreground">Upload your hospital bill to get started</p>
        </div>

        {/* Upload Buttons */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-8">
          <Card
            className="p-8 border-2 border-dashed hover:border-primary/50 transition-colors cursor-pointer group"
            onClick={handleUploadClick}
          >
            <div className="text-center">
              <div className="inline-flex items-center justify-center w-12 h-12 rounded-lg bg-primary/10 group-hover:bg-primary/20 transition-colors mb-4">
                <svg className="w-6 h-6 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                  />
                </svg>
              </div>
              <h3 className="font-semibold text-foreground mb-1">Upload Bill</h3>
              <p className="text-sm text-muted-foreground">JPG, PNG or PDF</p>
            </div>
          </Card>

          <Card
            className="p-8 border-2 border-dashed hover:border-primary/50 transition-colors cursor-pointer group"
            onClick={handleUploadClick}
          >
            <div className="text-center">
              <div className="inline-flex items-center justify-center w-12 h-12 rounded-lg bg-primary/10 group-hover:bg-primary/20 transition-colors mb-4">
                <svg className="w-6 h-6 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"
                  />
                </svg>
              </div>
              <h3 className="font-semibold text-foreground mb-1">Take Picture</h3>
              <p className="text-sm text-muted-foreground">Capture bill image</p>
            </div>
          </Card>
        </div>

        {/* File Input */}
        <input
          ref={fileInputRef}
          type="file"
          accept=".jpg,.jpeg,.png,.pdf"
          onChange={handleFileChange}
          className="hidden"
        />

        {/* Info Section */}
        <Card className="p-6 bg-secondary/50 border-primary/20">
          <div className="flex gap-4">
            <div className="flex-shrink-0">
              <svg className="w-5 h-5 text-primary mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                <path
                  fillRule="evenodd"
                  d="M18 5v8a2 2 0 01-2 2h-5l-5 4v-4H4a2 2 0 01-2-2V5a2 2 0 012-2h12a2 2 0 012 2zm-11-1a1 1 0 11-2 0 1 1 0 012 0z"
                  clipRule="evenodd"
                />
              </svg>
            </div>
            <div>
              <h4 className="font-semibold text-foreground mb-1">How it works</h4>
              <p className="text-sm text-muted-foreground">
                BillGuard uses advanced AI to scan your hospital bill, extract charges, and identify potential
                overcharges compared to Philippine hospital standards.
              </p>
            </div>
          </div>
        </Card>
      </div>
    </div>
  )
}
