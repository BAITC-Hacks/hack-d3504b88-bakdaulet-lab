import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = { title: "EKT Assistant", description: "Прототип консультанта по каталогу электротоваров" };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="ru"><body>{children}</body></html>;
}
