import { NextResponse } from "next/server"
import { runFullTestSuite, printTestResults } from "@/lib/bill-extraction-tests"

/**
 * GET /api/run-tests
 * 
 * Runs the full test suite for the bill extraction system.
 * Use this endpoint to verify the system is working correctly after changes.
 */
export async function GET() {
  try {
    console.log("\n[BillGuard] Running full test suite...\n")
    
    const results = runFullTestSuite()
    
    // Print to console for development
    printTestResults(results.hierarchyTests.results, results.hierarchyTests.summary)
    
    // Return JSON response
    return NextResponse.json({
      success: results.overallPassRate >= 95,
      overallPassRate: results.overallPassRate,
      
      hierarchyTests: {
        total: results.hierarchyTests.summary.total,
        passed: results.hierarchyTests.summary.passed,
        failed: results.hierarchyTests.summary.failed,
        passRate: results.hierarchyTests.summary.passRate,
        failedTests: results.hierarchyTests.summary.failedTests
      },
      
      discrepancyTests: {
        passed: results.discrepancyTestsPassed,
        failed: results.discrepancyTestsFailed,
        passRate: (results.discrepancyTestsPassed / (results.discrepancyTestsPassed + results.discrepancyTestsFailed)) * 100
      },
      
      keywordTests: {
        passed: results.keywordTestsPassed,
        failed: results.keywordTestsFailed,
        passRate: (results.keywordTestsPassed / (results.keywordTestsPassed + results.keywordTestsFailed)) * 100
      },
      
      message: results.overallPassRate >= 95
        ? "✅ All critical tests passed. System is ready for production."
        : "⚠️ Some tests failed. Review the failed tests before deploying."
    })
  } catch (error) {
    console.error("[BillGuard] Test suite error:", error)
    return NextResponse.json(
      { error: "Failed to run test suite", details: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    )
  }
}
