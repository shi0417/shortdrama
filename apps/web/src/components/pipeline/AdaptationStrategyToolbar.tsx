'use client'

import { useEffect, useMemo, useState } from 'react'
import { adaptationApi } from '@/lib/adaptation-api'
import { AdaptationModeDto, AdaptationStrategyDto } from '@/types/adaptation'

interface AdaptationStrategyToolbarProps {
  novelId: number
  step3Expanded: boolean
  onToggle: () => void
}

type FormState = {
  modeId: string
  strategyTitle: string
  strategyDescription: string
  aiPromptTemplate: string
}

const emptyForm: FormState = {
  modeId: '',
  strategyTitle: '',
  strategyDescription: '',
  aiPromptTemplate: '',
}

function formatTime(value?: string | null): string {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString()
}

export default function AdaptationStrategyToolbar({
  novelId,
  step3Expanded,
  onToggle,
}: AdaptationStrategyToolbarProps) {
  const [modes, setModes] = useState<AdaptationModeDto[]>([])
  const [strategies, setStrategies] = useState<AdaptationStrategyDto[]>([])
  const [selectedStrategyId, setSelectedStrategyId] = useState<number | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [modalOpen, setModalOpen] = useState(false)
  const [isEditMode, setIsEditMode] = useState(false)
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [form, setForm] = useState<FormState>(emptyForm)

  const selectedStrategy = useMemo(
    () => strategies.find((item) => item.id === selectedStrategyId) || null,
    [strategies, selectedStrategyId]
  )

  const resetForm = () => {
    setForm(emptyForm)
    setShowAdvanced(false)
    setIsEditMode(false)
  }

  const openCreateModal = () => {
    resetForm()
    setForm((prev) => ({
      ...prev,
      modeId: modes[0] ? String(modes[0].id) : '',
    }))
    setModalOpen(true)
  }

  const openEditModal = () => {
    if (!selectedStrategy) return
    setIsEditMode(true)
    setShowAdvanced(Boolean(selectedStrategy.aiPromptTemplate))
    setForm({
      modeId: String(selectedStrategy.modeId),
      strategyTitle: selectedStrategy.strategyTitle || '',
      strategyDescription: selectedStrategy.strategyDescription || '',
      aiPromptTemplate: selectedStrategy.aiPromptTemplate || '',
    })
    setModalOpen(true)
  }

  const closeModal = () => {
    setModalOpen(false)
    resetForm()
  }

  const refreshData = async () => {
    try {
      setLoading(true)
      setError(null)
      const [modeData, strategyData] = await Promise.all([
        adaptationApi.listAdaptationModes(),
        adaptationApi.listNovelAdaptationStrategies(novelId),
      ])
      setModes(modeData || [])
      setStrategies(strategyData || [])
      setSelectedStrategyId((prev) => {
        if (prev && strategyData.some((item) => item.id === prev)) {
          return prev
        }
        return strategyData[0]?.id ?? null
      })
    } catch (err: any) {
      setError(err?.message || '加载重构模型失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    refreshData()
  }, [novelId])

  const handleSubmit = async () => {
    const modeIdNum = Number(form.modeId)
    if (!Number.isInteger(modeIdNum) || modeIdNum <= 0) {
      alert('请选择有效的改编模式')
      return
    }

    try {
      setSubmitting(true)
      setError(null)
      if (isEditMode && selectedStrategy) {
        const updated = await adaptationApi.updateAdaptationStrategy(selectedStrategy.id, {
          modeId: modeIdNum,
          strategyTitle: form.strategyTitle || undefined,
          strategyDescription: form.strategyDescription || undefined,
          aiPromptTemplate: form.aiPromptTemplate || undefined,
        })
        await refreshData()
        setSelectedStrategyId(updated.id)
      } else {
        const created = await adaptationApi.createNovelAdaptationStrategy(novelId, {
          modeId: modeIdNum,
          strategyTitle: form.strategyTitle || undefined,
          strategyDescription: form.strategyDescription || undefined,
          aiPromptTemplate: form.aiPromptTemplate || undefined,
        })
        await refreshData()
        setSelectedStrategyId(created.id)
      }
      closeModal()
    } catch (err: any) {
      const message = err?.message || '保存重构模型失败'
      setError(message)
      alert(message)
    } finally {
      setSubmitting(false)
    }
  }

  const handleDelete = async () => {
    if (!selectedStrategy) return
    if (!confirm(`确认删除重构模型 v${selectedStrategy.version} 吗？`)) {
      return
    }

    try {
      setError(null)
      await adaptationApi.deleteAdaptationStrategy(selectedStrategy.id)
      await refreshData()
    } catch (err: any) {
      const message = err?.message || '删除重构模型失败'
      setError(message)
      alert(message)
    }
  }

  return (
    <div style={{ width: '100%' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px' }}>
        <div style={{ fontWeight: 600 }}>Step 3 - 生成世界观架构 / 重构爽文模型</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <button
            onClick={openCreateModal}
            style={{
              padding: '6px 12px',
              border: 'none',
              borderRadius: '4px',
              background: '#1890ff',
              color: '#fff',
              cursor: 'pointer',
              fontSize: '13px',
            }}
          >
            新增重构模型
          </button>
          <button
            onClick={onToggle}
            style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: '#1890ff' }}
          >
            {step3Expanded ? 'Collapse' : 'Expand'}
          </button>
        </div>
      </div>

      <div style={{ marginTop: '8px', display: 'flex', flexWrap: 'wrap', gap: '8px', alignItems: 'center' }}>
        <span style={{ fontSize: '12px', color: '#666' }}>
          当前重构模型：
          {selectedStrategy
            ? `${selectedStrategy.modeName} v${selectedStrategy.version}（更新于 ${formatTime(selectedStrategy.updatedAt)}）`
            : '未创建'}
        </span>
        {loading && <span style={{ fontSize: '12px', color: '#1890ff' }}>加载中...</span>}
        {error && <span style={{ fontSize: '12px', color: '#ff4d4f' }}>错误：{error}</span>}
      </div>

      <div style={{ marginTop: '8px', display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
        <select
          value={selectedStrategyId ?? ''}
          onChange={(e) => setSelectedStrategyId(e.target.value ? Number(e.target.value) : null)}
          style={{ padding: '6px 8px', border: '1px solid #d9d9d9', borderRadius: '4px', minWidth: '240px' }}
        >
          <option value="">请选择策略版本</option>
          {strategies.map((item) => (
            <option key={item.id} value={item.id}>
              {item.modeName} v{item.version} - {item.strategyTitle || '未命名策略'}
            </option>
          ))}
        </select>
        <button
          onClick={openEditModal}
          disabled={!selectedStrategy}
          style={{
            padding: '6px 12px',
            border: '1px solid #d9d9d9',
            background: selectedStrategy ? 'white' : '#f5f5f5',
            borderRadius: '4px',
            cursor: selectedStrategy ? 'pointer' : 'not-allowed',
          }}
        >
          编辑
        </button>
        <button
          onClick={handleDelete}
          disabled={!selectedStrategy}
          style={{
            padding: '6px 12px',
            border: '1px solid #ff7875',
            color: '#cf1322',
            background: selectedStrategy ? 'white' : '#f5f5f5',
            borderRadius: '4px',
            cursor: selectedStrategy ? 'pointer' : 'not-allowed',
          }}
        >
          删除
        </button>
      </div>

      {selectedStrategy && (
        <div style={{ marginTop: '8px', fontSize: '12px', color: '#666', lineHeight: 1.6 }}>
          <div>标题：{selectedStrategy.strategyTitle || '-'}</div>
          <div>说明：{selectedStrategy.strategyDescription || '-'}</div>
        </div>
      )}

      {modalOpen && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0, 0, 0, 0.35)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            padding: '16px',
          }}
        >
          <div
            style={{
              width: '760px',
              maxWidth: '100%',
              background: '#fff',
              borderRadius: '8px',
              border: '1px solid #f0f0f0',
              padding: '16px',
              display: 'flex',
              flexDirection: 'column',
              gap: '10px',
            }}
          >
            <div style={{ fontWeight: 600 }}>{isEditMode ? '编辑重构模型' : '新增重构模型'}</div>
            <label style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <span style={{ fontSize: '12px', color: '#666' }}>改编模式</span>
              <select
                value={form.modeId}
                onChange={(e) => setForm((prev) => ({ ...prev, modeId: e.target.value }))}
                style={{ padding: '8px', border: '1px solid #d9d9d9', borderRadius: '4px' }}
              >
                <option value="">请选择模式</option>
                {modes.map((mode) => (
                  <option key={mode.id} value={mode.id}>
                    {mode.modeName} ({mode.modeKey})
                  </option>
                ))}
              </select>
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <span style={{ fontSize: '12px', color: '#666' }}>策略标题</span>
              <input
                value={form.strategyTitle}
                onChange={(e) => setForm((prev) => ({ ...prev, strategyTitle: e.target.value }))}
                placeholder="例如：强反差逆袭-版本1"
                style={{ padding: '8px', border: '1px solid #d9d9d9', borderRadius: '4px' }}
              />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <span style={{ fontSize: '12px', color: '#666' }}>策略说明</span>
              <textarea
                value={form.strategyDescription}
                onChange={(e) => setForm((prev) => ({ ...prev, strategyDescription: e.target.value }))}
                rows={4}
                style={{ padding: '8px', border: '1px solid #d9d9d9', borderRadius: '4px', resize: 'vertical' }}
              />
            </label>
            <button
              onClick={() => setShowAdvanced((prev) => !prev)}
              style={{
                width: 'fit-content',
                border: 'none',
                background: 'transparent',
                color: '#1890ff',
                cursor: 'pointer',
                padding: 0,
              }}
            >
              {showAdvanced ? '隐藏高级 Prompt 模板' : '展开高级 Prompt 模板'}
            </button>
            {showAdvanced && (
              <label style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <span style={{ fontSize: '12px', color: '#666' }}>Prompt 模板</span>
                <textarea
                  value={form.aiPromptTemplate}
                  onChange={(e) => setForm((prev) => ({ ...prev, aiPromptTemplate: e.target.value }))}
                  rows={6}
                  style={{ padding: '8px', border: '1px solid #d9d9d9', borderRadius: '4px', resize: 'vertical' }}
                />
              </label>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '6px' }}>
              <button
                onClick={closeModal}
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
                onClick={handleSubmit}
                disabled={submitting}
                style={{
                  padding: '8px 12px',
                  border: 'none',
                  borderRadius: '4px',
                  background: submitting ? '#91d5ff' : '#1890ff',
                  color: '#fff',
                  cursor: submitting ? 'not-allowed' : 'pointer',
                }}
              >
                {submitting ? '提交中...' : isEditMode ? '保存修改' : '创建策略'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
