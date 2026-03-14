'use client'

import { useParams } from 'next/navigation'
import ShotBoardPage from '@/components/production/ShotBoardPage'

export default function ShotBoardRoutePage() {
  const params = useParams<{ novelId: string; episodeNumber: string }>()
  const novelId = Number(params?.novelId)
  const episodeNumber = Number(params?.episodeNumber)
  if (!Number.isInteger(novelId) || novelId <= 0) {
    return <div style={{ padding: 24, color: '#ff4d4f' }}>Invalid novel id</div>
  }
  if (!Number.isInteger(episodeNumber) || episodeNumber <= 0) {
    return <div style={{ padding: 24, color: '#ff4d4f' }}>Invalid episode number</div>
  }
  return <ShotBoardPage novelId={novelId} episodeNumber={episodeNumber} />
}
