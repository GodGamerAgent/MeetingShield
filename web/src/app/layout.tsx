import type { Metadata } from "next";
import "./globals.css";
import Sidebar from "@/components/Sidebar";
import TopNavbar from "@/components/TopNavbar";

export const metadata: Metadata = {
  title: "AURA-MEET | On-Device Smart Meeting Intelligence & Behavioral Copilot",
  description: "Next-generation on-device meeting intelligence, Granola-style note taking, and behavioral response copilot powered by Gemma 4",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased text-aura-charcoal selection:bg-aura-peach selection:text-white">
        <div className="min-h-screen flex">
          {/* Floating Sidebar */}
          <Sidebar />

          {/* Main Area */}
          <main className="flex-1 lg:pl-72 p-4 lg:p-6 max-w-7xl mx-auto flex flex-col min-h-screen">
            <TopNavbar />
            <div className="flex-1 pb-12">
              {children}
            </div>
          </main>
        </div>
      </body>
    </html>
  );
}
