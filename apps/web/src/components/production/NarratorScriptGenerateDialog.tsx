'use client'

import type { NarratorScriptReferenceSummaryItem } from '@/types/episode-script'
import { NARRATOR_CORE_REFERENCE_TABLES } from '@/types/episode-script'
import type { AiModelOptionDto } from '@/types/pipeline'

/** 扩展参考表选项（请求体 referenceTables 只传此类）；核心三表由后端固定读取，不在此列 */
const NARRATOR_OPTIONAL_REFERENCE_TABLE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'set_core', label: '核心设定（set_core）' },
  { value: 'set_payoff_arch', label: '爽点架构（set_payoff_arch）' },
  { value: 'set_payoff_lines', label: '爽点线（set_payoff_lines）' },
  { value: 'set_opponents', label: '对手明细（set_opponents）' },
  { value: 'set_power_ladder', label: '权力升级（set_power_ladder）' },
  { value: 'set_story_phases', label: '故事阶段（set_story_phases）' },
  { value: 'novel_characters', label: '人物（novel_characters）' },
  { value: 'novel_key_nodes', label: '关键节点（novel_key_nodes）' },
  { value: 'novel_timelines', label: '时间线（novel_timelines）' },
  { value: 'novel_source_segments', label: '素材切片（novel_source_segments）' },
  { value: 'drama_source_text', label: '原始素材（drama_source_text）' },
  { value: 'novel_adaptation_strategy', label: '改编策略（novel_adaptation_strategy）' },
  { value: 'drama_novels', label: '项目主信息（drama_novels）' },
]

export interface NarratorScriptGenerateDialogProps {
  open: boolean
  /** 模型列表，来源 pipelineAiApi.listAiModelOptions() / ai-model-catalog */
  models: AiModelOptionDto[]
  modelKey: string
  batchSize: number
  startEpisode: number
  endEpisode: number
  referenceTables: string[]
  sourceTextCharBudget: number
  userInstruction: string
  allowPromptEdit: boolean
  promptPreview: string
  referenceSummary: NarratorScriptReferenceSummaryItem[]
  warnings: string[]
  validationWarnings?: string[]
  previewLoading: boolean
  generating: boolean
  persisting: boolean
  hasDraft: boolean
  onClose: () => void
  onChangeModelKey: (v: string) => void
  onChangeBatchSize: (v: number) => void
  onChangeStartEpisode: (v: number) => void
  onChangeEndEpisode: (v: number) => void
  onToggleReferenceTable: (v: string) => void
  onChangeSourceTextCharBudget: (v: number) => void
  onChangeUserInstruction: (v: string) => void
  onChangeAllowPromptEdit: (v: boolean) => void
  onChangePromptPreview: (v: string) => void
  onRefreshPromptPreview: () => void
  onGenerateDraft: () => void
  onPersistDraft: () => void
}

export default function NarratorScriptGenerateDialog({
  open,
  models,
  modelKey,
  batchSize,
  startEpisode,
  endEpisode,
  referenceTables,
  sourceTextCharBudget,
  userInstruction,
  allowPromptEdit,
  promptPreview,
  referenceSummary,
  warnings,
  validationWarnings = [],
  previewLoading,
  generating,
  persisting,
  hasDraft,
  onClose,
  onChangeModelKey,
  onChangeBatchSize,
  onChangeStartEpisode,
  onChangeEndEpisode,
  onToggleReferenceTable,
  onChangeSourceTextCharBudget,
  onChangeUserInstruction,
  onChangeAllowPromptEdit,
  onChangePromptPreview,
  onRefreshPromptPreview,
  onGenerateDraft,
  onPersistDraft,
}: NarratorScriptGenerateDialogProps) {
  if (!open) return null

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.35)',
        zIndex: 1300,
        padding: 16,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <div
        style={{
          width: 960,
          maxWidth: '95%',
          maxHeight: '92vh',
          background: '#fff',
          borderRadius: 8,
          border: '1px solid #f0f0f0',
          padding: 16,
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontWeight: 600, fontSize: 16 }}>生成旁白主导脚本初稿</div>
          <button type="button" onClick={onClose} style={{ border: 'none', background: 'transparent', color: '#1890ff', cursor: 'pointer' }}>
            关闭
          </button>
        </div>

        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', paddingRight: 8, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0,1fr))', gap: 10 }}>
            <label style={{ fontSize: 12 }}>
              AI 模型
              <select
                value={modelKey}
                onChange={(e) => onChangeModelKey(e.target.value)}
                style={{ width: '100%', padding: 6, marginTop: 4 }}
              >
                <option value="">不填用后端默认</option>
                {models.map((m) => (
                  <option key={m.id ?? m.modelKey} value={m.modelKey}>
                    {m.displayName || m.modelKey}
                  </option>
                ))}
                {modelKey && !models.some((m) => m.modelKey === modelKey) && (
                  <option value={modelKey}>当前：{modelKey}</option>
                )}
              </select>
            </label>
            <label style={{ fontSize: 12 }}>
              每批集数
              <input
                type="number"
                min={1}
                value={batchSize}
                onChange={(e) => onChangeBatchSize(Number(e.target.value) || 5)}
                style={{ width: '100%', padding: 6, marginTop: 4 }}
              />
            </label>
            <label style={{ fontSize: 12 }}>
              起始集（含）
              <input
                type="number"
                min={1}
                value={startEpisode}
                onChange={(e) => onChangeStartEpisode(Number(e.target.value) || 1)}
                style={{ width: '100%', padding: 6, marginTop: 4 }}
              />
            </label>
            <label style={{ fontSize: 12 }}>
              结束集（含）
              <input
                type="number"
                min={1}
                value={endEpisode}
                onChange={(e) => onChangeEndEpisode(Number(e.target.value) || 5)}
                style={{ width: '100%', padding: 6, marginTop: 4 }}
              />
            </label>
          </div>

          <label style={{ fontSize: 12 }}>
            素材预算（chars）
            <input
              type="number"
              min={1000}
              max={120000}
              value={sourceTextCharBudget}
              onChange={(e) => onChangeSourceTextCharBudget(Number(e.target.value) || 25000)}
              style={{ width: '100%', padding: 6, marginTop: 4 }}
            />
          </label>

          <div style={{ border: '1px solid #e6f7ff', borderRadius: 6, padding: 10, background: '#f0f9ff' }}>
            <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 6 }}>核心参考（始终包含）</div>
            <div style={{ fontSize: 12, color: '#666', marginBottom: 6 }}>生成时始终包含以下三表，无需勾选</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {NARRATOR_CORE_REFERENCE_TABLES.map((item) => (
                <span
                  key={item.value}
                  style={{ padding: '4px 10px', background: '#fff', border: '1px solid #91d5ff', borderRadius: 4, fontSize: 12 }}
                >
                  ✓ {item.label}
                </span>
              ))}
            </div>
          </div>
          <div style={{ border: '1px solid #f0f0f0', borderRadius: 6, padding: 10 }}>
            <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 8 }}>扩展参考（多选）</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0,1fr))', gap: 6 }}>
              {NARRATOR_OPTIONAL_REFERENCE_TABLE_OPTIONS.map((item) => (
                <label key={item.value} style={{ fontSize: 12 }}>
                  <input
                    type="checkbox"
                    checked={referenceTables.includes(item.value)}
                    onChange={() => onToggleReferenceTable(item.value)}
                  />{' '}
                  {item.label}
                </label>
              ))}
            </div>
          </div>

          <div>
            <div style={{ fontSize: 12, marginBottom: 4 }}>用户附加要求</div>
            <textarea
              value={userInstruction}
              onChange={(e) => onChangeUserInstruction(e.target.value)}
              rows={2}
              style={{ width: '100%', border: '1px solid #d9d9d9', borderRadius: 4, padding: 8 }}
            />
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <label style={{ fontSize: 12 }}>
              <input
                type="checkbox"
                checked={allowPromptEdit}
                onChange={(e) => onChangeAllowPromptEdit(e.target.checked)}
              />{' '}
              允许编辑 Prompt
            </label>
            <button
              type="button"
              onClick={onRefreshPromptPreview}
              disabled={previewLoading || generating || persisting}
              style={{ padding: '6px 10px', border: '1px solid #1890ff', color: '#1890ff', background: 'white', borderRadius: 4, cursor: 'pointer' }}
            >
              {previewLoading ? '刷新中...' : '刷新 Prompt 预览'}
            </button>
          </div>

          <div style={{ border: '1px solid #f0f0f0', borderRadius: 6, padding: 10 }}>
            <div style={{ fontSize: 12, color: '#666', marginBottom: 8 }}>
              Prompt 预览（{promptPreview.length.toLocaleString()} chars）
            </div>
            <textarea
              value={promptPreview}
              onChange={(e) => onChangePromptPreview(e.target.value)}
              readOnly={!allowPromptEdit}
              style={{
                width: '100%',
                minHeight: 320,
                maxHeight: 400,
                fontSize: 13,
                lineHeight: 1.5,
                border: '1px solid #d9d9d9',
                borderRadius: 4,
                padding: 8,
                background: allowPromptEdit ? '#fff' : '#fafafa',
                fontFamily: 'monospace',
                resize: 'vertical',
              }}
            />
          </div>

          {referenceSummary.length > 0 && (
            <div style={{ border: '1px solid #f0f0f0', borderRadius: 6, padding: 10, fontSize: 12 }}>
              <div style={{ fontWeight: 600, marginBottom: 6 }}>参考摘要</div>
              {referenceSummary.map((item, idx) => (
                <div key={`${item.table}-${idx}`} style={{ marginBottom: 4 }}>
                  {item.label}：{item.rowCount} 条；字段：{item.fields?.join(', ') || '-'}
                  {item.usedChars != null ? `；${item.usedChars} chars` : ''}
                </div>
              ))}
            </div>
          )}

          {warnings.length > 0 && (
            <div style={{ border: '1px solid #ffa940', borderRadius: 6, padding: 10, fontSize: 12, background: '#fff7e6' }}>
              <div style={{ fontWeight: 600, marginBottom: 4 }}>提示</div>
              {warnings.map((w, i) => (
                <div key={i}>{w}</div>
              ))}
            </div>
          )}

          {validationWarnings.length > 0 && (
            <div style={{ border: '1px solid #ffc069', borderRadius: 6, padding: 10, fontSize: 12, background: '#fffbe6' }}>
              <div style={{ fontWeight: 600, marginBottom: 4 }}>校验提示</div>
              {validationWarnings.map((w, i) => (
                <div key={i}>{w}</div>
              ))}
            </div>
          )}
        </div>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', borderTop: '1px solid #f0f0f0', paddingTop: 12 }}>
          <button
            type="button"
            onClick={onGenerateDraft}
            disabled={previewLoading || generating || persisting}
            style={{ padding: '8px 16px', background: '#1890ff', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer' }}
          >
            {generating ? '生成中...' : '生成草稿'}
          </button>
          {hasDraft && (
            <button
              type="button"
              onClick={onPersistDraft}
              disabled={previewLoading || generating || persisting}
              style={{ padding: '8px 16px', background: '#52c41a', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer' }}
            >
              {persisting ? '保存中...' : '保存草稿'}
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            style={{ padding: '8px 16px', background: 'transparent', color: '#666', border: '1px solid #d9d9d9', borderRadius: 6, cursor: 'pointer' }}
          >
            取消
          </button>
        </div>
      </div>
    </div>
  )
}

export { NARRATOR_OPTIONAL_REFERENCE_TABLE_OPTIONS }
