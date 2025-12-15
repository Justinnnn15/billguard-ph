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
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-background to-purple-50 dark:from-slate-900 dark:via-background dark:to-blue-950 flex items-center justify-center p-4">
      <div className="max-w-2xl w-full">
        {/* Header */}
        <div className="text-center mb-12 animate-fade-in">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-blue-500 to-purple-600 shadow-lg shadow-blue-500/50 mb-6 transform hover:scale-110 transition-transform">
            <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
          </div>
          <h1 className="text-5xl font-black text-foreground mb-4 bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">BillGuard</h1>
          <p className="text-xl text-muted-foreground font-medium">Verify your hospital bills with AI-powered analysis</p>
        </div>

        {/* File Preview Section */}
        {selectedFile ? (
          <Card className="p-8 mb-8 border-2 border-primary/30 shadow-xl animate-scale-in bg-gradient-to-br from-white to-blue-50 dark:from-slate-800 dark:to-slate-900">
            <div className="flex flex-col items-center">
              {/* Preview */}
              <div className="mb-6 relative">
                {filePreview ? (
                  <div className="relative group">
                    <div className="absolute inset-0 bg-gradient-to-r from-blue-500 to-purple-600 rounded-lg blur opacity-25 group-hover:opacity-40 transition"></div>
                    <img 
                      src={filePreview} 
                      alt="Bill preview" 
                      className="relative max-h-72 max-w-full rounded-lg object-contain border-2 border-border shadow-lg"
                    />
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center p-10 bg-gradient-to-br from-secondary/50 to-secondary/30 rounded-xl">
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
              <div className="flex gap-4 w-full max-w-sm">
                <Button 
                  variant="outline" 
                  className="flex-1 border-2 hover:bg-red-50 hover:border-red-300 hover:text-red-600 dark:hover:bg-red-950 transition-all"
                  onClick={handleRemoveFile}
                >
                  <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                  Remove
                </Button>
                <Button 
                  className="flex-1 bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 text-white shadow-lg shadow-blue-500/50 hover:shadow-xl transition-all transform hover:scale-105"
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
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 mb-8">
            <Card
              className="p-10 border-2 border-dashed border-blue-200 dark:border-blue-800 hover:border-blue-500 dark:hover:border-blue-400 hover:bg-blue-50 dark:hover:bg-blue-950/30 transition-all cursor-pointer group transform hover:scale-105 hover:shadow-xl animate-fade-in"
              onClick={handleUploadClick}
            >
              <div className="text-center">
                <div className="inline-flex items-center justify-center w-16 h-16 rounded-xl bg-gradient-to-br from-blue-100 to-blue-200 dark:from-blue-900 dark:to-blue-800 group-hover:from-blue-500 group-hover:to-purple-600 transition-all mb-4 shadow-lg">
                  <svg className="w-8 h-8 text-blue-600 dark:text-blue-300 group-hover:text-white transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                    />
                  </svg>
                </div>
                <h3 className="font-bold text-foreground mb-2 text-lg">Upload Bill</h3>
                <p className="text-sm text-muted-foreground">Any image or PDF file</p>
              </div>
            </Card>

            <Card
              className="p-10 border-2 border-dashed border-purple-200 dark:border-purple-800 hover:border-purple-500 dark:hover:border-purple-400 hover:bg-purple-50 dark:hover:bg-purple-950/30 transition-all cursor-pointer group transform hover:scale-105 hover:shadow-xl animate-fade-in animation-delay-100"
              onClick={handleUploadClick}
            >
              <div className="text-center">
                <div className="inline-flex items-center justify-center w-16 h-16 rounded-xl bg-gradient-to-br from-purple-100 to-purple-200 dark:from-purple-900 dark:to-purple-800 group-hover:from-purple-500 group-hover:to-pink-600 transition-all mb-4 shadow-lg">
                  <svg className="w-8 h-8 text-purple-600 dark:text-purple-300 group-hover:text-white transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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
                <h3 className="font-bold text-foreground mb-2 text-lg">Take Picture</h3>
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
        <Card className="p-6 bg-gradient-to-r from-blue-50 to-purple-50 dark:from-blue-950/30 dark:to-purple-950/30 border-blue-200 dark:border-blue-800 mb-4 shadow-md">
          <div className="flex gap-4">
            <div className="flex-shrink-0">
              <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center">
                <svg className="w-5 h-5 text-white" fill="currentColor" viewBox="0 0 20 20">
                  <path
                    fillRule="evenodd"
                    d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z"
                    clipRule="evenodd"
                  />
                </svg>
              </div>
            </div>
            <div>
              <h4 className="font-bold text-foreground mb-2">How it works</h4>
              <p className="text-sm text-muted-foreground leading-relaxed">
                BillGuard uses advanced AI to scan your hospital bill, extract charges, and identify potential
                discrepancies compared to Philippine hospital standards.
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
