'use client'

import { useParams } from 'next/navigation'
import EpisodeScriptsPage from '@/components/production/EpisodeScriptsPage'

export default function EpisodeScriptsRoutePage() {
  const params = useParams<{ novelId: string }>()
  const novelId = Number(params?.novelId)
  if (!Number.isInteger(novelId) || novelId <= 0) {
    return <div style={{ padding: 24, color: '#ff4d4f' }}>Invalid novel id</div>
  }
  return <EpisodeScriptsPage novelId={novelId} />
}
