"use client"

import type React from "react"

import { useRef, useState } from "react"
import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"

interface DashboardProps {
  onFileSelected: (file: File, preview: string) => void
}

export function Dashboard({ onFileSelected }: DashboardProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [filePreview, setFilePreview] = useState<string | null>(null)

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      setSelectedFile(file)
      
      // Generate preview for images
      if (file.type.startsWith("image/")) {
        const reader = new FileReader()
        reader.onload = (event) => {
          setFilePreview(event.target?.result as string)
        }
        reader.readAsDataURL(file)
      } else {
        // For PDFs and other files, show a placeholder
        setFilePreview(null)
      }
      
      // Reset input value so the same file can be selected again
      if (fileInputRef.current) {
        fileInputRef.current.value = ""
      }
    }
  }

  const handleUploadClick = () => {
    fileInputRef.current?.click()
  }

  const handleStartScanning = () => {
    if (selectedFile) {
      if (filePreview) {
        onFileSelected(selectedFile, filePreview)
      } else {
        // For non-image files, pass the file without preview
        onFileSelected(selectedFile, "")
      }
    }
  }

  const handleRemoveFile = () => {
    setSelectedFile(null)
    setFilePreview(null)
    if (fileInputRef.current) {
      fileInputRef.current.value = ""
    }
  }

  const getFileIcon = () => {
    if (!selectedFile) return null
    const ext = selectedFile.name.split('.').pop()?.toLowerCase()
    
    if (ext === 'pdf') {
      return (
        <svg className="w-16 h-16 text-red-500" fill="currentColor" viewBox="0 0 24 24">
          <path d="M14,2H6A2,2 0 0,0 4,4V20A2,2 0 0,0 6,22H18A2,2 0 0,0 20,20V8L14,2M18,20H6V4H13V9H18V20M10.92,12.31C10.68,11.54 10.15,9.08 11.55,9.04C12.95,9 12.03,12.16 12.03,12.16C12.42,13.65 14.05,14.72 14.05,14.72C14.55,14.57 17.4,14.24 17,15.72C16.57,17.2 13.5,15.81 13.5,15.81C11.55,15.95 10.09,16.47 10.09,16.47C8.96,18.58 7.64,19.5 7.1,18.61C6.43,17.5 9.23,16.07 9.23,16.07C10.68,13.72 10.9,12.35 10.92,12.31Z" />
        </svg>
      )
    }
    
    return (
      <svg className="w-16 h-16 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
      </svg>
    )
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

        {/* File Preview Section */}
        {selectedFile ? (
          <Card className="p-6 mb-8 border-2 border-primary/30">
            <div className="flex flex-col items-center">
              {/* Preview */}
              <div className="mb-4 relative">
                {filePreview ? (
                  <img 
                    src={filePreview} 
                    alt="Bill preview" 
                    className="max-h-64 max-w-full rounded-lg object-contain border border-border"
                  />
                ) : (
                  <div className="flex flex-col items-center justify-center p-8 bg-secondary/50 rounded-lg">
                    {getFileIcon()}
                  </div>
                )}
              </div>
              
              {/* File Info */}
              <div className="text-center mb-6">
                <p className="font-medium text-foreground truncate max-w-xs">{selectedFile.name}</p>
                <p className="text-sm text-muted-foreground">
                  {(selectedFile.size / 1024 / 1024).toFixed(2)} MB
                </p>
              </div>

              {/* Action Buttons */}
              <div className="flex gap-3 w-full max-w-sm">
                <Button 
                  variant="outline" 
                  className="flex-1"
                  onClick={handleRemoveFile}
                >
                  <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                  Remove
                </Button>
                <Button 
                  className="flex-1 bg-primary hover:bg-primary/90"
                  onClick={handleStartScanning}
                >
                  <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                  </svg>
                  Start Scanning
                </Button>
              </div>
            </div>
          </Card>
        ) : (
          /* Upload Buttons */
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
                <p className="text-sm text-muted-foreground">Any image or PDF file</p>
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
                      d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z"
                    />
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M15 13a3 3 0 11-6 0 3 3 0 016 0z"
                    />
                  </svg>
                </div>
                <h3 className="font-semibold text-foreground mb-1">Take Picture</h3>
                <p className="text-sm text-muted-foreground">Capture bill image</p>
              </div>
            </Card>
          </div>
        )}

        {/* File Input - Accept any file */}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*,.pdf,.webp,.heic,.heif"
          onChange={handleFileChange}
          className="hidden"
        />

        {/* Info Section */}
        <Card className="p-6 bg-secondary/50 border-primary/20 mb-4">
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

        {/* Tip for better results */}
        <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
          <svg className="w-4 h-4 text-amber-500" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
          </svg>
          <span>For best results, upload a <strong>clear, well-lit photo</strong> of your bill</span>
        </div>
      </div>
    </div>
  )
}
