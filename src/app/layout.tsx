import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { SidebarProvider } from "@/components/ui/sidebar";
import { ConditionalSidebar } from "@/components/conditional-sidebar";
import { DashboardHeader } from "@/components/dashboard-header";
import { ThemeProvider } from "@/components/theme-provider";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Aeroméxico - Dashboard",
  description: "Sistema de gestión Aeroméxico",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          <SidebarProvider defaultOpen={false}>
            <ConditionalSidebar />
            <div className="flex flex-1 flex-col w-full h-screen overflow-hidden">
              {/* Dashboard Header with Sidebar Toggle & Theme Toggle */}
              <DashboardHeader />

              <main className="flex-1 w-full overflow-x-hidden overflow-y-auto">
                {children}
              </main>
            </div>
          </SidebarProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
