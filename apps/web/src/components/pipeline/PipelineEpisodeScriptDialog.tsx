'use client'

import {
  AiModelOptionDto,
  PipelineEpisodeDurationMode,
  PipelineEpisodeGenerationMode,
  PipelineEpisodeScriptBatchInfo,
  PipelineEpisodeScriptDraft,
  PipelineEpisodeScriptReferenceSummaryItem,
  PipelineEpisodeScriptReferenceTable,
  PipelineEpisodeScriptRepairSummary,
} from '@/types/pipeline'

interface PipelineEpisodeScriptDialogProps {
  open: boolean
  models: AiModelOptionDto[]
  loading: boolean
  generating: boolean
  persisting: boolean
  selectedModelKey: string
  durationMode: PipelineEpisodeDurationMode
  generationMode: PipelineEpisodeGenerationMode
  draftGenerationMode?: string
  targetEpisodeCount?: number
  actualEpisodeCount?: number
  countMismatchWarning?: string
  referenceTables: PipelineEpisodeScriptReferenceTable[]
  userInstruction: string
  allowPromptEdit: boolean
  promptPreview: string
  fontSize: number
  sourceTextCharBudget: number
  referenceSummary: PipelineEpisodeScriptReferenceSummaryItem[]
  draft: PipelineEpisodeScriptDraft | null
  warnings: string[]
  normalizationWarnings: string[]
  validationWarnings: string[]
  finalCompletenessOk?: boolean
  batchInfo?: PipelineEpisodeScriptBatchInfo[]
  failedBatches?: Array<{ batchIndex: number; range: string; error?: string }>
  repairSummary?: PipelineEpisodeScriptRepairSummary
  generatingPhase?: string
  onClose: () => void
  onChangeModelKey: (value: string) => void
  onChangeDurationMode: (value: PipelineEpisodeDurationMode) => void
  onChangeGenerationMode: (value: PipelineEpisodeGenerationMode) => void
  onToggleReferenceTable: (value: PipelineEpisodeScriptReferenceTable) => void
  onChangeUserInstruction: (value: string) => void
  onChangeAllowPromptEdit: (value: boolean) => void
  onChangePromptPreview: (value: string) => void
  onChangeFontSize: (value: number) => void
  onChangeSourceTextCharBudget: (value: number) => void
  onRefreshPromptPreview: () => void
  onGenerateDraft: () => void
  onPersistDraft: () => void
}

const referenceTableOptions: Array<{ value: PipelineEpisodeScriptReferenceTable; label: string }> = [
  { value: 'drama_novels', label: '项目主信息（drama_novels）' },
  { value: 'novel_source_segments', label: '素材切片（novel_source_segments）' },
  { value: 'novel_adaptation_strategy', label: '改编策略（novel_adaptation_strategy）' },
  { value: 'adaptation_modes', label: '改编模式（adaptation_modes）' },
  { value: 'set_core', label: '核心设定（set_core）' },
  { value: 'novel_timelines', label: '时间线（novel_timelines）' },
  { value: 'novel_characters', label: '人物（novel_characters）' },
  { value: 'novel_key_nodes', label: '关键节点（novel_key_nodes）' },
  { value: 'novel_explosions', label: '爆点（novel_explosions）' },
  { value: 'novel_skeleton_topics', label: '骨架主题（novel_skeleton_topics）' },
  { value: 'novel_skeleton_topic_items', label: '骨架主题详情（novel_skeleton_topic_items）' },
  { value: 'drama_source_text', label: '原始素材补充（drama_source_text）' },
  { value: 'set_payoff_arch', label: '爽点架构（set_payoff_arch）' },
  { value: 'set_payoff_lines', label: '爽点线（set_payoff_lines）' },
  { value: 'set_opponent_matrix', label: '对手矩阵（set_opponent_matrix）' },
  { value: 'set_opponents', label: '对手明细（set_opponents）' },
  { value: 'set_power_ladder', label: '权力升级（set_power_ladder）' },
  { value: 'set_traitor_system', label: '内鬼系统（set_traitor_system）' },
  { value: 'set_traitors', label: '内鬼角色（set_traitors）' },
  { value: 'set_traitor_stages', label: '内鬼阶段（set_traitor_stages）' },
  { value: 'set_story_phases', label: '故事阶段（set_story_phases）' },
]

export default function PipelineEpisodeScriptDialog({
  open,
  models,
  loading,
  generating,
  persisting,
  selectedModelKey,
  durationMode,
  generationMode,
  draftGenerationMode,
  targetEpisodeCount,
  actualEpisodeCount,
  countMismatchWarning,
  referenceTables,
  userInstruction,
  allowPromptEdit,
  promptPreview,
  fontSize,
  sourceTextCharBudget,
  referenceSummary,
  draft,
  warnings,
  normalizationWarnings,
  validationWarnings,
  finalCompletenessOk,
  batchInfo,
  failedBatches,
  repairSummary,
  generatingPhase,
  onClose,
  onChangeModelKey,
  onChangeDurationMode,
  onChangeGenerationMode,
  onToggleReferenceTable,
  onChangeUserInstruction,
  onChangeAllowPromptEdit,
  onChangePromptPreview,
  onChangeFontSize,
  onChangeSourceTextCharBudget,
  onRefreshPromptPreview,
  onGenerateDraft,
  onPersistDraft,
}: PipelineEpisodeScriptDialogProps) {
  if (!open) return null

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', zIndex: 1300, padding: 16, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ width: 1280, maxWidth: '95%', height: '92vh', background: '#fff', borderRadius: 8, border: '1px solid #f0f0f0', padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', paddingRight: 8, paddingBottom: 12, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ fontWeight: 600, fontSize: 16 }}>生成每集纲要和每集剧本</div>
            <button onClick={onClose} style={{ border: 'none', background: 'transparent', color: '#1890ff', cursor: 'pointer' }}>关闭</button>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0,1fr))', gap: 10 }}>
            <label style={{ fontSize: 12 }}>AI 模型
              <select value={selectedModelKey} onChange={(e) => onChangeModelKey(e.target.value)} style={{ width: '100%' }}>
                {models.map((m) => <option key={m.modelKey} value={m.modelKey}>{m.displayName || m.modelKey}</option>)}
              </select>
            </label>
            <label style={{ fontSize: 12 }}>每集时长模板
              <select value={durationMode} onChange={(e) => onChangeDurationMode(e.target.value as PipelineEpisodeDurationMode)} style={{ width: '100%' }}>
                <option value="60s">60s</option>
                <option value="90s">90s</option>
              </select>
            </label>
            <label style={{ fontSize: 12 }}>生成模式
              <select value={generationMode} onChange={(e) => onChangeGenerationMode(e.target.value as PipelineEpisodeGenerationMode)} style={{ width: '100%' }}>
                <option value="outline_only">仅生成每集纲要</option>
                <option value="outline_and_script">生成每集纲要 + 每集剧本</option>
                <option value="overwrite_existing">生成并覆盖已存在内容</option>
              </select>
            </label>
            <label style={{ fontSize: 12 }}>素材预算（chars）
              <input type="number" min={1000} max={120000} value={sourceTextCharBudget} onChange={(e) => onChangeSourceTextCharBudget(Number(e.target.value) || 30000)} style={{ width: '100%' }} />
            </label>
          </div>

          <div style={{ border: '1px solid #f0f0f0', borderRadius: 6, padding: 10 }}>
            <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 8 }}>参考数据（多选）</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0,1fr))', gap: 6 }}>
              {referenceTableOptions.map((item) => (
                <label key={item.value} style={{ fontSize: 12 }}>
                  <input type="checkbox" checked={referenceTables.includes(item.value)} onChange={() => onToggleReferenceTable(item.value)} /> {item.label}
                </label>
              ))}
            </div>
          </div>

          <div>
            <div style={{ fontSize: 12, marginBottom: 4 }}>用户附加要求</div>
            <textarea value={userInstruction} onChange={(e) => onChangeUserInstruction(e.target.value)} rows={3} style={{ width: '100%', border: '1px solid #d9d9d9', borderRadius: 4, padding: 8 }} />
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <label style={{ fontSize: 12 }}>
              <input type="checkbox" checked={allowPromptEdit} onChange={(e) => onChangeAllowPromptEdit(e.target.checked)} /> 允许编辑 Prompt
            </label>
            <label style={{ fontSize: 12 }}>字体大小：
              <select value={fontSize} onChange={(e) => onChangeFontSize(Number(e.target.value))} style={{ marginLeft: 6 }}>
                {[12, 13, 14, 15, 16, 18].map((size) => <option key={size} value={size}>{size}px</option>)}
              </select>
            </label>
            <button onClick={onRefreshPromptPreview} disabled={loading || generating || persisting} style={{ padding: '6px 10px', border: '1px solid #1890ff', color: '#1890ff', background: 'white', borderRadius: 4, cursor: 'pointer' }}>
              {loading ? '刷新中...' : '刷新 Prompt 预览'}
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
                minHeight: 420,
                maxHeight: '65vh',
                fontSize: `${fontSize}px`,
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
                  {item.label}：{item.rowCount} 条；字段：{item.fields.join(', ')}{item.note ? `；${item.note}` : ''}
                </div>
              ))}
            </div>
          )}

          {draft?.episodePackage?.episodes?.length ? (() => {
            const effectiveMode = draftGenerationMode || generationMode
            const modeLabelMap: Record<string, string> = {
              outline_only: '仅纲要模式：剧本字段（fullContent / hooks / cliffhanger）可为空',
              outline_and_script: '纲要 + 剧本模式：script 字段应完整',
              overwrite_existing: '覆盖模式：写库时将覆盖本次涉及集数的已有数据',
            }
            const modeLabel = modeLabelMap[effectiveMode] || effectiveMode
            const isModeChanged = draftGenerationMode && draftGenerationMode !== generationMode
            return (
              <div
                style={{
                  border: '1px solid #f0f0f0',
                  borderRadius: 6,
                  padding: 10,
                  fontSize: `${Math.max(12, fontSize - 1)}px`,
                  lineHeight: 1.5,
                }}
              >
                <div style={{ fontWeight: 600, marginBottom: 4 }}>
                  草稿预览
                  {targetEpisodeCount && (
                    <span style={{ fontSize: 12, color: actualEpisodeCount === targetEpisodeCount ? '#52c41a' : '#ff7a45', fontWeight: 'bold' }}>
                      {' '}
                      目标：{targetEpisodeCount} 集；实际：{actualEpisodeCount || draft.episodePackage.episodes.length} 集
                    </span>
                  )}
                  {countMismatchWarning && (
                    <div style={{ fontSize: 11, color: '#ff4d4f', marginTop: 4, fontWeight: 'bold' }}>
                      {countMismatchWarning}
                    </div>
                  )}
                </div>
                <div style={{ fontSize: 11, color: '#888', marginBottom: 8 }}>
                  当前为{modeLabel}
                  {isModeChanged && (
                    <div style={{ marginTop: 4, color: '#ff7a45' }}>
                      ⚠ 当前草稿是按【{modeLabelMap[draftGenerationMode!] || draftGenerationMode}】模式生成；如要切换模式，请先重新生成草稿
                    </div>
                  )}
                </div>
                <div style={{ fontSize: 11, color: '#999', marginBottom: 6 }}>
                  以下仅展示前 8 集摘要，完整数据已保存
                </div>
                {draft.episodePackage.episodes.slice(0, 8).map((ep) => (
                  <div key={ep.episodeNumber} style={{ marginBottom: 6 }}>
                    第{ep.episodeNumber}集《{ep.episodeTitle || '-'}》：{ep.outline?.coreConflict || '-'}
                  </div>
                ))}
              </div>
            )
          })() : null}

          {draft && batchInfo && batchInfo.length > 0 && (() => {
            const totalBatches = batchInfo.length
            const failedCount = (failedBatches || []).length
            const retriedCount = batchInfo.filter((b) => b.retried).length
            const repairedCount = batchInfo.filter((b) => b.repaired).length
            const isComplete = finalCompletenessOk === true
            const borderColor = isComplete ? '#b7eb8f' : '#ffccc7'
            const bgColor = isComplete ? '#f6ffed' : '#fff2f0'
            const statusColor = isComplete ? '#52c41a' : '#ff4d4f'
            const statusText = isComplete ? '完整' : '不完整'
            return (
              <div style={{ border: `1px solid ${borderColor}`, borderRadius: 6, background: bgColor, padding: 10, fontSize: 12 }}>
                <div style={{ fontWeight: 600, marginBottom: 6, color: statusColor }}>
                  生成状态：{statusText}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', rowGap: 4, lineHeight: 1.6 }}>
                  <span style={{ color: '#666' }}>目标集数：</span>
                  <span>{targetEpisodeCount || '-'}</span>
                  <span style={{ color: '#666' }}>实际集数：</span>
                  <span style={{ color: actualEpisodeCount === targetEpisodeCount ? '#52c41a' : '#ff7a45', fontWeight: 600 }}>
                    {actualEpisodeCount || '-'}
                  </span>
                  <span style={{ color: '#666' }}>批次总数：</span>
                  <span>{totalBatches}</span>
                  {failedCount > 0 && (<>
                    <span style={{ color: '#ff4d4f' }}>失败批次：</span>
                    <span style={{ color: '#ff4d4f' }}>{failedCount}</span>
                  </>)}
                  {retriedCount > 0 && (<>
                    <span style={{ color: '#666' }}>重试批次：</span>
                    <span>{retriedCount}</span>
                  </>)}
                  {repairedCount > 0 && (<>
                    <span style={{ color: '#666' }}>修复批次：</span>
                    <span>{repairedCount}</span>
                  </>)}
                </div>
                {repairSummary && (repairSummary.planRepaired || repairSummary.repairedBatches > 0 || repairSummary.finalMissingRepairApplied) && (
                  <div style={{ marginTop: 6, padding: '4px 8px', background: 'rgba(0,0,0,0.03)', borderRadius: 4 }}>
                    <span style={{ fontWeight: 600, color: '#666' }}>修复摘要：</span>
                    {repairSummary.planRepaired && <span style={{ marginLeft: 6 }}>Plan已修复</span>}
                    {repairSummary.repairedBatches > 0 && <span style={{ marginLeft: 6 }}>{repairSummary.repairedBatches}个批次已修复</span>}
                    {repairSummary.finalMissingRepairApplied && <span style={{ marginLeft: 6 }}>缺集已补生</span>}
                  </div>
                )}
                {failedBatches && failedBatches.length > 0 && (
                  <div style={{ marginTop: 6, padding: '4px 8px', background: 'rgba(255,0,0,0.04)', borderRadius: 4 }}>
                    <div style={{ fontWeight: 600, color: '#ff4d4f', marginBottom: 2 }}>失败批次明细</div>
                    {failedBatches.map((fb) => (
                      <div key={fb.batchIndex} style={{ color: '#ff4d4f' }}>
                        批次 {fb.batchIndex}（第 {fb.range} 集）：{fb.error ? fb.error.slice(0, 120) : '未知错误'}
                      </div>
                    ))}
                  </div>
                )}
                {!isComplete && (
                  <div style={{ marginTop: 6, color: '#ff4d4f', fontWeight: 600 }}>
                    ⚠ 草稿不完整，不建议直接写入数据库
                  </div>
                )}
              </div>
            )
          })()}

          {(() => {
            const filteredValidationWarnings =
              generationMode === 'outline_only'
                ? validationWarnings.filter((w) => !w.startsWith('[剧本内容不完整]'))
                : validationWarnings
            const allWarnings = [...warnings, ...normalizationWarnings, ...filteredValidationWarnings]
            return allWarnings.length > 0 ? (
              <div style={{ border: '1px solid #ffe58f', borderRadius: 6, background: '#fffbe6', padding: 10, fontSize: 12 }}>
                {allWarnings.map((w, idx) => (
                  <div key={`w-${idx}`}>- {w}</div>
                ))}
              </div>
            ) : null
          })()}

          {draft?.episodePackage?.episodes?.length ? (() => {
            const episodeNums = draft.episodePackage.episodes
              .map((e) => e.episodeNumber)
              .sort((a, b) => a - b)
            const isContiguous = episodeNums.every((n, i) => i === 0 || n === episodeNums[i - 1] + 1)
            const episodeRange =
              episodeNums.length === 1
                ? `第 ${episodeNums[0]} 集`
                : isContiguous
                ? `第 ${episodeNums[0]}-${episodeNums[episodeNums.length - 1]} 集`
                : `第 ${episodeNums.join('、')} 集`
            const modeLabelMap: Record<string, string> = {
              outline_only: '仅生成纲要（剧本字段允许为空）',
              outline_and_script: '生成纲要 + 剧本',
              overwrite_existing: '生成并覆盖已有内容',
            }
            const effectiveMode = draftGenerationMode || generationMode
            return (
              <div style={{ border: '2px solid #fa8c16', borderRadius: 6, padding: '10px 14px', background: '#fffbe6' }}>
                <div style={{ fontWeight: 700, marginBottom: 8, fontSize: 13, color: '#d46b08' }}>⚠ 写入前确认</div>
                <div style={{ display: 'grid', gridTemplateColumns: '110px 1fr', rowGap: 5, fontSize: 12, lineHeight: 1.7 }}>
                  <span style={{ color: '#666' }}>生成模式：</span>
                  <span>{modeLabelMap[effectiveMode] || effectiveMode}</span>
                  <span style={{ color: '#666' }}>本次集数：</span>
                  <span>{episodeRange}</span>
                  <span style={{ color: '#666' }}>写入表：</span>
                  <span>novel_episodes、drama_structure_template</span>
                  <span style={{ color: '#666' }}>hook_rhythm：</span>
                  <span>写入时自动检测，若表不存在或字段不兼容将跳过</span>
                  <span style={{ color: '#666' }}>覆盖说明：</span>
                  <span>将覆盖本次涉及集数的已有数据，不影响其它集数</span>
                </div>
              </div>
            )
          })() : null}
        </div>

        {generating && generatingPhase ? (
          <div style={{
            padding: '8px 12px',
            marginBottom: 4,
            background: '#e6f7ff',
            border: '1px solid #91d5ff',
            borderRadius: 4,
            fontSize: 13,
            color: '#096dd9',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            flexShrink: 0,
          }}>
            <span style={{ display: 'inline-block', width: 14, height: 14, border: '2px solid #096dd9', borderTop: '2px solid transparent', borderRadius: '50%', animation: 'spin 1s linear infinite' }} />
            <span>{generatingPhase}</span>
            <span style={{ marginLeft: 'auto', fontSize: 11, color: '#8c8c8c' }}>
              （预估阶段，非实时进度）
            </span>
            <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
          </div>
        ) : null}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, flexShrink: 0, borderTop: '1px solid #f0f0f0', paddingTop: 12 }}>
          <button onClick={onClose} style={{ padding: '6px 12px', border: '1px solid #d9d9d9', background: 'white', borderRadius: 4, cursor: 'pointer' }}>取消</button>
          <button onClick={onGenerateDraft} disabled={loading || generating || persisting} style={{ padding: '6px 12px', border: '1px solid #1890ff', color: '#1890ff', background: 'white', borderRadius: 4, cursor: 'pointer' }}>
            {generating ? '生成中...' : '生成草稿'}
          </button>
          <button
            onClick={onPersistDraft}
            disabled={!draft || persisting || generating}
            style={{
              padding: '6px 12px',
              border: 'none',
              background: finalCompletenessOk === false ? '#ff7a45' : '#1890ff',
              color: 'white',
              borderRadius: 4,
              cursor: 'pointer',
            }}
          >
            {persisting
              ? '写入中...'
              : finalCompletenessOk === false
                ? '⚠ 强制写入（草稿不完整）'
                : '确认写入数据库'}
          </button>
        </div>
      </div>
    </div>
  )
}

