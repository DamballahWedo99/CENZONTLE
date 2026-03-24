"use client"

import { type LucideIcon } from "lucide-react"
import Link from "next/link"

import {
  SidebarGroup,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"

export function NavSimple({
  items,
}: {
  items: {
    title: string
    url: string
    icon: LucideIcon
    disabled?: boolean
  }[]
}) {
  const { state } = useSidebar()
  return (
    <SidebarGroup>
      <SidebarMenu>
        {items.map((item) => (
          <SidebarMenuItem key={item.title}>
            {item.disabled ? (
              state === "collapsed" ? (
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <div>
                        <SidebarMenuButton
                          disabled
                          className="cursor-not-allowed opacity-50"
                        >
                          <item.icon />
                          <span>{item.title}</span>
                        </SidebarMenuButton>
                      </div>
                    </TooltipTrigger>
                    <TooltipContent side="right" align="center">
                      <p>{item.title} (Próximamente)</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              ) : (
                <SidebarMenuButton
                  disabled
                  className="cursor-not-allowed opacity-50"
                >
                  <item.icon />
                  <span>{item.title} (Próximamente)</span>
                </SidebarMenuButton>
              )
            ) : (
              <SidebarMenuButton asChild tooltip={item.title}>
                <Link href={item.url} className="cursor-pointer">
                  <item.icon />
                  <span>{item.title}</span>
                </Link>
              </SidebarMenuButton>
            )}
          </SidebarMenuItem>
        ))}
      </SidebarMenu>
    </SidebarGroup>
  )
}
