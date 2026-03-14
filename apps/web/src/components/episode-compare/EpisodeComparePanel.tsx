'use client'

import EpisodeCompareWorkbench from './EpisodeCompareWorkbench'

interface EpisodeComparePanelProps {
  novelId: number
  novelName?: string
}

export default function EpisodeComparePanel({ novelId, novelName }: EpisodeComparePanelProps) {
  return <EpisodeCompareWorkbench novelId={novelId} novelName={novelName} scope="panel" compact />
}
