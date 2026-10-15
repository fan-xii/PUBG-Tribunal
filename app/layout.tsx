import type { Metadata } from "next";
import "./vote.css";

export const metadata: Metadata = {
  title: "背锅小队 · PUBG 赛后投票",
  description: "四个人的赛后审判。创建车队，匿名或实名投票，一起揭晓本局战犯。",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body className="antialiased">{children}</body>
    </html>
  );
}
