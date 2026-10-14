import type { Metadata, Viewport } from "next";
import { Geist, Inter } from "next/font/google";
import "./globals.css";
import RouteProgress from "./route-progress";

/* Same pairing as the BluePass app: Geist carries display type, Inter carries body copy. */
const geist = Geist({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-geist",
  display: "swap"
});

const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-inter",
  display: "swap"
});

export const metadata: Metadata = {
  title: "Kai | BluePass booking engine",
  description: "Kai is the booking engine and operations console behind BluePass."
};

export const viewport: Viewport = {
  themeColor: "#0a0a09"
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${geist.variable} ${inter.variable}`}>
      <body>
        <RouteProgress />
        {children}
      </body>
    </html>
  );
}
