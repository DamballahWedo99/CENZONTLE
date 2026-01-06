"use client"

import * as React from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import {
  FileCheck,
  FileText,
  LogOut,
  Brain,
} from "lucide-react"

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from "@/components/ui/sidebar"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { useAuth } from "@/hooks/use-auth"
import { CaretSortIcon } from "@radix-ui/react-icons"
import { useSidebar } from "@/components/ui/sidebar"
import { EcosystemSwitcher } from "@/components/ecosystem-switcher"
import { ecosystems } from "@/config/ecosystems"
import { SidebarLogo } from "@/components/sidebar-logo"

const navigationItems = [
  {
    title: "Aprobaciones",
    url: "/aprobacion",
    icon: FileCheck,
    description: "Dashboard de aprobaciones",
  },
  {
    title: "Reportes",
    url: "/reportes",
    icon: FileText,
    description: "Reportes y análisis",
  },
]

interface WaterFlowSidebarProps extends React.ComponentProps<typeof Sidebar> {
  onOpenChatbot?: () => void;
}

export function WaterFlowSidebar({ onOpenChatbot, ...props }: WaterFlowSidebarProps) {
  const pathname = usePathname()
  const { user, logout } = useAuth()
  const { state, isMobile } = useSidebar()

  // Prepare user data
  const userData = {
    name: user?.name || user?.email?.split('@')[0] || 'Usuario',
    email: user?.email || 'user@pinnacledatahub.com',
    avatar: '/avatars/user.jpg',
  }

  // Generate user initials from name or email (matching NavUser logic)
  const getInitials = (name: string, email: string) => {
    if (name && name !== email.split('@')[0] && name !== 'Usuario') {
      // If we have a real name, use it
      const nameParts = name.split(' ').filter(Boolean)
      if (nameParts.length >= 2) {
        return `${nameParts[0][0]}${nameParts[1][0]}`.toUpperCase()
      }
      return name.slice(0, 2).toUpperCase()
    }
    // Fall back to email
    const emailName = email.split('@')[0]
    const parts = emailName.split(/[._-]/).filter(Boolean)
    if (parts.length >= 2) {
      return `${parts[0][0]}${parts[1][0]}`.toUpperCase()
    }
    return emailName.slice(0, 2).toUpperCase()
  }

  const initials = getInitials(userData.name, userData.email)

  return (
    <Sidebar
      collapsible="icon"
      variant="sidebar"
      className="border-0 shadow-2xl bg-sidebar/95 backdrop-blur-xl"
      {...props}
    >
      <SidebarHeader className="h-14 justify-center border-b border-sidebar-border/50">
        {state === "collapsed" ? (
          <SidebarLogo />
        ) : (
          <EcosystemSwitcher ecosystems={ecosystems} />
        )}
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Navigation</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {navigationItems.map((item) => (
                <SidebarMenuItem key={item.url}>
                  <SidebarMenuButton
                    asChild
                    isActive={pathname === item.url}
                    className="transition-all duration-300 hover:scale-105 hover:bg-accent/50"
                    tooltip={item.title}
                  >
                    <Link href={item.url}>
                      <item.icon className="h-4 w-4" />
                      <span className="flex-1">{item.title}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel>Asistencia</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton
                  onClick={onOpenChatbot}
                  className="transition-all duration-300 hover:scale-105 hover:bg-accent/50 cursor-pointer"
                  tooltip="Asistente"
                >
                  <Brain className="h-4 w-4" />
                  <span className="flex-1">Asistente</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <SidebarMenuButton
                  size="lg"
                  className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground cursor-pointer"
                >
                  <Avatar className="h-8 w-8 rounded-lg">
                    <AvatarImage src={userData.avatar} alt={userData.name} />
                    <AvatarFallback className="rounded-lg bg-black! text-white! dark:bg-white! dark:text-black!">{initials}</AvatarFallback>
                  </Avatar>
                  <div className="grid flex-1 text-left text-sm leading-tight">
                    <span className="truncate font-semibold">{userData.name}</span>
                    <span className="truncate text-xs">{userData.email}</span>
                  </div>
                  <CaretSortIcon className="ml-auto size-4" />
                </SidebarMenuButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                className="w-[--radix-dropdown-menu-trigger-width] min-w-56 rounded-lg"
                side={isMobile ? "bottom" : "right"}
                align="end"
                sideOffset={4}
              >
                <DropdownMenuLabel className="p-0 font-normal">
                  <div className="flex items-center gap-2 px-1 py-1.5 text-left text-sm">
                    <Avatar className="h-8 w-8 rounded-lg">
                      <AvatarImage src={userData.avatar} alt={userData.name} />
                      <AvatarFallback className="rounded-lg bg-black! text-white! dark:bg-white! dark:text-black!">{initials}</AvatarFallback>
                    </Avatar>
                    <div className="grid flex-1 text-left text-sm leading-tight">
                      <span className="truncate font-semibold">{userData.name}</span>
                      <span className="truncate text-xs">{userData.email}</span>
                    </div>
                  </div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem className="cursor-pointer" onClick={() => logout()}>
                  <LogOut />
                  Log out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>

      <SidebarRail />
    </Sidebar>
  )
}
