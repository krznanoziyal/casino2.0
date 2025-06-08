import './globals.css'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Casino War Pro - Professional Gaming System',
  description: 'Professional Casino War game for real casino operations',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body className="bg-gradient-to-br from-casino-green via-green-800 to-casino-darkGreen min-h-screen">
        {children}
      </body>
    </html>
  )
}