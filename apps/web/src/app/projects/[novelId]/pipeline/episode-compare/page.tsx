'use client'

import { useParams } from 'next/navigation'
import EpisodeComparePage from '@/components/episode-compare/EpisodeComparePage'

export default function EpisodeCompareRoutePage() {
  const params = useParams<{ novelId: string }>()
  const novelId = Number(params?.novelId)
  if (!Number.isInteger(novelId) || novelId <= 0) {
    return <div style={{ padding: 24, color: '#ff4d4f' }}>Invalid novel id</div>
  }
  return <EpisodeComparePage novelId={novelId} />
}
