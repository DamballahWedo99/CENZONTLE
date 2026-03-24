"use client"

import { PanelLeft } from "lucide-react"
import { useSidebar } from "@/components/ui/sidebar"
import { Button } from "@/components/ui/button"
import { ThemeToggle } from "@/components/theme-toggle"
import { useBreadcrumb } from "@/context/BreadcrumbContext"
import { useHeaderActions } from "@/context/HeaderActionsContext"

export function DashboardHeader() {
  const { toggleSidebar } = useSidebar()
  const { breadcrumb } = useBreadcrumb()
  const { actions } = useHeaderActions()

  return (
    <header className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="flex h-14 items-center px-4 gap-3">
        {/* Left: Sidebar Toggle */}
        <Button
          variant="ghost"
          size="icon"
          onClick={toggleSidebar}
          className="hover:bg-accent shrink-0"
        >
          <PanelLeft className="h-5 w-5" />
          <span className="sr-only">Toggle sidebar</span>
        </Button>

        {/* Center: Breadcrumb (injected by child pages) */}
        <div className="flex-1 min-w-0">
          {breadcrumb}
        </div>

        {/* Right: Page-injected actions + Theme Toggle */}
        <div className="flex items-center gap-1">
          {actions}
          <ThemeToggle />
        </div>
      </div>
    </header>
  )
}
