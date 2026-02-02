import "./globals.css";

import { QueryProvider } from "@/components/query-provider";
import { Noto_Sans_JP, Noto_Serif_JP } from "next/font/google";

const sans = Noto_Sans_JP({
  subsets: ["latin"],
  weight: ["400", "500", "700"],
  variable: "--font-sans"
});

const serif = Noto_Serif_JP({
  subsets: ["latin"],
  weight: ["500", "700"],
  variable: "--font-serif"
});

export const metadata = {
  title: "Kataru AI",
  description: "AI商品説明ビデオ自動生成デモ"
};

export default function RootLayout({
  children
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ja" className={`${sans.variable} ${serif.variable}`}>
      <body className="font-sans">
        <QueryProvider>{children}</QueryProvider>
      </body>
    </html>
  );
}
