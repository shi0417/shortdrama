'use client'

import { useMemo } from 'react'
import { AiModelOptionDto } from '@/types/pipeline'
import {
  PipelineSecondReviewReferenceTable,
  PipelineSecondReviewTargetTable,
} from '@/types/pipeline-review'

interface PipelineSecondReviewDialogProps {
  open: boolean
  models: AiModelOptionDto[]
  loading: boolean
  submitting: boolean
  selectedModelKey: string
  userInstruction: string
  targetTables: PipelineSecondReviewTargetTable[]
  referenceTables: PipelineSecondReviewReferenceTable[]
  allowPromptEdit: boolean
  promptPreview: string
  fontSize: number
  onClose: () => void
  onChangeModelKey: (value: string) => void
  onChangeUserInstruction: (value: string) => void
  onToggleTargetTable: (table: PipelineSecondReviewTargetTable) => void
  onToggleReferenceTable: (table: PipelineSecondReviewReferenceTable) => void
  onChangeAllowPromptEdit: (value: boolean) => void
  onChangePromptPreview: (value: string) => void
  onRefreshPromptPreview: () => void
  onChangeFontSize: (value: number) => void
  onSubmit: () => void
}

const targetTableOptions: Array<{ value: PipelineSecondReviewTargetTable; label: string }> = [
  { value: 'novel_timelines', label: '时间线（novel_timelines）' },
  { value: 'novel_characters', label: '人物（novel_characters）' },
  { value: 'novel_key_nodes', label: '关键节点（novel_key_nodes）' },
  { value: 'novel_skeleton_topic_items', label: '骨架主题内容（novel_skeleton_topic_items）' },
  { value: 'novel_explosions', label: '爆点（novel_explosions）' },
]

const referenceTableOptions: Array<{
  value: PipelineSecondReviewReferenceTable
  label: string
}> = [
  { value: 'drama_novels', label: '项目基础信息（drama_novels）' },
  { value: 'drama_source_text', label: '原始素材（drama_source_text）' },
  { value: 'novel_adaptation_strategy', label: '改编策略（novel_adaptation_strategy）' },
  { value: 'adaptation_modes', label: '改编模式（adaptation_modes）' },
  { value: 'set_core', label: '核心设定（set_core）' },
]

export default function PipelineSecondReviewDialog({
  open,
  models,
  loading,
  submitting,
  selectedModelKey,
  userInstruction,
  targetTables,
  referenceTables,
  allowPromptEdit,
  promptPreview,
  fontSize,
  onClose,
  onChangeModelKey,
  onChangeUserInstruction,
  onToggleTargetTable,
  onToggleReferenceTable,
  onChangeAllowPromptEdit,
  onChangePromptPreview,
  onRefreshPromptPreview,
  onChangeFontSize,
  onSubmit,
}: PipelineSecondReviewDialogProps) {
  const selectedModel = useMemo(
    () => models.find((item) => item.modelKey === selectedModelKey) || null,
    [models, selectedModelKey]
  )

  if (!open) return null

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0, 0, 0, 0.35)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1250,
        padding: '16px',
      }}
    >
      <div
        style={{
          width: '1040px',
          maxWidth: '100%',
          maxHeight: '90vh',
          overflowY: 'auto',
          background: '#fff',
          borderRadius: '8px',
          border: '1px solid #f0f0f0',
          padding: '16px',
          display: 'flex',
          flexDirection: 'column',
          gap: '12px',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontWeight: 600, fontSize: '16px' }}>二次AI自检</div>
          <button
            onClick={onClose}
            style={{ border: 'none', background: 'transparent', color: '#1890ff', cursor: 'pointer' }}
          >
            关闭
          </button>
        </div>

        <div
          style={{
            fontSize: '12px',
            color: '#666',
            background: '#fafafa',
            border: '1px solid #f0f0f0',
            borderRadius: '6px',
            padding: '8px 10px',
            lineHeight: 1.6,
          }}
        >
          本操作会读取当前数据库中的结构化结果，结合参考资料与启用中的
          `novel_skeleton_topics` 做二次核对、补漏、去重与纠偏，并覆盖写回已勾选的目标表。
        </div>

        <label style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <span style={{ fontSize: '12px', color: '#666' }}>AI 模型</span>
          <select
            value={selectedModelKey}
            onChange={(e) => onChangeModelKey(e.target.value)}
            style={{ padding: '8px', border: '1px solid #d9d9d9', borderRadius: '4px' }}
          >
            <option value="">请选择模型</option>
            {models.map((model) => (
              <option key={model.id} value={model.modelKey}>
                {model.displayName || model.modelKey} ({model.provider || 'unknown'} /{' '}
                {model.modality || 'text'})
              </option>
            ))}
          </select>
        </label>

        {selectedModel && (
          <div style={{ fontSize: '12px', color: '#666', lineHeight: 1.6 }}>
            当前模型：`{selectedModel.modelKey}` | provider=`{selectedModel.provider || '-'}`
            {' '}| family=`{selectedModel.family || '-'}`
          </div>
        )}

        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
          <span style={{ fontSize: '12px', color: '#666' }}>字体大小</span>
          <select
            value={fontSize}
            onChange={(e) => onChangeFontSize(Number(e.target.value))}
            style={{ padding: '6px 8px', border: '1px solid #d9d9d9', borderRadius: '4px' }}
          >
            <option value={12}>小</option>
            <option value={14}>中</option>
            <option value={16}>大</option>
          </select>
        </div>

        <div>
          <div style={{ fontSize: '12px', color: '#666', marginBottom: '6px' }}>检测对象表</div>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
              gap: '8px',
              fontSize: `${fontSize}px`,
            }}
          >
            {targetTableOptions.map((item) => (
              <label key={item.value} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <input
                  type="checkbox"
                  checked={targetTables.includes(item.value)}
                  onChange={() => onToggleTargetTable(item.value)}
                />
                {item.label}
              </label>
            ))}
          </div>
          <div style={{ marginTop: '6px', fontSize: '12px', color: '#999' }}>
            若勾选 `novel_timelines`，后端会要求同时覆盖 `novel_key_nodes` 与 `novel_explosions`，避免未选中表的 timeline 关联被动变化。
          </div>
        </div>

        <div>
          <div style={{ fontSize: '12px', color: '#666', marginBottom: '6px' }}>参考资料表</div>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
              gap: '8px',
              fontSize: `${fontSize}px`,
            }}
          >
            {referenceTableOptions.map((item) => (
              <label key={item.value} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <input
                  type="checkbox"
                  checked={referenceTables.includes(item.value)}
                  onChange={() => onToggleReferenceTable(item.value)}
                />
                {item.label}
              </label>
            ))}
          </div>
          <div style={{ marginTop: '6px', fontSize: '12px', color: '#999' }}>
            系统会额外自动补充启用中的 `novel_skeleton_topics`，无需在这里手动勾选。
          </div>
        </div>

        <label style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <span style={{ fontSize: '12px', color: '#666' }}>用户附加要求</span>
          <textarea
            value={userInstruction}
            onChange={(e) => onChangeUserInstruction(e.target.value)}
            rows={4}
            placeholder="例如：重点补齐人物阵营；爆点更偏短剧节奏；topic items 不要泛化复述"
            style={{
              padding: '8px',
              border: '1px solid #d9d9d9',
              borderRadius: '4px',
              resize: 'vertical',
              fontSize: `${fontSize}px`,
            }}
          />
        </label>

        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px' }}>
            <input
              type="checkbox"
              checked={allowPromptEdit}
              onChange={(e) => onChangeAllowPromptEdit(e.target.checked)}
            />
            允许手工编辑 prompt
          </label>
          <button
            onClick={onRefreshPromptPreview}
            disabled={loading || !selectedModelKey}
            style={{
              padding: '6px 10px',
              border: '1px solid #d9d9d9',
              background: '#fff',
              borderRadius: '4px',
              cursor: loading || !selectedModelKey ? 'not-allowed' : 'pointer',
            }}
          >
            {loading ? '生成中...' : '刷新 Prompt 预览'}
          </button>
        </div>

        <label style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <span style={{ fontSize: '12px', color: '#666' }}>Prompt 预览</span>
          <textarea
            value={promptPreview}
            onChange={(e) => onChangePromptPreview(e.target.value)}
            readOnly={!allowPromptEdit}
            rows={18}
            style={{
              padding: '8px',
              border: '1px solid #d9d9d9',
              borderRadius: '4px',
              resize: 'vertical',
              fontFamily: 'monospace',
              fontSize: `${fontSize}px`,
              background: allowPromptEdit ? '#fff' : '#fafafa',
            }}
          />
        </label>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
          <button
            onClick={onClose}
            style={{
              padding: '8px 12px',
              border: '1px solid #d9d9d9',
              borderRadius: '4px',
              background: '#fff',
              cursor: 'pointer',
            }}
          >
            取消
          </button>
          <button
            onClick={onRefreshPromptPreview}
            disabled={loading || !selectedModelKey}
            style={{
              padding: '8px 12px',
              border: '1px solid #d9d9d9',
              borderRadius: '4px',
              background: '#fff',
              cursor: loading || !selectedModelKey ? 'not-allowed' : 'pointer',
            }}
          >
            刷新 Prompt 预览
          </button>
          <button
            onClick={onSubmit}
            disabled={submitting || loading || !selectedModelKey}
            style={{
              padding: '8px 12px',
              border: 'none',
              borderRadius: '4px',
              background: submitting || loading ? '#91d5ff' : '#1890ff',
              color: '#fff',
              cursor: submitting || loading || !selectedModelKey ? 'not-allowed' : 'pointer',
            }}
          >
            {submitting ? '执行中...' : '执行二次AI自检'}
          </button>
        </div>
      </div>
    </div>
  )
}
