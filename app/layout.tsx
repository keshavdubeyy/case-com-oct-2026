import type { Metadata } from "next"
import { Geist_Mono, DM_Sans } from "next/font/google"

import "./globals.css"
import { ThemeProvider } from "@/components/theme-provider"
import { TooltipProvider } from "@/components/ui/tooltip"
import { AppSidebar } from "@/components/app-sidebar"
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar"
import { Separator } from "@/components/ui/separator"
import { DashboardDataProvider } from "@/components/filters/dashboard-data-provider"
import { FilterBar } from "@/components/filters/filter-bar"
import { cn } from "@/lib/utils"

const dmSans = DM_Sans({ subsets: ["latin"], variable: "--font-sans" })

const fontMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
})

export const metadata: Metadata = {
  title: "Data-Driven Follow-Up Assurance",
  description: "Exploratory dashboard for rural teleconsultation lost-to-follow-up analysis — INFINUM 2026.",
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={cn("antialiased", fontMono.variable, "font-sans", dmSans.variable)}
    >
      <body>
        <ThemeProvider>
          <TooltipProvider delay={150}>
            <DashboardDataProvider>
              <SidebarProvider className="h-svh">
                <AppSidebar />
                <SidebarInset className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2 border-b bg-muted/30 px-3 py-3">
                    <SidebarTrigger />
                    <Separator orientation="vertical" className="mr-1 data-vertical:h-5 data-vertical:self-auto" />
                    <FilterBar />
                  </div>
                  <div className="min-w-0 flex-1 overflow-y-auto bg-background p-4">{children}</div>
                </SidebarInset>
              </SidebarProvider>
            </DashboardDataProvider>
          </TooltipProvider>
        </ThemeProvider>
      </body>
    </html>
  )
}
