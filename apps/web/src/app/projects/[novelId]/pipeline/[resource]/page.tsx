'use client'

import { useParams } from 'next/navigation'
import PipelineResourceManagerPage from '@/components/pipeline/PipelineResourceManagerPage'
import {
  PipelineResourceName,
  PIPELINE_RESOURCE_CONFIG,
} from '@/types/pipeline-resource'

export default function PipelineResourcePage() {
  const params = useParams<{ novelId: string; resource: string }>()
  const novelId = Number(params?.novelId)
  const resource = params?.resource as PipelineResourceName

  if (!Number.isInteger(novelId) || novelId <= 0 || !(resource in PIPELINE_RESOURCE_CONFIG)) {
    return (
      <div style={{ padding: '24px', color: '#ff4d4f' }}>
        Invalid pipeline resource route.
      </div>
    )
  }

  return <PipelineResourceManagerPage novelId={novelId} resource={resource} />
}
