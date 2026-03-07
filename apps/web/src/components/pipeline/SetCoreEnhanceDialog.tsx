'use client'

import { useMemo, useState } from 'react'
import { AiModelOptionDto } from '@/types/pipeline'

interface SetCoreEnhanceDialogProps {
  open: boolean
  models: AiModelOptionDto[]
  loading: boolean
  submitting: boolean
  saveBehaviorDescription: string
  selectedModelKey: string
  userInstruction: string
  referenceTables: string[]
  allowPromptEdit: boolean
  promptPreview: string
  onClose: () => void
  onChangeModelKey: (value: string) => void
  onChangeUserInstruction: (value: string) => void
  onToggleReferenceTable: (table: string) => void
  onChangeAllowPromptEdit: (value: boolean) => void
  onChangePromptPreview: (value: string) => void
  onRefreshPromptPreview: () => void
  onSubmit: () => void
}

const referenceTableOptions = [
  { value: 'drama_source_text', label: '背景原始资料（drama_source_text）' },
  { value: 'novel_timelines', label: '时间线（novel_timelines）' },
  { value: 'novel_characters', label: '人物（novel_characters）' },
  { value: 'novel_key_nodes', label: '关键节点（novel_key_nodes）' },
  { value: 'novel_skeleton_topics', label: '骨架主题（novel_skeleton_topics）' },
  { value: 'novel_skeleton_topic_items', label: '骨架主题详情（novel_skeleton_topic_items）' },
  { value: 'novel_explosions', label: '爆点（novel_explosions）' },
  { value: 'novel_adaptation_strategy', label: '改编策略（novel_adaptation_strategy）' },
  { value: 'adaptation_modes', label: '改编模式（adaptation_modes）' },
]

export default function SetCoreEnhanceDialog({
  open,
  models,
  loading,
  submitting,
  saveBehaviorDescription,
  selectedModelKey,
  userInstruction,
  referenceTables,
  allowPromptEdit,
  promptPreview,
  onClose,
  onChangeModelKey,
  onChangeUserInstruction,
  onToggleReferenceTable,
  onChangeAllowPromptEdit,
  onChangePromptPreview,
  onRefreshPromptPreview,
  onSubmit,
}: SetCoreEnhanceDialogProps) {
  const [showPromptPreview, setShowPromptPreview] = useState(true)

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
        zIndex: 1100,
        padding: '16px',
      }}
    >
      <div
        style={{
          width: '920px',
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
          <div style={{ fontWeight: 600, fontSize: '16px' }}>set_core AI 完善对话框</div>
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
          }}
        >
          {saveBehaviorDescription}
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
                {model.displayName || model.modelKey} ({model.provider || 'unknown'} / {model.modality || 'text'})
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

        <label style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <span style={{ fontSize: '12px', color: '#666' }}>用户附加要求</span>
          <textarea
            value={userInstruction}
            onChange={(e) => onChangeUserInstruction(e.target.value)}
            rows={4}
            placeholder="可选：补充你希望 AI 如何完善核心设定"
            style={{ padding: '8px', border: '1px solid #d9d9d9', borderRadius: '4px', resize: 'vertical' }}
          />
        </label>

        <div>
          <div style={{ fontSize: '12px', color: '#666', marginBottom: '6px' }}>参考资料</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '8px' }}>
            {referenceTableOptions.map((item) => (
              <label key={item.value} style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px' }}>
                <input
                  type="checkbox"
                  checked={referenceTables.includes(item.value)}
                  onChange={() => onToggleReferenceTable(item.value)}
                />
                {item.label}
              </label>
            ))}
          </div>
        </div>

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
            onClick={() => setShowPromptPreview((prev) => !prev)}
            style={{ border: 'none', background: 'transparent', color: '#1890ff', cursor: 'pointer', padding: 0 }}
          >
            {showPromptPreview ? '收起 Prompt 预览' : '展开 Prompt 预览'}
          </button>
          <button
            onClick={onRefreshPromptPreview}
            disabled={loading}
            style={{
              padding: '6px 10px',
              border: '1px solid #d9d9d9',
              background: '#fff',
              borderRadius: '4px',
              cursor: loading ? 'not-allowed' : 'pointer',
            }}
          >
            {loading ? '生成中...' : '刷新 Prompt 预览'}
          </button>
        </div>

        {showPromptPreview && (
          <label style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <span style={{ fontSize: '12px', color: '#666' }}>Prompt 预览</span>
            <textarea
              value={promptPreview}
              onChange={(e) => onChangePromptPreview(e.target.value)}
              readOnly={!allowPromptEdit}
              rows={16}
              style={{
                padding: '8px',
                border: '1px solid #d9d9d9',
                borderRadius: '4px',
                resize: 'vertical',
                fontFamily: 'monospace',
                fontSize: '12px',
                background: allowPromptEdit ? '#fff' : '#fafafa',
              }}
            />
          </label>
        )}

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
            onClick={onSubmit}
            disabled={submitting || loading || !selectedModelKey}
            style={{
              padding: '8px 12px',
              border: 'none',
              borderRadius: '4px',
              background: submitting || loading ? '#91d5ff' : '#1890ff',
              color: '#fff',
              cursor: submitting || loading ? 'not-allowed' : 'pointer',
            }}
          >
            {submitting ? '生成中...' : '生成并回填'}
          </button>
        </div>
      </div>
    </div>
  )
}
