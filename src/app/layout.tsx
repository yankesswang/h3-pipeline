import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Sidebar } from "@/components/sidebar";
import { StudioProvider } from "@/components/studio-provider";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#0d0e11",
};

export const metadata: Metadata = {
  title: "Comfy Studio",
  description: "A friendlier front end for ComfyUI",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="zh-Hant" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="flex h-full flex-col-reverse overflow-hidden font-sans text-sm md:flex-row">
        <StudioProvider>
          <Sidebar />
          <main className="min-h-0 min-w-0 flex-1 overflow-hidden">{children}</main>
        </StudioProvider>
      </body>
    </html>
  );
}
