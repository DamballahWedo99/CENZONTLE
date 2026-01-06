"use client"

import * as React from "react"
import { usePathname } from "next/navigation"
import { AppSidebar } from "@/components/app-sidebar"
import { WaterFlowSidebar } from "@/components/water-flow-sidebar"
import type { ComponentProps } from "react"
import type { Sidebar } from "@/components/ui/sidebar"

/**
 * ConditionalSidebar - Route-based sidebar switcher
 *
 * Renders different sidebars based on the current route:
 * - /dashboard/flujos/* → Water Flow Sidebar (monitoring & analytics)
 * - All other routes → App Sidebar (internal admin routes)
 *
 * This allows the app to support multiple user experiences:
 * - Internal tools (cotizaciones, clientes, items, reportes)
 * - Water flow monitoring system
 */

interface ConditionalSidebarProps extends ComponentProps<typeof Sidebar> {
  onOpenChatbot?: () => void;
}

export function ConditionalSidebar({ onOpenChatbot, ...props }: ConditionalSidebarProps) {
  const pathname = usePathname()

  // Determine which sidebar to show based on route
  // Water flow routes can be at /dashboard/flujos or /dashboard/(general)/flujos
  const isWaterFlowRoute = pathname?.includes('/flujos')

  // Render the appropriate sidebar
  if (isWaterFlowRoute) {
    return <WaterFlowSidebar onOpenChatbot={onOpenChatbot} {...props} />
  }

  return <AppSidebar {...props} />
}
