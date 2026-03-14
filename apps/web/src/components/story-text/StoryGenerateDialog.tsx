'use client'

import type { AiModelOptionDto } from '@/types/pipeline'
import type {
  EpisodeStoryDraft,
  EpisodeStoryReferenceSummaryItem,
  EpisodeStoryReferenceTable,
  EpisodeStoryBatchInfo,
  StoryCheckReportDto,
} from '@/types/episode-story'

const CORE_REFERENCE_LABELS = 'novel_episodes、drama_structure_template、novel_hook_rhythm（始终包含）'

const EXTENSION_REFERENCE_OPTIONS: Array<{ value: EpisodeStoryReferenceTable; label: string }> = [
  { value: 'drama_novels', label: '项目主信息' },
  { value: 'set_core', label: '核心设定' },
  { value: 'novel_characters', label: '人物' },
  { value: 'novel_key_nodes', label: '关键节点' },
  { value: 'novel_timelines', label: '时间线' },
  { value: 'set_payoff_arch', label: '爽点架构' },
  { value: 'set_payoff_lines', label: '爽点线' },
  { value: 'set_opponents', label: '对手明细' },
  { value: 'set_power_ladder', label: '权力阶梯' },
  { value: 'set_story_phases', label: '故事阶段' },
  { value: 'novel_adaptation_strategy', label: '改编策略' },
  { value: 'adaptation_modes', label: '改编模式' },
  { value: 'novel_explosions', label: '爆点' },
  { value: 'novel_skeleton_topics', label: '骨架主题' },
  { value: 'novel_skeleton_topic_items', label: '骨架主题详情' },
  { value: 'novel_source_segments', label: '素材切片' },
  { value: 'drama_source_text', label: '原始素材补充' },
  { value: 'set_opponent_matrix', label: '对手矩阵' },
  { value: 'set_traitor_system', label: '内鬼系统' },
  { value: 'set_traitors', label: '内鬼角色' },
  { value: 'set_traitor_stages', label: '内鬼阶段' },
]

export interface StoryGenerateDialogProps {
  open: boolean
  onClose: () => void
  novelId: number
  models: AiModelOptionDto[]
  loading: boolean
  generating: boolean
  persisting: boolean
  checking: boolean
  selectedModelKey: string
  referenceTables: EpisodeStoryReferenceTable[]
  userInstruction: string
  allowPromptEdit: boolean
  promptPreview: string
  sourceTextCharBudget: number
  referenceSummary: EpisodeStoryReferenceSummaryItem[]
  draft: EpisodeStoryDraft | null
  draftId: string | undefined
  warnings: string[]
  generatingPhase: string
  targetEpisodeCount: number
  actualEpisodeCount: number | undefined
  batchInfo: EpisodeStoryBatchInfo[] | undefined
  finalCompletenessOk: boolean | undefined
  checkReport: StoryCheckReportDto | null
  onSelectModelKey: (value: string) => void
  onToggleReferenceTable: (value: EpisodeStoryReferenceTable) => void
  onUserInstructionChange: (value: string) => void
  onAllowPromptEditChange: (value: boolean) => void
  onPromptPreviewChange: (value: string) => void
  onSourceTextCharBudgetChange: (value: number) => void
  onRefreshPromptPreview: () => void
  onGenerateDraft: () => void
  onCheck: () => void
  onPersistDraft: () => void
}

export default function StoryGenerateDialog({
  open,
  onClose,
  models,
  loading,
  generating,
  persisting,
  checking,
  selectedModelKey,
  referenceTables,
  userInstruction,
  allowPromptEdit,
  promptPreview,
  sourceTextCharBudget,
  referenceSummary,
  draft,
  draftId,
  warnings,
  generatingPhase,
  targetEpisodeCount,
  actualEpisodeCount,
  batchInfo,
  finalCompletenessOk,
  checkReport,
  onSelectModelKey,
  onToggleReferenceTable,
  onUserInstructionChange,
  onAllowPromptEditChange,
  onPromptPreviewChange,
  onSourceTextCharBudgetChange,
  onRefreshPromptPreview,
  onGenerateDraft,
  onCheck,
  onPersistDraft,
}: StoryGenerateDialogProps) {
  if (!open) return null

  const episodeCount = draft?.episodes?.length ?? 0

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
          width: 1280,
          maxWidth: '95%',
          height: '92vh',
          background: '#fff',
          borderRadius: 8,
          border: '1px solid #f0f0f0',
          padding: 16,
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
        }}
      >
        <div
          style={{
            flex: 1,
            minHeight: 0,
            overflowY: 'auto',
            paddingRight: 8,
            paddingBottom: 12,
            display: 'flex',
            flexDirection: 'column',
            gap: 12,
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ fontWeight: 600, fontSize: 16 }}>生成完整故事</div>
            <button
              type="button"
              onClick={onClose}
              style={{ border: 'none', background: 'transparent', color: '#1890ff', cursor: 'pointer' }}
            >
              关闭
            </button>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0,1fr))', gap: 10 }}>
            <label style={{ fontSize: 12 }}>
              AI 模型
              <select
                value={selectedModelKey}
                onChange={(e) => onSelectModelKey(e.target.value)}
                style={{ width: '100%' }}
              >
                {models.map((m) => (
                  <option key={m.modelKey} value={m.modelKey}>
                    {m.displayName || m.modelKey}
                  </option>
                ))}
              </select>
            </label>
            <label style={{ fontSize: 12 }}>
              素材预算（chars）
              <input
                type="number"
                min={1000}
                max={120000}
                value={sourceTextCharBudget}
                onChange={(e) => onSourceTextCharBudgetChange(Number(e.target.value) || 30000)}
                style={{ width: '100%' }}
              />
            </label>
          </div>

          <div style={{ border: '1px solid #f0f0f0', borderRadius: 6, padding: 10 }}>
            <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 6 }}>核心参考（始终包含）</div>
            <div style={{ fontSize: 12, color: '#666' }}>{CORE_REFERENCE_LABELS}</div>
            <div style={{ fontWeight: 600, fontSize: 13, marginTop: 10, marginBottom: 6 }}>扩展参考（多选）</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0,1fr))', gap: 6 }}>
              {EXTENSION_REFERENCE_OPTIONS.map((item) => (
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
              onChange={(e) => onUserInstructionChange(e.target.value)}
              rows={3}
              style={{ width: '100%', border: '1px solid #d9d9d9', borderRadius: 4, padding: 8 }}
            />
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <label style={{ fontSize: 12 }}>
              <input
                type="checkbox"
                checked={allowPromptEdit}
                onChange={(e) => onAllowPromptEditChange(e.target.checked)}
              />{' '}
              允许编辑 Prompt
            </label>
            <button
              type="button"
              onClick={onRefreshPromptPreview}
              disabled={loading || generating || persisting}
              style={{
                padding: '6px 10px',
                border: '1px solid #1890ff',
                color: '#1890ff',
                background: 'white',
                borderRadius: 4,
                cursor: 'pointer',
              }}
            >
              {loading ? '刷新中...' : '刷新 Prompt 预览'}
            </button>
          </div>

          <div style={{ border: '1px solid #f0f0f0', borderRadius: 6, padding: 10 }}>
            <div style={{ fontSize: 12, color: '#666', marginBottom: 8 }}>
              Prompt 预览（{promptPreview.length.toLocaleString()} chars）
            </div>
            <textarea
              value={promptPreview}
              onChange={(e) => onPromptPreviewChange(e.target.value)}
              readOnly={!allowPromptEdit}
              style={{
                width: '100%',
                minHeight: 280,
                maxHeight: '40vh',
                fontSize: 13,
                lineHeight: 1.5,
                border: '1px solid #d9d9d9',
                borderRadius: 4,
                padding: 8,
                background: allowPromptEdit ? '#fff' : '#fafafa',
                fontFamily: 'monospace',
                resize: 'none',
              }}
            />
          </div>

          {referenceSummary.length > 0 && (
            <div style={{ border: '1px solid #f0f0f0', borderRadius: 6, padding: 10, fontSize: 12 }}>
              <div style={{ fontWeight: 600, marginBottom: 6 }}>参考摘要</div>
              {referenceSummary.map((item, idx) => (
                <div key={`${item.table}-${idx}`} style={{ marginBottom: 4 }}>
                  {item.label}：{item.rowCount} 条；字段：{item.fields.join(', ')}
                </div>
              ))}
            </div>
          )}

          {draft?.episodes?.length ? (
            <div style={{ border: '1px solid #f0f0f0', borderRadius: 6, padding: 10, fontSize: 12 }}>
              <div style={{ fontWeight: 600, marginBottom: 4 }}>
                草稿预览
                {targetEpisodeCount > 0 && (
                  <span
                    style={{
                      fontSize: 12,
                      color: actualEpisodeCount === targetEpisodeCount ? '#52c41a' : '#ff7a45',
                      fontWeight: 'bold',
                      marginLeft: 8,
                    }}
                  >
                    目标：{targetEpisodeCount} 集；实际：{actualEpisodeCount ?? episodeCount} 集
                  </span>
                )}
              </div>
              <div style={{ fontSize: 11, color: '#999', marginBottom: 6 }}>以下仅展示前 8 集摘要</div>
              {draft.episodes.slice(0, 8).map((ep) => (
                <div key={ep.episodeNumber} style={{ marginBottom: 6 }}>
                  第{ep.episodeNumber}集 {ep.title ? `《${ep.title}》` : ''}：{(ep.summary || ep.storyText?.slice(0, 80) || '-').replace(/\n/g, ' ')}
                </div>
              ))}
            </div>
          ) : null}

          {batchInfo && batchInfo.length > 0 && (
            <div
              style={{
                border: `1px solid ${finalCompletenessOk ? '#b7eb8f' : '#ffccc7'}`,
                borderRadius: 6,
                background: finalCompletenessOk ? '#f6ffed' : '#fff2f0',
                padding: 10,
                fontSize: 12,
              }}
            >
              <div style={{ fontWeight: 600, marginBottom: 6, color: finalCompletenessOk ? '#52c41a' : '#ff4d4f' }}>
                生成状态：{finalCompletenessOk ? '完整' : '不完整'}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', rowGap: 4, lineHeight: 1.6 }}>
                <span style={{ color: '#666' }}>目标集数：</span>
                <span>{targetEpisodeCount}</span>
                <span style={{ color: '#666' }}>实际集数：</span>
                <span style={{ fontWeight: 600 }}>{actualEpisodeCount ?? episodeCount}</span>
                <span style={{ color: '#666' }}>批次总数：</span>
                <span>{batchInfo.length}</span>
              </div>
            </div>
          )}

          {warnings.length > 0 && (
            <div style={{ border: '1px solid #ffe58f', borderRadius: 6, background: '#fffbe6', padding: 10, fontSize: 12 }}>
              {warnings.map((w, idx) => (
                <div key={`w-${idx}`}>- {w}</div>
              ))}
            </div>
          )}

          {checkReport && (
            <div style={{ border: '1px solid #d9d9d9', borderRadius: 6, padding: 10, fontSize: 12 }}>
              <div style={{ fontWeight: 600, marginBottom: 6 }}>
                AI 检查报告（总分：{checkReport.overallScore}，{checkReport.passed ? '通过' : '未通过'}）
              </div>
              {checkReport.episodeIssues.length > 0 && (
                <div style={{ marginBottom: 8 }}>
                  <div style={{ fontWeight: 600, marginBottom: 4 }}>逐集问题</div>
                  {checkReport.episodeIssues.slice(0, 10).map((item, idx) => (
                    <div key={`${item.episodeNumber}-${idx}`} style={{ marginBottom: 4 }}>
                      第{item.episodeNumber}集：{item.issues.map((i) => `[${i.severity}] ${i.message}`).join('；')}
                    </div>
                  ))}
                  {checkReport.episodeIssues.length > 10 && (
                    <div style={{ color: '#999' }}>…共 {checkReport.episodeIssues.length} 集有问题</div>
                  )}
                </div>
              )}
              {checkReport.suggestions.length > 0 && (
                <div>
                  <div style={{ fontWeight: 600, marginBottom: 4 }}>建议</div>
                  {checkReport.suggestions.map((s, idx) => (
                    <div key={`s-${idx}`}>
                      {s.episodeNumber != null ? `第${s.episodeNumber}集：` : ''}
                      {s.suggestion}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {generating && generatingPhase ? (
            <div
              style={{
                padding: '8px 12px',
                background: '#e6f7ff',
                border: '1px solid #91d5ff',
                borderRadius: 4,
                fontSize: 13,
                color: '#096dd9',
                display: 'flex',
                alignItems: 'center',
                gap: 8,
              }}
            >
              <span
                style={{
                  display: 'inline-block',
                  width: 14,
                  height: 14,
                  border: '2px solid #096dd9',
                  borderTop: '2px solid transparent',
                  borderRadius: '50%',
                  animation: 'spin 1s linear infinite',
                }}
              />
              <span>{generatingPhase}</span>
              <span style={{ marginLeft: 'auto', fontSize: 11, color: '#8c8c8c' }}>（预估阶段，非实时进度）</span>
              <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
            </div>
          ) : null}
        </div>

        <div
          style={{
            display: 'flex',
            justifyContent: 'flex-end',
            gap: 8,
            flexShrink: 0,
            borderTop: '1px solid #f0f0f0',
            paddingTop: 12,
          }}
        >
          <button
            type="button"
            onClick={onClose}
            style={{ padding: '6px 12px', border: '1px solid #d9d9d9', background: 'white', borderRadius: 4, cursor: 'pointer' }}
          >
            取消
          </button>
          <button
            type="button"
            onClick={onGenerateDraft}
            disabled={loading || generating || persisting}
            style={{ padding: '6px 12px', border: '1px solid #1890ff', color: '#1890ff', background: 'white', borderRadius: 4, cursor: 'pointer' }}
          >
            {generating ? '生成中...' : '生成草稿'}
          </button>
          <button
            type="button"
            onClick={onCheck}
            disabled={!draft?.episodes?.length || checking || generating || persisting}
            style={{ padding: '6px 12px', border: '1px solid #52c41a', color: '#52c41a', background: 'white', borderRadius: 4, cursor: 'pointer' }}
          >
            {checking ? '检查中...' : 'AI 检查'}
          </button>
          <button
            type="button"
            onClick={onPersistDraft}
            disabled={!draft?.episodes?.length || persisting || generating}
            style={{
              padding: '6px 12px',
              border: 'none',
              background: finalCompletenessOk === false ? '#ff7a45' : '#1890ff',
              color: 'white',
              borderRadius: 4,
              cursor: 'pointer',
            }}
          >
            {persisting ? '写入中...' : finalCompletenessOk === false ? '⚠ 强制写入（草稿不完整）' : '确认写入数据库'}
          </button>
        </div>
      </div>
    </div>
  )
}
