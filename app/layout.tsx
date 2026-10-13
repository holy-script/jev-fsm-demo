import type { ReactNode } from "react";

export const metadata = { title: "Jev vs Human" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, background: "#0d1117", color: "#e6edf3", fontFamily: "ui-monospace, monospace" }}>
        {children}
      </body>
    </html>
  );
}
