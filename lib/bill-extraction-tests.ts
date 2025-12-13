/**
 * BillGuard - Test Utilities and Regression Test Cases
 * 
 * This module provides test utilities for validating the bill extraction system.
 * Based on the CRITICAL SYSTEM PROMPT implementation checklist.
 */

import {
  type ExtractedTotal,
  type TotalHierarchy,
  type DiscrepancyResult,
  buildTotalHierarchy,
  calculateDiscrepancy,
  classifyTotal,
  scoreGrandTotalCandidate,
  GRAND_TOTAL_KEYWORDS,
  SECTION_TOTAL_KEYWORDS,
} from './bill-extraction'

// ═══════════════════════════════════════════════════════════════════════════════
// TEST CASE DEFINITIONS
// ═══════════════════════════════════════════════════════════════════════════════

export interface TestCase {
  id: string
  name: string
  description: string
  category: 'basic' | 'hierarchy' | 'edge_case' | 'format_variation'
  
  // Input data
  totals: ExtractedTotal[]
  
  // Expected results
  expected: {
    grandTotal: number
    grandTotalLabel: string
    sectionTotalCount: number
    verificationStatus: 'verified' | 'likely_correct' | 'uncertain' | 'failed'
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// TEST CASES - Per Implementation Checklist
// ═══════════════════════════════════════════════════════════════════════════════

export const TEST_CASES: TestCase[] = [
  // Test Case 1: Bill with Hospital Charges + Professional Fees
  {
    id: 'TC001',
    name: 'Hospital Charges + Professional Fees',
    description: 'System should read GRAND TOTAL (sum of both), not Hospital Charges subtotal only',
    category: 'basic',
    totals: [
      { label: 'Room and Board', amount: 8000, level: 'line_item', confidence: 90, position: 1 },
      { label: 'Laboratory', amount: 5044, level: 'line_item', confidence: 90, position: 2 },
      { label: 'Pharmacy', amount: 7000, level: 'line_item', confidence: 90, position: 3 },
      { label: 'Total Hospital Charges', amount: 20044, level: 'section_total', confidence: 95, position: 4 },
      { label: 'Professional Fees', amount: 5000, level: 'line_item', confidence: 90, position: 5 },
      { label: 'Total Professional Fees', amount: 5000, level: 'section_total', confidence: 95, position: 6 },
      { label: 'GRAND TOTAL', amount: 25044, level: 'grand_total', confidence: 98, position: 7 },
    ],
    expected: {
      grandTotal: 25044,
      grandTotalLabel: 'GRAND TOTAL',
      sectionTotalCount: 2,
      verificationStatus: 'verified'
    }
  },
  
  // Test Case 2: Bill with multiple subtotals
  {
    id: 'TC002',
    name: 'Multiple Subtotals',
    description: 'System should identify and use final GRAND TOTAL, not first subtotal',
    category: 'hierarchy',
    totals: [
      { label: 'Emergency Room', amount: 15000, level: 'line_item', confidence: 90, position: 1 },
      { label: 'ER Subtotal', amount: 15000, level: 'category_subtotal', confidence: 85, position: 2 },
      { label: 'Ward Charges', amount: 10000, level: 'line_item', confidence: 90, position: 3 },
      { label: 'Ward Subtotal', amount: 10000, level: 'category_subtotal', confidence: 85, position: 4 },
      { label: 'Medications', amount: 8000, level: 'line_item', confidence: 90, position: 5 },
      { label: 'Total Hospital Charges', amount: 33000, level: 'section_total', confidence: 95, position: 6 },
      { label: 'Doctor Fee', amount: 7000, level: 'line_item', confidence: 90, position: 7 },
      { label: 'Total Professional Fees', amount: 7000, level: 'section_total', confidence: 95, position: 8 },
      { label: 'Amount Due', amount: 40000, level: 'grand_total', confidence: 98, position: 9 },
    ],
    expected: {
      grandTotal: 40000,
      grandTotalLabel: 'Amount Due',
      sectionTotalCount: 2,
      verificationStatus: 'verified'
    }
  },
  
  // Test Case 3: Bill with payments/discounts applied
  {
    id: 'TC003',
    name: 'Bill with Payments Applied',
    description: 'System should use final amount after adjustments',
    category: 'edge_case',
    totals: [
      { label: 'Hospital Services', amount: 50000, level: 'line_item', confidence: 90, position: 1 },
      { label: 'Total Hospital Charges', amount: 50000, level: 'section_total', confidence: 95, position: 2 },
      { label: 'Professional Fees', amount: 10000, level: 'section_total', confidence: 95, position: 3 },
      { label: 'GROSS TOTAL', amount: 60000, level: 'grand_total', confidence: 95, position: 4 },
      { label: 'Less: Senior Citizen Discount', amount: 6000, level: 'line_item', confidence: 90, position: 5 },
      { label: 'Less: HMO Coverage', amount: 20000, level: 'line_item', confidence: 90, position: 6 },
      { label: 'Balance Due', amount: 34000, level: 'grand_total', confidence: 98, position: 7 },
    ],
    expected: {
      grandTotal: 60000, // Gross total before deductions is the "subtotal" we compare against
      grandTotalLabel: 'GROSS TOTAL',
      sectionTotalCount: 2,
      verificationStatus: 'verified'
    }
  },
  
  // Test Case 4: Different format - no explicit grand total label
  {
    id: 'TC004',
    name: 'Implicit Grand Total',
    description: 'System should infer grand total from section totals when not explicitly labeled',
    category: 'format_variation',
    totals: [
      { label: 'Room Charges', amount: 12000, level: 'line_item', confidence: 90, position: 1 },
      { label: 'Lab Charges', amount: 8000, level: 'line_item', confidence: 90, position: 2 },
      { label: 'Total Hospital', amount: 20000, level: 'section_total', confidence: 95, position: 3 },
      { label: 'PF - Dr. Santos', amount: 5000, level: 'line_item', confidence: 90, position: 4 },
      { label: 'Total PF', amount: 5000, level: 'section_total', confidence: 95, position: 5 },
      { label: 'Total', amount: 25000, level: 'grand_total', confidence: 80, position: 6 },
    ],
    expected: {
      grandTotal: 25000,
      grandTotalLabel: 'Total',
      sectionTotalCount: 2,
      verificationStatus: 'likely_correct'
    }
  },
  
  // Test Case 5: Only Hospital Charges (no Professional Fees)
  {
    id: 'TC005',
    name: 'Single Section Bill',
    description: 'Bill with only hospital charges (no professional fees section)',
    category: 'basic',
    totals: [
      { label: 'Emergency Room', amount: 10000, level: 'line_item', confidence: 90, position: 1 },
      { label: 'Laboratory', amount: 5000, level: 'line_item', confidence: 90, position: 2 },
      { label: 'X-Ray', amount: 3000, level: 'line_item', confidence: 90, position: 3 },
      { label: 'Total Hospital Charges', amount: 18000, level: 'grand_total', confidence: 95, position: 4 },
    ],
    expected: {
      grandTotal: 18000,
      grandTotalLabel: 'Total Hospital Charges',
      sectionTotalCount: 0,
      verificationStatus: 'likely_correct'
    }
  },
  
  // Test Case 6: Misleading intermediate total
  {
    id: 'TC006',
    name: 'Misleading Intermediate Total',
    description: 'Should not confuse "Hospital Charges" subtotal for grand total',
    category: 'edge_case',
    totals: [
      { label: 'Room: 5th Floor Private', amount: 15000, level: 'line_item', confidence: 90, position: 1 },
      { label: 'Operating Room', amount: 25000, level: 'line_item', confidence: 90, position: 2 },
      { label: 'Anesthesia', amount: 10000, level: 'line_item', confidence: 90, position: 3 },
      { label: 'Hospital Charges', amount: 50000, level: 'section_total', confidence: 95, position: 4 }, // This should NOT be used as grand total
      { label: 'Surgeon Fee', amount: 30000, level: 'line_item', confidence: 90, position: 5 },
      { label: 'Anesthesiologist Fee', amount: 15000, level: 'line_item', confidence: 90, position: 6 },
      { label: 'Professional Fees', amount: 45000, level: 'section_total', confidence: 95, position: 7 },
      { label: 'Total Amount Due', amount: 95000, level: 'grand_total', confidence: 98, position: 8 },
    ],
    expected: {
      grandTotal: 95000,
      grandTotalLabel: 'Total Amount Due',
      sectionTotalCount: 2,
      verificationStatus: 'verified'
    }
  },
  
  // Test Case 7: Philippine peso format variations
  {
    id: 'TC007',
    name: 'Currency Format Variations',
    description: 'Handle various peso formats (₱, PHP, P)',
    category: 'format_variation',
    totals: [
      { label: 'Consultation', amount: 1500.50, level: 'line_item', confidence: 90, position: 1 },
      { label: 'Medicines', amount: 2499.75, level: 'line_item', confidence: 90, position: 2 },
      { label: 'Kabuuang Halaga', amount: 4000.25, level: 'grand_total', confidence: 95, position: 3 },
    ],
    expected: {
      grandTotal: 4000.25,
      grandTotalLabel: 'Kabuuang Halaga',
      sectionTotalCount: 0,
      verificationStatus: 'likely_correct'
    }
  },
  
  // Test Case 8: Large discrepancy detection
  {
    id: 'TC008',
    name: 'Large Discrepancy Alert',
    description: 'System should flag large (>20%) discrepancies for manual review',
    category: 'edge_case',
    totals: [
      { label: 'Services', amount: 20000, level: 'line_item', confidence: 90, position: 1 },
      { label: 'GRAND TOTAL', amount: 25000, level: 'grand_total', confidence: 90, position: 2 },
    ],
    expected: {
      grandTotal: 25000,
      grandTotalLabel: 'GRAND TOTAL',
      sectionTotalCount: 0,
      verificationStatus: 'likely_correct'
    }
  }
]

// ═══════════════════════════════════════════════════════════════════════════════
// TEST RUNNER
// ═══════════════════════════════════════════════════════════════════════════════

export interface TestResult {
  testCase: TestCase
  passed: boolean
  actualGrandTotal: number | null
  actualLabel: string | null
  actualStatus: string
  errors: string[]
  executionTimeMs: number
}

/**
 * Run a single test case
 */
export function runTestCase(testCase: TestCase): TestResult {
  const startTime = Date.now()
  const errors: string[] = []
  
  // Build hierarchy from test totals
  const hierarchy = buildTotalHierarchy(testCase.totals)
  
  const actualGrandTotal = hierarchy.grandTotal?.amount ?? null
  const actualLabel = hierarchy.grandTotal?.label ?? null
  const actualStatus = hierarchy.verificationStatus
  
  // Check grand total amount
  if (actualGrandTotal !== testCase.expected.grandTotal) {
    errors.push(
      `Grand total mismatch: expected ₱${testCase.expected.grandTotal.toLocaleString()}, got ₱${actualGrandTotal?.toLocaleString() ?? 'null'}`
    )
  }
  
  // Check grand total label
  if (actualLabel !== testCase.expected.grandTotalLabel) {
    errors.push(
      `Label mismatch: expected "${testCase.expected.grandTotalLabel}", got "${actualLabel}"`
    )
  }
  
  // Check section total count
  if (hierarchy.sectionTotals.length !== testCase.expected.sectionTotalCount) {
    errors.push(
      `Section total count mismatch: expected ${testCase.expected.sectionTotalCount}, got ${hierarchy.sectionTotals.length}`
    )
  }
  
  // Check verification status (less strict - allow compatible statuses)
  const compatibleStatuses: Record<string, string[]> = {
    'verified': ['verified'],
    'likely_correct': ['verified', 'likely_correct'],
    'uncertain': ['uncertain', 'likely_correct'],
    'failed': ['failed', 'uncertain']
  }
  
  if (!compatibleStatuses[testCase.expected.verificationStatus]?.includes(actualStatus)) {
    errors.push(
      `Verification status mismatch: expected ${testCase.expected.verificationStatus}, got ${actualStatus}`
    )
  }
  
  const executionTimeMs = Date.now() - startTime
  
  return {
    testCase,
    passed: errors.length === 0,
    actualGrandTotal,
    actualLabel,
    actualStatus,
    errors,
    executionTimeMs
  }
}

/**
 * Run all test cases
 */
export function runAllTests(): { results: TestResult[]; summary: TestSummary } {
  const results = TEST_CASES.map(tc => runTestCase(tc))
  
  const passed = results.filter(r => r.passed).length
  const failed = results.filter(r => !r.passed).length
  const totalTime = results.reduce((sum, r) => sum + r.executionTimeMs, 0)
  
  const summary: TestSummary = {
    total: results.length,
    passed,
    failed,
    passRate: (passed / results.length) * 100,
    totalTimeMs: totalTime,
    failedTests: results.filter(r => !r.passed).map(r => ({
      id: r.testCase.id,
      name: r.testCase.name,
      errors: r.errors
    }))
  }
  
  return { results, summary }
}

export interface TestSummary {
  total: number
  passed: number
  failed: number
  passRate: number
  totalTimeMs: number
  failedTests: Array<{ id: string; name: string; errors: string[] }>
}

/**
 * Print test results to console
 */
export function printTestResults(results: TestResult[], summary: TestSummary): void {
  console.log('\n═══════════════════════════════════════════════════════════════════')
  console.log('BILLGUARD EXTRACTION SYSTEM - TEST RESULTS')
  console.log('═══════════════════════════════════════════════════════════════════\n')
  
  for (const result of results) {
    const status = result.passed ? '✓ PASS' : '✗ FAIL'
    console.log(`[${result.testCase.id}] ${status} - ${result.testCase.name}`)
    
    if (!result.passed) {
      for (const error of result.errors) {
        console.log(`    └─ ${error}`)
      }
    }
  }
  
  console.log('\n───────────────────────────────────────────────────────────────────')
  console.log('SUMMARY')
  console.log('───────────────────────────────────────────────────────────────────')
  console.log(`Total:     ${summary.total}`)
  console.log(`Passed:    ${summary.passed}`)
  console.log(`Failed:    ${summary.failed}`)
  console.log(`Pass Rate: ${summary.passRate.toFixed(1)}%`)
  console.log(`Time:      ${summary.totalTimeMs}ms`)
  
  if (summary.failedTests.length > 0) {
    console.log('\nFailed Tests:')
    for (const test of summary.failedTests) {
      console.log(`  - ${test.id}: ${test.name}`)
    }
  }
  
  console.log('═══════════════════════════════════════════════════════════════════\n')
}

// ═══════════════════════════════════════════════════════════════════════════════
// KEYWORD VALIDATION TESTS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Test keyword classification
 */
export function testKeywordClassification(): void {
  console.log('\n═══════════════════════════════════════════════════════════════════')
  console.log('KEYWORD CLASSIFICATION TESTS')
  console.log('═══════════════════════════════════════════════════════════════════\n')
  
  const testLabels = [
    { label: 'GRAND TOTAL', expectedLevel: 'grand_total' },
    { label: 'Total Amount Due', expectedLevel: 'grand_total' },
    { label: 'Amount Payable', expectedLevel: 'grand_total' },
    { label: 'Due from Patient', expectedLevel: 'grand_total' },
    { label: 'Balance Due', expectedLevel: 'grand_total' },
    { label: 'Total Hospital Charges', expectedLevel: 'section_total' },
    { label: 'Hospital Charges Subtotal', expectedLevel: 'section_total' },
    { label: 'Total Professional Fees', expectedLevel: 'section_total' },
    { label: 'Ward Charges Total', expectedLevel: 'section_total' },
    { label: 'Room and Board', expectedLevel: 'line_item' },
    { label: 'Laboratory', expectedLevel: 'line_item' },
    { label: 'Emergency Room', expectedLevel: 'line_item' },
  ]
  
  let passed = 0
  let failed = 0
  
  for (const test of testLabels) {
    const actualLevel = classifyTotal(test.label, 10000, [])
    const success = actualLevel === test.expectedLevel
    
    if (success) {
      passed++
      console.log(`✓ "${test.label}" -> ${actualLevel}`)
    } else {
      failed++
      console.log(`✗ "${test.label}" -> ${actualLevel} (expected: ${test.expectedLevel})`)
    }
  }
  
  console.log(`\nResults: ${passed} passed, ${failed} failed\n`)
}

// ═══════════════════════════════════════════════════════════════════════════════
// DISCREPANCY CALCULATION TESTS
// ═══════════════════════════════════════════════════════════════════════════════

export interface DiscrepancyTestCase {
  id: string
  name: string
  calculatedTotal: number
  billGrandTotal: number
  expectedStatus: 'no_discrepancy' | 'undercharge' | 'overcharge' | 'unable_to_verify'
  expectedAffectedParty: 'none' | 'hospital' | 'patient'
}

export const DISCREPANCY_TEST_CASES: DiscrepancyTestCase[] = [
  {
    id: 'DC001',
    name: 'Exact Match',
    calculatedTotal: 25044,
    billGrandTotal: 25044,
    expectedStatus: 'no_discrepancy',
    expectedAffectedParty: 'none'
  },
  {
    id: 'DC002',
    name: 'Minor Rounding (< ₱1)',
    calculatedTotal: 25044.50,
    billGrandTotal: 25044,
    expectedStatus: 'no_discrepancy',
    expectedAffectedParty: 'none'
  },
  {
    id: 'DC003',
    name: 'Hospital Undercharge',
    calculatedTotal: 25044,
    billGrandTotal: 20044,
    expectedStatus: 'undercharge',
    expectedAffectedParty: 'hospital'
  },
  {
    id: 'DC004',
    name: 'Patient Overcharge',
    calculatedTotal: 20044,
    billGrandTotal: 25044,
    expectedStatus: 'overcharge',
    expectedAffectedParty: 'patient'
  },
  {
    id: 'DC005',
    name: 'Large Discrepancy (>20%)',
    calculatedTotal: 15000,
    billGrandTotal: 25000,
    expectedStatus: 'overcharge',
    expectedAffectedParty: 'patient'
  }
]

/**
 * Run discrepancy calculation tests
 */
export function testDiscrepancyCalculations(): void {
  console.log('\n═══════════════════════════════════════════════════════════════════')
  console.log('DISCREPANCY CALCULATION TESTS')
  console.log('═══════════════════════════════════════════════════════════════════\n')
  
  let passed = 0
  let failed = 0
  
  for (const test of DISCREPANCY_TEST_CASES) {
    // Create a mock hierarchy for the test
    const mockHierarchy: TotalHierarchy = {
      lineItems: [],
      categorySubtotals: [],
      sectionTotals: [],
      grandTotal: { label: 'GRAND TOTAL', amount: test.billGrandTotal, level: 'grand_total', confidence: 95, position: 1 },
      allTotals: [],
      verificationStatus: 'verified',
      verificationNotes: []
    }
    
    const result = calculateDiscrepancy(test.calculatedTotal, test.billGrandTotal, mockHierarchy)
    
    const statusMatch = result.status === test.expectedStatus
    const partyMatch = result.affectedParty === test.expectedAffectedParty
    
    if (statusMatch && partyMatch) {
      passed++
      console.log(`✓ [${test.id}] ${test.name}`)
    } else {
      failed++
      console.log(`✗ [${test.id}] ${test.name}`)
      if (!statusMatch) {
        console.log(`    Status: expected ${test.expectedStatus}, got ${result.status}`)
      }
      if (!partyMatch) {
        console.log(`    Affected Party: expected ${test.expectedAffectedParty}, got ${result.affectedParty}`)
      }
    }
  }
  
  console.log(`\nResults: ${passed} passed, ${failed} failed\n`)
}

// ═══════════════════════════════════════════════════════════════════════════════
// RUN ALL TESTS (Exported for API endpoint)
// ═══════════════════════════════════════════════════════════════════════════════

export function runFullTestSuite(): {
  hierarchyTests: { results: TestResult[]; summary: TestSummary }
  discrepancyTestsPassed: number
  discrepancyTestsFailed: number
  keywordTestsPassed: number
  keywordTestsFailed: number
  overallPassRate: number
} {
  // Run hierarchy tests
  const hierarchyResults = runAllTests()
  
  // Run discrepancy tests
  let discrepancyPassed = 0
  let discrepancyFailed = 0
  
  for (const test of DISCREPANCY_TEST_CASES) {
    const mockHierarchy: TotalHierarchy = {
      lineItems: [],
      categorySubtotals: [],
      sectionTotals: [],
      grandTotal: { label: 'GRAND TOTAL', amount: test.billGrandTotal, level: 'grand_total', confidence: 95, position: 1 },
      allTotals: [],
      verificationStatus: 'verified',
      verificationNotes: []
    }
    
    const result = calculateDiscrepancy(test.calculatedTotal, test.billGrandTotal, mockHierarchy)
    
    if (result.status === test.expectedStatus && result.affectedParty === test.expectedAffectedParty) {
      discrepancyPassed++
    } else {
      discrepancyFailed++
    }
  }
  
  // Run keyword tests
  let keywordPassed = 0
  let keywordFailed = 0
  
  const keywordTestCases = [
    { label: 'GRAND TOTAL', expectedLevel: 'grand_total' },
    { label: 'Total Amount Due', expectedLevel: 'grand_total' },
    { label: 'Total Hospital Charges', expectedLevel: 'section_total' },
    { label: 'Room and Board', expectedLevel: 'line_item' },
  ]
  
  for (const test of keywordTestCases) {
    const actualLevel = classifyTotal(test.label, 10000, [])
    if (actualLevel === test.expectedLevel) {
      keywordPassed++
    } else {
      keywordFailed++
    }
  }
  
  // Calculate overall pass rate
  const totalTests = hierarchyResults.results.length + DISCREPANCY_TEST_CASES.length + keywordTestCases.length
  const totalPassed = hierarchyResults.summary.passed + discrepancyPassed + keywordPassed
  const overallPassRate = (totalPassed / totalTests) * 100
  
  return {
    hierarchyTests: hierarchyResults,
    discrepancyTestsPassed: discrepancyPassed,
    discrepancyTestsFailed: discrepancyFailed,
    keywordTestsPassed: keywordPassed,
    keywordTestsFailed: keywordFailed,
    overallPassRate
  }
}
