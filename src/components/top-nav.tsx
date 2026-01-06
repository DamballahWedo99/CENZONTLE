"use client"

import { NavSimple } from "@/components/nav-simple"
import { FileCheck, FileText } from "lucide-react"

const topNavItems = [
  {
    title: "Aprobaciones",
    url: "/aprobacion",
    icon: FileCheck,
  },
  {
    title: "Reportes",
    url: "/reportes",
    icon: FileText,
  },
]

export function TopNav() {
  return (
    <header className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="container flex h-14 items-center px-4">
        <NavSimple items={topNavItems} />
      </div>
    </header>
  )
}
