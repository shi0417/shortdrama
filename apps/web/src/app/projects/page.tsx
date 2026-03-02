'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

export default function ProjectsPage() {
  const router = useRouter()
  const [username, setUsername] = useState<string>('')

  useEffect(() => {
    const token = localStorage.getItem('accessToken')
    if (!token) {
      router.push('/login')
      return
    }

    try {
      const payload = JSON.parse(atob(token.split('.')[1]))
      setUsername(payload.username || 'User')
    } catch (error) {
      console.error('Failed to parse token:', error)
      setUsername('User')
    }
  }, [router])

  const handleLogout = () => {
    localStorage.removeItem('accessToken')
    router.push('/login')
  }

  return (
    <div style={{
      minHeight: '100vh',
      background: '#f5f5f5',
    }}>
      <header style={{
        background: 'white',
        padding: '20px 40px',
        boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
      }}>
        <h1 style={{ margin: 0, fontSize: '24px', color: '#333' }}>
          短剧管理系统
        </h1>
        <div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
          <span style={{ color: '#666' }}>欢迎, {username}</span>
          <button
            onClick={handleLogout}
            style={{
              padding: '8px 20px',
              background: '#667eea',
              color: 'white',
              border: 'none',
              borderRadius: '6px',
              cursor: 'pointer',
              fontSize: '14px',
            }}
          >
            退出登录
          </button>
        </div>
      </header>
      <main style={{
        padding: '40px',
        maxWidth: '1200px',
        margin: '0 auto',
      }}>
        <div style={{
          background: 'white',
          padding: '40px',
          borderRadius: '12px',
          boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
          textAlign: 'center',
        }}>
          <h2 style={{ color: '#333', marginBottom: '20px' }}>项目列表</h2>
          <p style={{ color: '#666', fontSize: '16px' }}>
            登录成功！项目列表功能开发中...
          </p>
        </div>
      </main>
    </div>
  )
}
