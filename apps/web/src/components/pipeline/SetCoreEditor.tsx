'use client'

import { Dispatch, SetStateAction } from 'react'
import { SetCoreVersionDto } from '@/types/pipeline'

type CoreFields = {
  title: string
  protagonistName: string
  protagonistIdentity: string
  targetStory: string
  rewriteGoal: string
  coreConstraint: string
}

interface SetCoreEditorProps {
  coreSettingText: string
  setCoreSettingText: Dispatch<SetStateAction<string>>
  coreFields: CoreFields
  setCoreFields: Dispatch<SetStateAction<CoreFields>>
  versions: SetCoreVersionDto[]
  activeVersionId: number | null
  versionActionValue: string
  onChangeVersionAction: (value: string) => void
  onInsertCharacters: () => void
  onOpenEnhanceDialog: () => void
  onSave: () => void
  onCollapse: () => void
}

export default function SetCoreEditor({
  coreSettingText,
  setCoreSettingText,
  coreFields,
  setCoreFields,
  versions,
  activeVersionId,
  versionActionValue,
  onChangeVersionAction,
  onInsertCharacters,
  onOpenEnhanceDialog,
  onSave,
  onCollapse,
}: SetCoreEditorProps) {
  return (
    <div style={{ border: '1px solid #e8e8e8', borderRadius: '8px', padding: '16px', marginTop: '10px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
        <div style={{ fontWeight: 600 }}>核心设定编辑器（set_core）</div>
        <button
          onClick={onCollapse}
          style={{ border: 'none', background: 'transparent', color: '#1890ff', cursor: 'pointer' }}
        >
          收起
        </button>
      </div>
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
            value={coreFields.title}
            onChange={(e) => setCoreFields((prev) => ({ ...prev, title: e.target.value }))}
            placeholder="标题 title"
            style={{ padding: '8px 10px', border: '1px solid #d9d9d9', borderRadius: '4px' }}
          />
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
            value={coreFields.targetStory}
            onChange={(e) => setCoreFields((prev) => ({ ...prev, targetStory: e.target.value }))}
            placeholder="目标故事（targetStory）"
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
              onClick={onInsertCharacters}
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
              onClick={onOpenEnhanceDialog}
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
              生成/完善（AI）
            </button>
          </div>
          <div style={{ marginTop: '4px', fontSize: '12px', color: '#666' }}>版本操作</div>
          <select
            value={versionActionValue}
            onChange={(e) => onChangeVersionAction(e.target.value)}
            style={{ padding: '8px 10px', border: '1px solid #d9d9d9', borderRadius: '4px' }}
          >
            <option value="action:new_version">新建版本</option>
            {versions.map((item) => (
              <option key={item.id} value={`version:${item.id}`}>
                {`v${item.version} - ${item.title?.trim() ? item.title : '(无标题)'}${
                  item.id === activeVersionId || item.isActive ? ' [active]' : ''
                }`}
              </option>
            ))}
          </select>
          <button
            onClick={onSave}
            style={{
              marginTop: '4px',
              padding: '8px 10px',
              border: '1px dashed #d9d9d9',
              background: '#fafafa',
              color: '#666',
              borderRadius: '4px',
              cursor: 'pointer',
            }}
          >
            保存 set_core
          </button>
        </div>
      </div>
    </div>
  )
}
