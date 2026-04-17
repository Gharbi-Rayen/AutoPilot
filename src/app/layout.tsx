import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Script from "next/script";
import "./globals.css";
import { Provider } from "jotai";
import { NuqsAdapter } from "nuqs/adapters/next/app";
import { LocaleHtmlAttrs } from "@/components/locale-html-attrs";
import { PwaInstallPrompt } from "@/components/pwa-install-prompt";
import { QueryProvider } from "@/components/query-provider";
import { StoragePersist } from "@/components/storage-persist";
import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@/components/ui/sonner";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "AutoPilot",
  description: "Offline workflow automation for CSV and document processing",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "AutoPilot",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <Script src="/sw-register.js" strategy="afterInteractive" />
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          <NuqsAdapter>
            <Provider>
              <QueryProvider>
                <LocaleHtmlAttrs />
                {children}
                <Toaster position="top-right" />
                <PwaInstallPrompt />
                <StoragePersist />
              </QueryProvider>
            </Provider>
          </NuqsAdapter>
        </ThemeProvider>
      </body>
    </html>
  );
}
