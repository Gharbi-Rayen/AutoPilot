import type { Metadata } from "next";
import { Bricolage_Grotesque, Hanken_Grotesk, JetBrains_Mono } from "next/font/google";
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

const bricolage = Bricolage_Grotesque({
  variable: "--font-bricolage",
  subsets: ["latin"],
  weight: ["700"],
  display: "swap",
});

const hanken = Hanken_Grotesk({
  variable: "--font-hanken",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
});

const jetbrains = JetBrains_Mono({
  variable: "--font-jetbrains",
  subsets: ["latin"],
  weight: ["400", "500"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "AutoPilot",
  description: "Offline workflow automation for CSV and document processing",
  manifest: "/manifest.json",
  icons: {
    icon: [
      { url: "/icons/icon.svg", type: "image/svg+xml" },
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
    shortcut: "/icons/icon-192.png",
  },
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
        className={`${bricolage.variable} ${hanken.variable} ${jetbrains.variable} antialiased`}
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
