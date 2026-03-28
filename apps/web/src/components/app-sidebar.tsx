"use client"

import * as React from "react"
import Link from "next/link"
import Image from "next/image"
import { usePathname } from "next/navigation"
import { useState } from "react"
import {
  FolderKanban,
  Grid3X3,
  LogOut,
  Settings,
  GitBranch,
  Bot,
  GitPullRequest,
  TestTube2,
  DollarSign,
  ScrollText,
  Brain,
  Rocket,
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
import { SidebarLogo } from "@/components/sidebar-logo"


import { useAuthContext } from "@/context/AuthContext"
import { USER_ROLE_LABELS } from "@cenzontle/shared"
import { Badge } from "@/components/ui/badge"

const proyectosItems = [
  {
    title: "Proyectos",
    url: "/proyectos",
    icon: FolderKanban,
    description: "Dashboard de proyectos",
  },
  {
    title: "Matriz",
    url: "/proyectos/matriz",
    icon: Grid3X3,
    description: "Matriz de proyectos",
  },
]

const factoryItems = [
  { title: "Overview", url: "/factory", icon: GitBranch },
  { title: "Agents", url: "/factory/agents", icon: Bot },
  { title: "Pull Requests", url: "/factory/prs", icon: GitPullRequest },
  { title: "Tests", url: "/factory/tests", icon: TestTube2 },
  { title: "Release Board", url: "/factory/release-board", icon: Rocket },
  { title: "Cost", url: "/factory/cost", icon: DollarSign },
  { title: "Logs", url: "/factory/logs", icon: ScrollText },
  { title: "Evolution", url: "/factory/evolution", icon: Brain },
]

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  const pathname = usePathname()
  const { user, logout } = useAuth()
  const { state, isMobile } = useSidebar()


  const { currentUser } = useAuthContext()

  // Prepare user data
  const userData = {
    name: user?.name || user?.email?.split('@')[0] || 'Usuario',
    email: user?.email || 'user@aeromexico.com',
    avatar: '/avatars/user.jpg',
  }

  // Generate user initials from name or email
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
          <div className="flex items-center justify-center px-3">
            <Image
              src="/Logo.svg"
              alt="Aeroméxico"
              width={153}
              height={25}
              className="object-contain dark:invert"
            />
          </div>
        )}
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Proyectos</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {proyectosItems.map((item) => (
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
          <SidebarGroupLabel>Factory</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {factoryItems.map((item) => (
                <SidebarMenuItem key={item.url}>
                  <SidebarMenuButton
                    asChild
                    isActive={pathname === item.url || (item.url !== '/factory' && pathname?.startsWith(item.url + '/'))}
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
                    <span className="truncate text-xs">{currentUser ? USER_ROLE_LABELS[currentUser.role] : userData.email}</span>
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
                <DropdownMenuItem className="cursor-pointer" asChild>
                  <Link href="/factory/settings">
                    <Settings />
                    Configuración
                  </Link>
                </DropdownMenuItem>
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
