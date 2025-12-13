/**
 * BillGuard - Image Processing & OCR Module
 * 
 * Uses Sharp for image enhancement and Tesseract.js for OCR.
 * Designed for Philippine hospital bills with various formats.
 */

import sharp from 'sharp'
import Tesseract from 'tesseract.js'

// ═══════════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════════

export interface EnhancedImage {
  buffer: Buffer
  mimeType: string
  width: number
  height: number
  enhancementSteps: string[]
}

export interface OCRResult {
  text: string
  confidence: number
  words: Array<{
    text: string
    confidence: number
    bbox?: { x0: number; y0: number; x1: number; y1: number }
  }>
  lines: Array<{
    text: string
    confidence: number
  }>
}

export interface ExtractedFinancials {
  lineItems: Array<{ name: string; amount: number }>
  subtotal: number | null
  grandTotal: number | null
  sectionTotals: Array<{ label: string; amount: number }>
  discounts: number
  payments: number
  balanceDue: number | null
  rawText: string
}

// ═══════════════════════════════════════════════════════════════════════════════
// IMAGE ENHANCEMENT WITH SHARP
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Enhanced image preprocessing pipeline optimized for OCR on hospital bills
 */
export async function enhanceImageForOCR(buffer: Buffer): Promise<EnhancedImage> {
  const steps: string[] = []
  
  try {
    // Get original metadata
    const metadata = await sharp(buffer).metadata()
    console.log(`[ImageProcessing] Original: ${metadata.width}x${metadata.height}, format: ${metadata.format}`)
    steps.push(`Original: ${metadata.width}x${metadata.height}`)
    
    let processor = sharp(buffer)
    
    // Step 1: Convert to grayscale (improves OCR accuracy)
    processor = processor.grayscale()
    steps.push('Converted to grayscale')
    
    // Step 2: Resize if too small (OCR works better on larger images)
    // Target: at least 1500px wide for bills
    const targetWidth = 2000
    if (metadata.width && metadata.width < targetWidth) {
      const scale = targetWidth / metadata.width
      processor = processor.resize({
        width: targetWidth,
        height: Math.round((metadata.height || 1000) * scale),
        kernel: 'lanczos3', // Best quality upscaling
        withoutEnlargement: false
      })
      steps.push(`Upscaled to ${targetWidth}px wide`)
    }
    
    // Step 3: Normalize contrast (auto-levels)
    processor = processor.normalize()
    steps.push('Normalized contrast')
    
    // Step 4: Increase contrast for text clarity
    processor = processor.linear(1.2, -20) // Increase contrast, slight darkening
    steps.push('Enhanced contrast')
    
    // Step 5: Sharpen text edges
    processor = processor.sharpen({
      sigma: 1.5,
      m1: 1.0,
      m2: 0.5,
      x1: 2,
      y2: 10,
      y3: 20
    })
    steps.push('Sharpened text')
    
    // Step 6: Apply threshold to create high-contrast black/white
    // This helps with faded or low-contrast prints
    processor = processor.threshold(160) // Adjust threshold for best results
    steps.push('Applied threshold (160)')
    
    // Step 7: Remove noise with median filter
    processor = processor.median(1)
    steps.push('Applied noise reduction')
    
    // Output as PNG (lossless, best for OCR)
    const enhancedBuffer = await processor
      .png({ compressionLevel: 6 })
      .toBuffer()
    
    const enhancedMetadata = await sharp(enhancedBuffer).metadata()
    
    console.log(`[ImageProcessing] Enhanced: ${enhancedMetadata.width}x${enhancedMetadata.height}`)
    console.log(`[ImageProcessing] Steps: ${steps.join(' → ')}`)
    
    return {
      buffer: enhancedBuffer,
      mimeType: 'image/png',
      width: enhancedMetadata.width || 0,
      height: enhancedMetadata.height || 0,
      enhancementSteps: steps
    }
  } catch (error) {
    console.error('[ImageProcessing] Enhancement failed:', error)
    // Return original if enhancement fails
    const metadata = await sharp(buffer).metadata()
    return {
      buffer: Buffer.from(buffer),
      mimeType: 'image/png',
      width: metadata.width || 0,
      height: metadata.height || 0,
      enhancementSteps: ['Enhancement failed - using original']
    }
  }
}

/**
 * Alternative enhancement for photos (vs scans)
 * Better for camera-captured bills with perspective/lighting issues
 */
export async function enhancePhotoForOCR(buffer: Buffer): Promise<EnhancedImage> {
  const steps: string[] = []
  
  try {
    const metadata = await sharp(buffer).metadata()
    steps.push(`Original photo: ${metadata.width}x${metadata.height}`)
    
    let processor = sharp(buffer)
    
    // Step 1: Resize to standard width
    const targetWidth = 2000
    if (metadata.width && metadata.width < targetWidth) {
      processor = processor.resize({
        width: targetWidth,
        withoutEnlargement: false,
        kernel: 'lanczos3'
      })
      steps.push(`Upscaled to ${targetWidth}px`)
    }
    
    // Step 2: Convert to grayscale
    processor = processor.grayscale()
    steps.push('Grayscale')
    
    // Step 3: Normalize (important for photos with varying lighting)
    processor = processor.normalize()
    steps.push('Normalized')
    
    // Step 4: Increase gamma for better visibility of faded text
    processor = processor.gamma(1.8)
    steps.push('Gamma correction')
    
    // Step 5: Strong contrast enhancement
    processor = processor.linear(1.4, -30)
    steps.push('Contrast boost')
    
    // Step 6: Aggressive sharpening for photos
    processor = processor.sharpen({
      sigma: 2,
      m1: 1.5,
      m2: 0.7
    })
    steps.push('Sharpened')
    
    // Step 7: Adaptive threshold-like effect using clahe
    // Note: Sharp doesn't have CLAHE, so we use modulate + normalize
    processor = processor.modulate({ brightness: 1.1 }).normalize()
    steps.push('Brightness adjusted')
    
    const enhancedBuffer = await processor.png({ compressionLevel: 6 }).toBuffer()
    const enhancedMetadata = await sharp(enhancedBuffer).metadata()
    
    return {
      buffer: enhancedBuffer,
      mimeType: 'image/png',
      width: enhancedMetadata.width || 0,
      height: enhancedMetadata.height || 0,
      enhancementSteps: steps
    }
  } catch (error) {
    console.error('[ImageProcessing] Photo enhancement failed:', error)
    const metadata = await sharp(buffer).metadata()
    return {
      buffer: Buffer.from(buffer),
      mimeType: 'image/png',
      width: metadata.width || 0,
      height: metadata.height || 0,
      enhancementSteps: ['Photo enhancement failed - using original']
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// TESSERACT.JS OCR
// ═══════════════════════════════════════════════════════════════════════════════

let tesseractWorker: Tesseract.Worker | null = null

/**
 * Initialize Tesseract worker (reusable for multiple OCR calls)
 */
async function getWorker(): Promise<Tesseract.Worker> {
  if (!tesseractWorker) {
    console.log('[OCR] Initializing Tesseract worker...')
    tesseractWorker = await Tesseract.createWorker('eng', 1, {
      logger: (m) => {
        if (m.status === 'recognizing text') {
          console.log(`[OCR] Progress: ${Math.round(m.progress * 100)}%`)
        }
      }
    })
    
    // Set parameters optimized for receipts/bills
    await tesseractWorker.setParameters({
      tessedit_char_whitelist: '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz₱$,.:-/() ',
      preserve_interword_spaces: '1',
    })
    
    console.log('[OCR] Tesseract worker ready')
  }
  return tesseractWorker
}

/**
 * Perform OCR on an image buffer
 */
export async function performOCR(imageBuffer: Buffer): Promise<OCRResult> {
  try {
    const worker = await getWorker()
    
    console.log('[OCR] Starting text recognition...')
    const startTime = Date.now()
    
    const result = await worker.recognize(imageBuffer)
    
    const duration = Date.now() - startTime
    console.log(`[OCR] Completed in ${duration}ms, confidence: ${result.data.confidence}%`)
    
    // Extract words and lines from paragraphs (Tesseract.js structure)
    const words: Array<{ text: string; confidence: number; bbox?: { x0: number; y0: number; x1: number; y1: number } }> = []
    const lines: Array<{ text: string; confidence: number }> = []
    
    // Tesseract.js returns data in paragraphs -> lines -> words structure
    const paragraphs = (result.data as { paragraphs?: Array<{ lines?: Array<{ text?: string; confidence?: number; words?: Array<{ text?: string; confidence?: number; bbox?: { x0: number; y0: number; x1: number; y1: number } }> }> }> }).paragraphs || []
    
    for (const paragraph of paragraphs) {
      for (const line of paragraph.lines || []) {
        if (line.text) {
          lines.push({
            text: line.text,
            confidence: line.confidence || 0
          })
        }
        for (const word of line.words || []) {
          if (word.text) {
            words.push({
              text: word.text,
              confidence: word.confidence || 0,
              bbox: word.bbox
            })
          }
        }
      }
    }
    
    return {
      text: result.data.text,
      confidence: result.data.confidence,
      words,
      lines
    }
  } catch (error) {
    console.error('[OCR] Recognition failed:', error)
    return {
      text: '',
      confidence: 0,
      words: [],
      lines: []
    }
  }
}

/**
 * Cleanup Tesseract worker when done
 */
export async function terminateOCR(): Promise<void> {
  if (tesseractWorker) {
    await tesseractWorker.terminate()
    tesseractWorker = null
    console.log('[OCR] Worker terminated')
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// BILL TEXT PARSING
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Parse peso amounts from text
 * Handles formats: ₱1,234.56, P1234.56, 1,234.56, PHP 1234
 */
function parsePesoAmount(text: string): number | null {
  // Remove currency symbols and clean up
  const cleaned = text
    .replace(/[₱P]/gi, '')
    .replace(/PHP/gi, '')
    .replace(/\s/g, '')
    .trim()
  
  // Match number with optional commas and decimals
  const match = cleaned.match(/^-?([\d,]+\.?\d*)$/)
  if (match) {
    const value = parseFloat(match[1].replace(/,/g, ''))
    if (!isNaN(value) && value >= 0 && value < 10000000) { // Reasonable range
      return value
    }
  }
  return null
}

/**
 * Extract financial data from OCR text
 */
export function parseFinancialsFromText(ocrText: string): ExtractedFinancials {
  const lines = ocrText.split('\n').map(l => l.trim()).filter(l => l.length > 0)
  
  const lineItems: Array<{ name: string; amount: number }> = []
  const sectionTotals: Array<{ label: string; amount: number }> = []
  let subtotal: number | null = null
  let grandTotal: number | null = null
  let discounts = 0
  let payments = 0
  let balanceDue: number | null = null
  
  // Keywords for classification
  const grandTotalKeywords = ['grand total', 'total amount', 'amount due', 'balance due', 'net amount']
  const sectionTotalKeywords = ['total hospital', 'hospital charges', 'total professional', 'professional fee']
  const discountKeywords = ['discount', 'senior', 'pwd', 'less:']
  const paymentKeywords = ['payment', 'paid', 'deposit']
  const excludeKeywords = ['date', 'time', 'name', 'address', 'room', 'admission', 'discharge', 'page']
  
  console.log('[Parser] Parsing', lines.length, 'lines')
  
  for (const line of lines) {
    const lowerLine = line.toLowerCase()
    
    // Skip non-billable lines
    if (excludeKeywords.some(k => lowerLine.includes(k) && !lowerLine.includes('room and board'))) {
      continue
    }
    
    // Try to extract amount from line
    // Pattern: "Item Name    1,234.56" or "Item Name: ₱1,234.56"
    const amountMatch = line.match(/₱?\s*([\d,]+\.?\d{0,2})\s*$/)
    if (!amountMatch) continue
    
    const amount = parsePesoAmount(amountMatch[1])
    if (amount === null || amount === 0) continue
    
    const label = line.replace(amountMatch[0], '').replace(/[:\s]+$/, '').trim()
    if (!label || label.length < 2) continue
    
    console.log(`[Parser] Found: "${label}" = ₱${amount.toLocaleString()}`)
    
    // Classify the line
    if (grandTotalKeywords.some(k => lowerLine.includes(k))) {
      // This is a grand total candidate
      if (grandTotal === null || amount > grandTotal) {
        grandTotal = amount
        console.log(`[Parser] → Grand Total: ₱${amount.toLocaleString()}`)
      }
    } else if (sectionTotalKeywords.some(k => lowerLine.includes(k))) {
      // Section total
      sectionTotals.push({ label, amount })
      console.log(`[Parser] → Section Total: ${label}`)
    } else if (discountKeywords.some(k => lowerLine.includes(k))) {
      // Discount
      discounts += amount
      console.log(`[Parser] → Discount: ₱${amount.toLocaleString()}`)
    } else if (paymentKeywords.some(k => lowerLine.includes(k))) {
      // Payment
      payments += amount
      console.log(`[Parser] → Payment: ₱${amount.toLocaleString()}`)
    } else if (amount > 100) {
      // Line item (skip very small amounts that might be quantities)
      lineItems.push({ name: label, amount })
    }
  }
  
  // Calculate subtotal from section totals if available
  if (sectionTotals.length > 0) {
    subtotal = sectionTotals.reduce((sum, t) => sum + t.amount, 0)
    console.log(`[Parser] Subtotal from sections: ₱${subtotal.toLocaleString()}`)
  }
  
  // If no grand total found, use subtotal
  if (grandTotal === null && subtotal !== null) {
    grandTotal = subtotal
  }
  
  // Calculate balance due if not found
  if (balanceDue === null && grandTotal !== null) {
    balanceDue = grandTotal - discounts - payments
  }
  
  console.log('[Parser] Summary:')
  console.log(`  Line items: ${lineItems.length}`)
  console.log(`  Section totals: ${sectionTotals.length}`)
  console.log(`  Grand total: ₱${grandTotal?.toLocaleString() || 'not found'}`)
  console.log(`  Discounts: ₱${discounts.toLocaleString()}`)
  console.log(`  Payments: ₱${payments.toLocaleString()}`)
  
  return {
    lineItems,
    subtotal,
    grandTotal,
    sectionTotals,
    discounts,
    payments,
    balanceDue,
    rawText: ocrText
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// COMBINED PROCESSING PIPELINE
// ═══════════════════════════════════════════════════════════════════════════════

export interface ProcessingResult {
  enhancedImage: EnhancedImage
  ocrResult: OCRResult
  financials: ExtractedFinancials
  processingTimeMs: number
}

/**
 * Full processing pipeline: enhance image → OCR → parse financials
 */
export async function processHospitalBill(imageBuffer: Buffer): Promise<ProcessingResult> {
  const startTime = Date.now()
  
  console.log('[Pipeline] Starting bill processing...')
  
  // Step 1: Enhance image
  console.log('[Pipeline] Step 1: Enhancing image...')
  const enhancedImage = await enhanceImageForOCR(imageBuffer)
  
  // Step 2: Perform OCR
  console.log('[Pipeline] Step 2: Performing OCR...')
  const ocrResult = await performOCR(enhancedImage.buffer)
  
  // If confidence is low, try photo enhancement
  if (ocrResult.confidence < 60) {
    console.log('[Pipeline] Low confidence, trying photo enhancement...')
    const photoEnhanced = await enhancePhotoForOCR(imageBuffer)
    const photoOCR = await performOCR(photoEnhanced.buffer)
    
    if (photoOCR.confidence > ocrResult.confidence) {
      console.log('[Pipeline] Photo enhancement produced better results')
      const financials = parseFinancialsFromText(photoOCR.text)
      return {
        enhancedImage: photoEnhanced,
        ocrResult: photoOCR,
        financials,
        processingTimeMs: Date.now() - startTime
      }
    }
  }
  
  // Step 3: Parse financials
  console.log('[Pipeline] Step 3: Parsing financials...')
  const financials = parseFinancialsFromText(ocrResult.text)
  
  const processingTimeMs = Date.now() - startTime
  console.log(`[Pipeline] Complete in ${processingTimeMs}ms`)
  
  return {
    enhancedImage,
    ocrResult,
    financials,
    processingTimeMs
  }
}
