'use client'

import {
  AiModelOptionDto,
  PipelineWorldviewDraft,
  PipelineWorldviewEvidenceSummary,
  PipelineWorldviewQualitySummary,
  PipelineWorldviewQualityWarning,
  PipelineWorldviewReferenceSummaryItem,
  PipelineWorldviewReferenceTable,
} from '@/types/pipeline'

interface PipelineWorldviewDialogProps {
  open: boolean
  models: AiModelOptionDto[]
  loading: boolean
  generating: boolean
  persisting: boolean
  selectedModelKey: string
  referenceTables: PipelineWorldviewReferenceTable[]
  userInstruction: string
  allowPromptEdit: boolean
  promptPreview: string
  fontSize: number
  sourceTextCharBudget: number
  referenceSummary: PipelineWorldviewReferenceSummaryItem[]
  evidenceSummary: PipelineWorldviewEvidenceSummary | null
  qualitySummary: PipelineWorldviewQualitySummary | null
  qualityWarnings: PipelineWorldviewQualityWarning[]
  draft: PipelineWorldviewDraft | null
  warnings: string[]
  normalizationWarnings: string[]
  validationWarnings: string[]
  onClose: () => void
  onChangeModelKey: (value: string) => void
  onToggleReferenceTable: (value: PipelineWorldviewReferenceTable) => void
  onChangeUserInstruction: (value: string) => void
  onChangeAllowPromptEdit: (value: boolean) => void
  onChangePromptPreview: (value: string) => void
  onChangeFontSize: (value: number) => void
  onChangeSourceTextCharBudget: (value: number) => void
  onRefreshPromptPreview: () => void
  onGenerateDraft: () => void
  onPersistDraft: () => void
}

const referenceTableOptions: Array<{
  value: PipelineWorldviewReferenceTable
  label: string
}> = [
  { value: 'drama_novels', label: '项目基础信息（drama_novels）' },
  { value: 'drama_source_text', label: '原始素材（drama_source_text）' },
  { value: 'novel_adaptation_strategy', label: '改编策略（novel_adaptation_strategy）' },
  { value: 'adaptation_modes', label: '改编模式（adaptation_modes）' },
  { value: 'set_core', label: '核心设定（set_core）' },
  { value: 'novel_timelines', label: '时间线（novel_timelines）' },
  { value: 'novel_characters', label: '人物（novel_characters）' },
  { value: 'novel_key_nodes', label: '关键节点（novel_key_nodes）' },
  { value: 'novel_skeleton_topics', label: '骨架主题（novel_skeleton_topics）' },
  { value: 'novel_skeleton_topic_items', label: '骨架主题详情（novel_skeleton_topic_items）' },
  { value: 'novel_explosions', label: '爆点（novel_explosions）' },
]

function renderItems(title: string, items: Array<{ title: string; desc: string }>) {
  return (
    <div>
      <div style={{ fontWeight: 600, marginBottom: '6px' }}>{title}</div>
      {!items.length ? (
        <div style={{ color: '#999', fontSize: '12px' }}>暂无草稿数据</div>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
          <thead>
            <tr>
              <th style={{ textAlign: 'left', borderBottom: '1px solid #f0f0f0', padding: '6px' }}>
                标题
              </th>
              <th style={{ textAlign: 'left', borderBottom: '1px solid #f0f0f0', padding: '6px' }}>
                说明
              </th>
            </tr>
          </thead>
          <tbody>
            {items.map((item, index) => (
              <tr key={`${title}-${index}`}>
                <td style={{ borderBottom: '1px solid #f7f7f7', padding: '6px', verticalAlign: 'top' }}>
                  {item.title}
                </td>
                <td style={{ borderBottom: '1px solid #f7f7f7', padding: '6px', color: '#555' }}>
                  {item.desc || '-'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

export default function PipelineWorldviewDialog({
  open,
  models,
  loading,
  generating,
  persisting,
  selectedModelKey,
  referenceTables,
  userInstruction,
  allowPromptEdit,
  promptPreview,
  fontSize,
  sourceTextCharBudget,
  referenceSummary,
  evidenceSummary,
  qualitySummary,
  qualityWarnings,
  draft,
  warnings,
  normalizationWarnings,
  validationWarnings,
  onClose,
  onChangeModelKey,
  onToggleReferenceTable,
  onChangeUserInstruction,
  onChangeAllowPromptEdit,
  onChangePromptPreview,
  onChangeFontSize,
  onChangeSourceTextCharBudget,
  onRefreshPromptPreview,
  onGenerateDraft,
  onPersistDraft,
}: PipelineWorldviewDialogProps) {
  if (!open) return null

  const allWarnings = [...warnings, ...normalizationWarnings, ...validationWarnings]
  const traitorQualityWarnings = qualityWarnings.filter((item) => item.moduleKey === 'traitor')
  const storyPhaseQualityWarnings = qualityWarnings.filter((item) => item.moduleKey === 'story_phase')

  const moduleOrder: Array<{
    key: keyof PipelineWorldviewQualitySummary['byModule']
    label: string
  }> = [
    { key: 'payoff', label: 'payoff' },
    { key: 'opponents', label: 'opponents' },
    { key: 'power', label: 'power' },
    { key: 'traitor', label: 'traitor' },
    { key: 'story_phase', label: 'story_phase' },
  ]

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0, 0, 0, 0.35)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1300,
        padding: '16px',
      }}
    >
      <div
        style={{
          width: '1160px',
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
          <div style={{ fontWeight: 600, fontSize: '16px' }}>提炼短剧世界观</div>
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
          本流程采用三段式：Preview Prompt -> 生成世界观草稿 -> 确认写入数据库。`set_core`
          仅作为输入参考，不在本轮统一写库中被覆盖。
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

        <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
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
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <span style={{ fontSize: '12px', color: '#666' }}>原始素材字符预算</span>
            <select
              value={sourceTextCharBudget}
              onChange={(e) => onChangeSourceTextCharBudget(Number(e.target.value))}
              style={{ padding: '6px 8px', border: '1px solid #d9d9d9', borderRadius: '4px' }}
            >
              <option value={20000}>20000</option>
              <option value={30000}>30000</option>
              <option value={40000}>40000</option>
            </select>
          </label>
        </div>

        <div>
          <div style={{ fontSize: '12px', color: '#666', marginBottom: '6px' }}>参考表</div>
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
        </div>

        <label style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <span style={{ fontSize: '12px', color: '#666' }}>用户附加要求</span>
          <textarea
            value={userInstruction}
            onChange={(e) => onChangeUserInstruction(e.target.value)}
            rows={4}
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
            rows={14}
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

        <div style={{ border: '1px solid #f0f0f0', borderRadius: '6px', padding: '10px' }}>
          <div style={{ fontWeight: 600, fontSize: '13px', marginBottom: '8px' }}>参考资料摘要</div>
          {!referenceSummary.length ? (
            <div style={{ color: '#999', fontSize: '12px' }}>暂无摘要，先刷新 Prompt 预览</div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
              <thead>
                <tr>
                  <th style={{ textAlign: 'left', borderBottom: '1px solid #f0f0f0', padding: '6px' }}>模块</th>
                  <th style={{ textAlign: 'left', borderBottom: '1px solid #f0f0f0', padding: '6px' }}>条数</th>
                  <th style={{ textAlign: 'left', borderBottom: '1px solid #f0f0f0', padding: '6px' }}>字段</th>
                  <th style={{ textAlign: 'left', borderBottom: '1px solid #f0f0f0', padding: '6px' }}>说明</th>
                </tr>
              </thead>
              <tbody>
                {referenceSummary.map((item) => (
                  <tr key={item.table}>
                    <td style={{ borderBottom: '1px solid #f7f7f7', padding: '6px' }}>{item.label}</td>
                    <td style={{ borderBottom: '1px solid #f7f7f7', padding: '6px' }}>
                      {item.rowCount}
                      {typeof item.usedChars === 'number' ? ` / ${item.usedChars} chars` : ''}
                    </td>
                    <td style={{ borderBottom: '1px solid #f7f7f7', padding: '6px', color: '#555' }}>
                      {item.fields.join(', ')}
                    </td>
                    <td style={{ borderBottom: '1px solid #f7f7f7', padding: '6px', color: '#555' }}>
                      {item.note ||
                        (typeof item.originalChars === 'number'
                          ? `原始总量 ${item.originalChars} chars`
                          : '-')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div style={{ border: '1px solid #f0f0f0', borderRadius: '6px', padding: '10px' }}>
          <div style={{ fontWeight: 600, fontSize: '13px', marginBottom: '8px' }}>Evidence Summary</div>
          {!evidenceSummary ? (
            <div style={{ color: '#999', fontSize: '12px' }}>暂无 evidence 信息，先刷新 Prompt 预览</div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '8px', fontSize: '12px' }}>
              <div>evidence segments：{evidenceSummary.evidenceSegments}</div>
              <div>coverage chapters：{evidenceSummary.coverageChapters}</div>
              <div>evidence chars：{evidenceSummary.evidenceChars}</div>
              <div>fallback status：{evidenceSummary.fallbackUsed ? 'used' : 'not used'}</div>
              <div style={{ gridColumn: '1 / -1', color: '#555' }}>
                module evidence：
                {Object.entries(evidenceSummary.moduleEvidenceCount || {}).length ? (
                  Object.entries(evidenceSummary.moduleEvidenceCount)
                    .map(([key, value]) => `${key}: ${value}`)
                    .join(' / ')
                ) : (
                  ' -'
                )}
              </div>
            </div>
          )}
        </div>

        <div style={{ border: '1px solid #f0f0f0', borderRadius: '6px', padding: '10px' }}>
          <div style={{ fontWeight: 600, fontSize: '13px', marginBottom: '8px' }}>质量检查摘要</div>
          {!qualitySummary ? (
            <div style={{ color: '#999', fontSize: '12px' }}>暂无质量检查结果，先刷新预览或生成草稿</div>
          ) : (
            <>
              <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', fontSize: '12px', marginBottom: '8px' }}>
                <div>total issues: {qualitySummary.totalIssues}</div>
                <div style={{ color: '#cf1322' }}>bad: {qualitySummary.badCount}</div>
                <div style={{ color: '#d48806' }}>weak: {qualitySummary.weakCount}</div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, minmax(0, 1fr))', gap: '6px', fontSize: '12px' }}>
                {moduleOrder.map((item) => (
                  <div key={item.key} style={{ border: '1px solid #f0f0f0', borderRadius: '4px', padding: '6px' }}>
                    <div style={{ fontWeight: 600 }}>{item.label}</div>
                    <div style={{ color: '#cf1322' }}>bad: {qualitySummary.byModule[item.key].bad}</div>
                    <div style={{ color: '#d48806' }}>weak: {qualitySummary.byModule[item.key].weak}</div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

        {allWarnings.length > 0 && (
          <div style={{ border: '1px solid #fff1b8', background: '#fffbe6', borderRadius: '6px', padding: '10px' }}>
            <div style={{ fontWeight: 600, fontSize: '13px', marginBottom: '6px' }}>提示信息</div>
            {allWarnings.map((item, index) => (
              <div key={`${item}-${index}`} style={{ fontSize: '12px', color: '#8c6d1f', lineHeight: 1.6 }}>
                - {item}
              </div>
            ))}
          </div>
        )}

        <div style={{ border: '1px solid #f0f0f0', borderRadius: '6px', padding: '10px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <div style={{ fontWeight: 600, fontSize: '13px' }}>世界观草稿预览</div>
          {!draft ? (
            <div style={{ color: '#999', fontSize: '12px' }}>尚未生成草稿</div>
          ) : (
            <>
              {renderItems(
                '核心爽点架构',
                draft.setPayoffArch.lines.map((row) => ({
                  title: row.line_name || row.line_key,
                  desc: row.line_content,
                }))
              )}
              {renderItems(
                '对手矩阵',
                draft.setOpponentMatrix.opponents.map((row) => ({
                  title: `${row.level_name} / ${row.opponent_name}`,
                  desc: row.detailed_desc || row.threat_type || '',
                }))
              )}
              {renderItems(
                '权力升级阶梯',
                draft.setPowerLadder.map((row) => ({
                  title: `${row.level_no}. ${row.level_title}`,
                  desc: `${row.identity_desc} ${row.ability_boundary}`.trim(),
                }))
              )}
              {renderItems(
                '内鬼角色',
                draft.setTraitorSystem.traitors.map((row) => ({
                  title: row.name,
                  desc: [row.public_identity, row.real_identity, row.mission, row.threat_desc]
                    .filter(Boolean)
                    .join(' | '),
                }))
              )}
              {traitorQualityWarnings.length > 0 && (
                <div style={{ border: '1px solid #ffe58f', background: '#fffbe6', borderRadius: '6px', padding: '8px' }}>
                  <div style={{ fontWeight: 600, marginBottom: '4px', fontSize: '12px' }}>Traitor warnings</div>
                  {traitorQualityWarnings.slice(0, 12).map((item, index) => (
                    <div key={`${item.path}-${index}`} style={{ fontSize: '12px', color: item.severity === 'bad' ? '#cf1322' : '#d48806' }}>
                      - [{item.severity}] {item.path}: {item.reason}
                    </div>
                  ))}
                </div>
              )}
              {renderItems(
                '内鬼阶段',
                draft.setTraitorSystem.stages.map((row) => ({
                  title: row.stage_title,
                  desc: row.stage_desc,
                }))
              )}
              {renderItems(
                '故事发展阶段',
                draft.setStoryPhases.map((row) => ({
                  title: row.phase_name,
                  desc: [row.historical_path, row.rewrite_path].filter(Boolean).join(' | '),
                }))
              )}
              {storyPhaseQualityWarnings.length > 0 && (
                <div style={{ border: '1px solid #ffe58f', background: '#fffbe6', borderRadius: '6px', padding: '8px' }}>
                  <div style={{ fontWeight: 600, marginBottom: '4px', fontSize: '12px' }}>Story phase warnings</div>
                  {storyPhaseQualityWarnings.slice(0, 12).map((item, index) => (
                    <div key={`${item.path}-${index}`} style={{ fontSize: '12px', color: item.severity === 'bad' ? '#cf1322' : '#d48806' }}>
                      - [{item.severity}] {item.path}: {item.reason}
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
          {!!qualitySummary?.badCount && (
            <div style={{ marginRight: 'auto', fontSize: '12px', color: '#cf1322', alignSelf: 'center' }}>
              当前草稿仍有 {qualitySummary.badCount} 个严重低质字段，建议先优化后再写库。
            </div>
          )}
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
            {loading ? '生成中...' : '刷新 Prompt 预览'}
          </button>
          <button
            onClick={onGenerateDraft}
            disabled={generating || loading || !selectedModelKey}
            style={{
              padding: '8px 12px',
              border: 'none',
              borderRadius: '4px',
              background: generating || loading ? '#91d5ff' : '#1890ff',
              color: '#fff',
              cursor: generating || loading || !selectedModelKey ? 'not-allowed' : 'pointer',
            }}
          >
            {generating ? '生成中...' : '生成世界观草稿'}
          </button>
          <button
            onClick={onPersistDraft}
            disabled={!draft || persisting}
            style={{
              padding: '8px 12px',
              border: 'none',
              borderRadius: '4px',
              background: !draft || persisting ? '#bfbfbf' : '#52c41a',
              color: '#fff',
              cursor: !draft || persisting ? 'not-allowed' : 'pointer',
            }}
          >
            {persisting ? '写入中...' : '确认写入数据库'}
          </button>
        </div>
      </div>
    </div>
  )
}
