import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: '短剧管理系统',
  description: 'ShortDrama Management System',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="zh-CN">
      <body style={{ margin: 0, fontFamily: 'system-ui, sans-serif' }}>
        {children}
      </body>
    </html>
  )
}
