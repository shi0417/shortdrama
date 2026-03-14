'use client'

import EpisodeCompareWorkbench from './EpisodeCompareWorkbench'

interface EpisodeComparePageProps {
  novelId: number
}

export default function EpisodeComparePage({ novelId }: EpisodeComparePageProps) {
  return (
    <div style={{ padding: 16 }}>
      <EpisodeCompareWorkbench novelId={novelId} scope="page" />
    </div>
  )
}
