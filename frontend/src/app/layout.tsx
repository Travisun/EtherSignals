import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Toaster } from "sonner";
import { ThemeProvider } from "next-themes";
import { Header } from "@/components/layout/header";
import { Sidebar } from "@/components/layout/sidebar";
import { MobileTabBar } from "@/components/layout/mobile-tab-bar";
import { Footer } from "@/components/layout/footer";
import { ConsentBanner } from "@/components/consent/consent-banner";
import { TelegramInvite } from "@/components/telegram/telegram-invite";
import { AnalyticsLoader } from "@/components/analytics/analytics-loader";
import { RegisterServiceWorker } from "@/components/pwa/register-sw";
import { site } from "@/lib/site";
import { env } from "@/lib/env";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";

export const metadata: Metadata = {
  metadataBase: new URL(baseUrl),
  title: {
    default: `${site.name} · ${site.tagline}`,
    template: `%s · ${site.name}`,
  },
  description: site.description,
  applicationName: site.name,
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: site.name,
    statusBarStyle: "black-translucent",
  },
  formatDetection: { telephone: false },
  icons: {
    icon: [
      { url: "/icons/favicon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/icons/favicon-16.png", sizes: "16x16", type: "image/png" },
    ],
    apple: "/icons/apple-touch-icon.png",
  },
  openGraph: {
    type: "website",
    siteName: site.name,
    title: `${site.name} · ${site.tagline}`,
    description: site.description,
    url: baseUrl,
    images: [{ url: "/og.png", width: 1200, height: 630, alt: site.name }],
  },
  twitter: {
    card: "summary_large_image",
    title: `${site.name} · ${site.tagline}`,
    description: site.description,
    images: ["/og.png"],
  },
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#050a14" },
    { media: "(prefers-color-scheme: light)", color: "#f2f6fc" },
  ],
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const vapidKey = env.vapid?.publicKey ?? "";

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: site.name,
    url: baseUrl,
    description: site.description,
    publisher: { "@type": "Organization", name: site.name },
  };

  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable}`}
      data-vapid-key={vapidKey}
    >
      <body className="flex min-h-dvh flex-col font-sans antialiased">
        <ThemeProvider
          attribute="class"
          defaultTheme="dark"
          enableSystem
          disableTransitionOnChange
        >
          <Header />
          <Sidebar />
          <main
            id="main"
            className="w-full flex-1 px-3 pb-24 pt-[calc(4rem+env(safe-area-inset-top))] sm:px-5 md:pb-8 lg:pb-10 lg:pl-[var(--sidebar-w,3.75rem)] lg:pr-6 lg:pt-[calc(1.5rem+env(safe-area-inset-top))] xl:pr-8"
          >
            {children}
          </main>
          <div className="lg:pl-[var(--sidebar-w,3.75rem)]">
            <Footer />
          </div>
          <Toaster
            position="bottom-center"
            richColors
            closeButton
            toastOptions={{
              // keep toasts clear of the home indicator / status bar
              style: { marginBottom: "env(safe-area-inset-bottom)" },
            }}
          />
          <TelegramInvite />
          <ConsentBanner />
          <MobileTabBar />
          <AnalyticsLoader />
          <RegisterServiceWorker />
        </ThemeProvider>
        <script
          type="application/ld+json"
          // Static, server-generated JSON; no user input is interpolated.
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
      </body>
    </html>
  );
}
