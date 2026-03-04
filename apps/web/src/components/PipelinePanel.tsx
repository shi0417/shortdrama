'use client'

import { useEffect, useState } from 'react'
import { api, PipelineOverviewDto } from '@/lib/api'
import SkeletonTopicsPanel from './pipeline/SkeletonTopicsPanel'

interface PipelinePanelProps {
  novelId: number
  novelName: string
}

type ModuleAction = 'generate' | 'edit' | 'save'

const modules = [
  { key: 'set_core', title: '1 核心设定', mapping: 'set_core' },
  { key: 'set_payoff', title: '2 核心爽点架构', mapping: 'set_payoff_arch / set_payoff_lines' },
  { key: 'set_opponent', title: '3 对手矩阵', mapping: 'set_opponent_matrix / set_opponents' },
  { key: 'set_power_ladder', title: '4 权力升级阶梯', mapping: 'set_power_ladder' },
  { key: 'set_traitor', title: '5 内鬼系统', mapping: 'set_traitor_system / set_traitors / set_traitor_stages' },
  { key: 'set_story_phases', title: '6 故事发展阶段', mapping: 'set_story_phases' },
]

export default function PipelinePanel({ novelId, novelName }: PipelinePanelProps) {
  const [step1Expanded, setStep1Expanded] = useState(true)
  const [step2Expanded, setStep2Expanded] = useState(true)
  const [step3Expanded, setStep3Expanded] = useState(true)
  const [requireConfirm, setRequireConfirm] = useState(true)

  const [stepChecks, setStepChecks] = useState({
    timeline: false,
    characters: false,
    keyNodes: false,
    explosions: false,
  })

  const [coreSettingText, setCoreSettingText] = useState('')
  const [coreFields, setCoreFields] = useState({
    protagonistName: '',
    protagonistIdentity: '',
    historicalEvent: '',
    rewriteGoal: '',
    coreConstraint: '',
  })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [timelines, setTimelines] = useState<Record<string, any>[]>([])
  const [characters, setCharacters] = useState<Record<string, any>[]>([])
  const [keyNodes, setKeyNodes] = useState<Record<string, any>[]>([])
  const [explosions, setExplosions] = useState<Record<string, any>[]>([])
  const [worldview, setWorldview] = useState<PipelineOverviewDto['worldview']>({
    core: [],
    payoffArch: [],
    opponents: [],
    powerLadder: [],
    traitors: [],
    storyPhases: [],
  })

  useEffect(() => {
    const loadOverview = async () => {
      try {
        setLoading(true)
        setError(null)
        const data = await api.getPipelineOverview(novelId)
        setTimelines(data.timelines || [])
        setCharacters(data.characters || [])
        setKeyNodes(data.keyNodes || [])
        setExplosions(data.explosions || [])
        setWorldview(
          data.worldview || {
            core: [],
            payoffArch: [],
            opponents: [],
            powerLadder: [],
            traitors: [],
            storyPhases: [],
          }
        )
      } catch (err: any) {
        setError(err?.message || 'Failed to load pipeline overview')
      } finally {
        setLoading(false)
      }
    }

    loadOverview()
  }, [novelId])

  const handleStepCheck = (key: keyof typeof stepChecks) => {
    setStepChecks((prev) => ({ ...prev, [key]: !prev[key] }))
  }

  const handleModuleAction = (module: string, action: ModuleAction) => {
    console.log({ module, action, novelId, novelName })
  }

  const handleInsertCharacters = () => {
    console.log({
      action: 'insert_novel_characters',
      novelId,
      novelName,
      protagonistName: coreFields.protagonistName,
      protagonistIdentity: coreFields.protagonistIdentity,
    })
  }

  const handleAiGenerate = () => {
    console.log({
      action: 'local_generate_or_refine_preview',
      novelId,
      novelName,
      coreSettingText,
      coreFields,
    })
  }

  const extractTitle = (row: Record<string, any>): string => {
    return (
      row.title ||
      row.name ||
      row.topic_name ||
      row.topicName ||
      row.item_title ||
      row.itemTitle ||
      row.level_title ||
      row.stage_title ||
      row.phase_name ||
      row.line_name ||
      row.opponent_name ||
      row.novels_name ||
      `#${row.id ?? 'N/A'}`
    )
  }

  const extractDescription = (row: Record<string, any>): string => {
    return (
      row.description ||
      row.core_text ||
      row.notes ||
      row.content ||
      row.line_content ||
      row.detailed_desc ||
      row.ability_boundary ||
      row.stage_desc ||
      row.historical_path ||
      row.rewrite_path ||
      row.public_identity ||
      row.real_identity ||
      row.source_ref ||
      ''
    )
  }

  const renderSimpleTable = (rows: Record<string, any>[], emptyText = '暂无数据') => {
    if (!rows.length) {
      return <div style={{ color: '#999', fontSize: '13px' }}>{emptyText}</div>
    }

    return (
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
        <thead>
          <tr>
            <th style={{ textAlign: 'left', borderBottom: '1px solid #f0f0f0', padding: '8px' }}>title</th>
            <th style={{ textAlign: 'left', borderBottom: '1px solid #f0f0f0', padding: '8px' }}>description</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, idx) => (
            <tr key={`${row.id ?? 'r'}-${idx}`}>
              <td style={{ borderBottom: '1px solid #f7f7f7', padding: '8px', verticalAlign: 'top' }}>{extractTitle(row)}</td>
              <td style={{ borderBottom: '1px solid #f7f7f7', padding: '8px', color: '#555' }}>
                {extractDescription(row) || '-'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <div style={{ fontSize: '20px', fontWeight: 600, color: '#333' }}>
        Pipeline - {novelName} (ID: {novelId})
      </div>
      {loading && <div style={{ color: '#1890ff', fontSize: '14px' }}>Loading pipeline overview...</div>}
      {error && <div style={{ color: '#ff4d4f', fontSize: '14px' }}>Load failed: {error}</div>}

      <div style={{ border: '1px solid #e8e8e8', borderRadius: '8px', overflow: 'hidden' }}>
        <div
          style={{
            background: '#fafafa',
            padding: '12px 16px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            borderBottom: '1px solid #e8e8e8',
          }}
        >
          <div style={{ fontWeight: 600 }}>Step 1 - 抽取历史骨架</div>
          <button
            onClick={() => setStep1Expanded((prev) => !prev)}
            style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: '#1890ff' }}
          >
            {step1Expanded ? 'Collapse' : 'Expand'}
          </button>
        </div>
        {step1Expanded && (
          <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <label>
              <input type="checkbox" checked={stepChecks.timeline} onChange={() => handleStepCheck('timeline')} />{' '}
              时间线分析 - 保存到 `novel_timelines`
            </label>
            <label>
              <input type="checkbox" checked={stepChecks.characters} onChange={() => handleStepCheck('characters')} />{' '}
              主要人物 - 保存到 `novel_characters`
            </label>
            <label>
              <input type="checkbox" checked={stepChecks.keyNodes} onChange={() => handleStepCheck('keyNodes')} /> 关键历史节点
              - 保存到 `novel_key_nodes`
            </label>
            <div style={{ marginLeft: '20px', marginTop: '4px' }}>
              <div style={{ fontWeight: 600, marginBottom: '6px' }}>骨架分析主题（可配置）</div>
              <SkeletonTopicsPanel novelId={novelId} />
            </div>
            <div style={{ fontSize: '12px', color: '#666', marginTop: '4px' }}>
              后端只读查询并展示已存在数据（本阶段不写库）
            </div>
            <div style={{ marginTop: '10px' }}>
              <div style={{ fontWeight: 600, marginBottom: '6px' }}>时间线列表</div>
              {renderSimpleTable(timelines)}
            </div>
            <div style={{ marginTop: '10px' }}>
              <div style={{ fontWeight: 600, marginBottom: '6px' }}>人物列表</div>
              {renderSimpleTable(characters)}
            </div>
            <div style={{ marginTop: '10px' }}>
              <div style={{ fontWeight: 600, marginBottom: '6px' }}>关键节点列表</div>
              {renderSimpleTable(keyNodes)}
            </div>
            <div style={{ marginTop: '10px' }}>
              <div style={{ fontWeight: 600, marginBottom: '6px' }}>骨架主题抽取结果（Topic Items）</div>
              <div style={{ color: '#999', fontSize: '13px' }}>
                请在上方“骨架分析主题（可配置）”中使用 Expand Items 查看各主题下的 items。
              </div>
            </div>
          </div>
        )}
      </div>

      <div style={{ border: '1px solid #e8e8e8', borderRadius: '8px', overflow: 'hidden' }}>
        <div
          style={{
            background: '#fafafa',
            padding: '12px 16px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            borderBottom: '1px solid #e8e8e8',
          }}
        >
          <div style={{ fontWeight: 600 }}>Step 2 - 识别爆点</div>
          <button
            onClick={() => setStep2Expanded((prev) => !prev)}
            style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: '#1890ff' }}
          >
            {step2Expanded ? 'Collapse' : 'Expand'}
          </button>
        </div>
        {step2Expanded && (
          <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <label>
              <input type="checkbox" checked={stepChecks.explosions} onChange={() => handleStepCheck('explosions')} /> 识别爆点
              - 保存到 `novel_explosions`
            </label>
            <div>
              <div style={{ fontWeight: 600, marginBottom: '6px' }}>爆点列表</div>
              {renderSimpleTable(explosions)}
            </div>
          </div>
        )}
      </div>

      <div style={{ border: '1px solid #e8e8e8', borderRadius: '8px', overflow: 'hidden' }}>
        <div
          style={{
            background: '#fafafa',
            padding: '12px 16px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            borderBottom: '1px solid #e8e8e8',
          }}
        >
          <div style={{ fontWeight: 600 }}>Step 3 - 生成世界观架构 / 重构爽文模型</div>
          <button
            onClick={() => setStep3Expanded((prev) => !prev)}
            style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: '#1890ff' }}
          >
            {step3Expanded ? 'Collapse' : 'Expand'}
          </button>
        </div>
        {step3Expanded && (
          <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {modules.map((item) => (
              <div
                key={item.key}
                style={{
                  border: '1px solid #f0f0f0',
                  borderRadius: '6px',
                  padding: '12px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: '12px',
                }}
              >
                <div>
                  <div style={{ fontWeight: 600 }}>{item.title}</div>
                  <div style={{ fontSize: '12px', color: '#666' }}>{item.mapping}</div>
                </div>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button
                    onClick={() => handleModuleAction(item.key, 'generate')}
                    style={{ padding: '6px 12px', border: '1px solid #1890ff', background: 'white', color: '#1890ff', borderRadius: '4px', cursor: 'pointer' }}
                  >
                    生成(或刷新)
                  </button>
                  <button
                    onClick={() => handleModuleAction(item.key, 'edit')}
                    style={{ padding: '6px 12px', border: '1px solid #d9d9d9', background: 'white', borderRadius: '4px', cursor: 'pointer' }}
                  >
                    编辑
                  </button>
                  <button
                    onClick={() => handleModuleAction(item.key, 'save')}
                    style={{ padding: '6px 12px', border: 'none', background: '#1890ff', color: 'white', borderRadius: '4px', cursor: 'pointer' }}
                  >
                    保存
                  </button>
                </div>
              </div>
            ))}
            <div style={{ marginTop: '6px' }}>
              <div style={{ fontWeight: 600, marginBottom: '6px' }}>核心设定</div>
              {renderSimpleTable(worldview.core)}
            </div>
            <div style={{ marginTop: '6px' }}>
              <div style={{ fontWeight: 600, marginBottom: '6px' }}>爽点架构</div>
              {renderSimpleTable(worldview.payoffArch)}
            </div>
            <div style={{ marginTop: '6px' }}>
              <div style={{ fontWeight: 600, marginBottom: '6px' }}>对手矩阵</div>
              {renderSimpleTable(worldview.opponents)}
            </div>
            <div style={{ marginTop: '6px' }}>
              <div style={{ fontWeight: 600, marginBottom: '6px' }}>权力阶梯</div>
              {renderSimpleTable(worldview.powerLadder)}
            </div>
            <div style={{ marginTop: '6px' }}>
              <div style={{ fontWeight: 600, marginBottom: '6px' }}>内鬼系统</div>
              {renderSimpleTable(worldview.traitors)}
            </div>
            <div style={{ marginTop: '6px' }}>
              <div style={{ fontWeight: 600, marginBottom: '6px' }}>故事阶段</div>
              {renderSimpleTable(worldview.storyPhases)}
            </div>
          </div>
        )}
      </div>

      <div style={{ border: '1px solid #e8e8e8', borderRadius: '8px', padding: '16px' }}>
        <div style={{ fontWeight: 600, marginBottom: '12px' }}>核心设定</div>
        <div style={{ display: 'flex', gap: '16px', alignItems: 'stretch' }}>
          <textarea
            value={coreSettingText}
            onChange={(e) => setCoreSettingText(e.target.value)}
            rows={12}
            placeholder="在此填写核心设定内容（静态）..."
            style={{
              flex: 1,
              padding: '10px 12px',
              border: '1px solid #d9d9d9',
              borderRadius: '4px',
              fontFamily: 'inherit',
              fontSize: '14px',
              resize: 'vertical',
            }}
          />
          <div style={{ width: '320px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <input
              value={coreFields.protagonistName}
              onChange={(e) => setCoreFields((prev) => ({ ...prev, protagonistName: e.target.value }))}
              placeholder="主角名称"
              style={{ padding: '8px 10px', border: '1px solid #d9d9d9', borderRadius: '4px' }}
            />
            <input
              value={coreFields.protagonistIdentity}
              onChange={(e) => setCoreFields((prev) => ({ ...prev, protagonistIdentity: e.target.value }))}
              placeholder="主角身份"
              style={{ padding: '8px 10px', border: '1px solid #d9d9d9', borderRadius: '4px' }}
            />
            <input
              value={coreFields.historicalEvent}
              onChange={(e) => setCoreFields((prev) => ({ ...prev, historicalEvent: e.target.value }))}
              placeholder="历史事件"
              style={{ padding: '8px 10px', border: '1px solid #d9d9d9', borderRadius: '4px' }}
            />
            <input
              value={coreFields.rewriteGoal}
              onChange={(e) => setCoreFields((prev) => ({ ...prev, rewriteGoal: e.target.value }))}
              placeholder="改写目标"
              style={{ padding: '8px 10px', border: '1px solid #d9d9d9', borderRadius: '4px' }}
            />
            <input
              value={coreFields.coreConstraint}
              onChange={(e) => setCoreFields((prev) => ({ ...prev, coreConstraint: e.target.value }))}
              placeholder="核心限制"
              style={{ padding: '8px 10px', border: '1px solid #d9d9d9', borderRadius: '4px' }}
            />
            <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
              <button
                onClick={handleInsertCharacters}
                style={{
                  flex: 1,
                  padding: '8px 10px',
                  border: '1px solid #1890ff',
                  background: 'white',
                  color: '#1890ff',
                  borderRadius: '4px',
                  cursor: 'pointer',
                }}
              >
                插入 novel_characters
              </button>
              <button
                onClick={handleAiGenerate}
                style={{
                  flex: 1,
                  padding: '8px 10px',
                  border: 'none',
                  background: '#1890ff',
                  color: 'white',
                  borderRadius: '4px',
                  cursor: 'pointer',
                }}
              >
                生成/完善（本地预览）
              </button>
            </div>
          </div>
        </div>
      </div>

      <div style={{ border: '1px solid #e8e8e8', borderRadius: '8px', padding: '12px 16px' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 500 }}>
          <input type="checkbox" checked={requireConfirm} onChange={() => setRequireConfirm((prev) => !prev)} /> 生成后需要我确认才写入数据库
          （默认勾选 true）
        </label>
        <div style={{ marginTop: '6px', fontSize: '12px', color: '#666' }}>
          勾选：先预览再落库（推荐） | 不勾选：自动落库（高级）
        </div>
      </div>
    </div>
  )
}
