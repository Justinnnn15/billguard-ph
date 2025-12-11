"use client"

export function LoadingScreen() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-primary/10 via-background to-background flex items-center justify-center">
      <div className="text-center">
        <div className="mb-6">
          <div className="inline-block">
            <div className="relative w-16 h-16">
              <div className="absolute inset-0 rounded-full border-4 border-primary/20"></div>
              <div className="absolute inset-0 rounded-full border-4 border-transparent border-t-primary animate-spin"></div>
              <div className="absolute inset-2 rounded-full flex items-center justify-center bg-primary/5">
                <svg className="w-8 h-8 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M9 12l2 2 4-4m0 0a9 9 0 11-18 0 9 9 0 0118 0z"
                  />
                </svg>
              </div>
            </div>
          </div>
        </div>
        <h1 className="text-3xl font-bold text-foreground mb-2">BillGuard</h1>
        <p className="text-lg text-muted-foreground font-medium">Initializing BillGuard...</p>
      </div>
    </div>
  )
}
