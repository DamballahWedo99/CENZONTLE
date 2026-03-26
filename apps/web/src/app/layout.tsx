import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { SidebarProvider } from "@/components/ui/sidebar";
import { FullscreenOrChrome } from "@/components/fullscreen-or-chrome";
import { ThemeProvider } from "@/components/theme-provider";
import { BreadcrumbProvider } from "@/context/BreadcrumbContext";
import { HeaderActionsProvider } from "@/context/HeaderActionsContext";
import { IntegrationsProvider } from "@/context/IntegrationsContext";
import { AuthProvider } from "@/context/AuthContext";

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
          <AuthProvider>
          <BreadcrumbProvider>
            <HeaderActionsProvider>
              <IntegrationsProvider>
                <SidebarProvider defaultOpen={false}>
                  <FullscreenOrChrome>
                    {children}
                  </FullscreenOrChrome>
                </SidebarProvider>
              </IntegrationsProvider>
            </HeaderActionsProvider>
          </BreadcrumbProvider>
          </AuthProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
