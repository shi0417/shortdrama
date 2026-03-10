'use client'

import { PipelineFieldConfig, PipelineResourceRow } from '@/types/pipeline-resource'

interface PipelineDataTableProps {
  rows: PipelineResourceRow[]
  columns: PipelineFieldConfig[]
  emptyText?: string
  onRowClick?: (row: PipelineResourceRow) => void
}

function formatCellValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return '-'
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value)
    } catch {
      return '[object]'
    }
  }
  return String(value)
}

function truncateText(text: string, max = 180) {
  return text.length <= max ? text : `${text.slice(0, max)}...`
}

export default function PipelineDataTable({
  rows,
  columns,
  emptyText = '暂无数据',
  onRowClick,
}: PipelineDataTableProps) {
  if (!rows.length) {
    return <div style={{ color: '#999', fontSize: '13px' }}>{emptyText}</div>
  }

  return (
    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
      <thead>
        <tr>
          {columns.map((column) => (
            <th
              key={column.key}
              style={{
                textAlign: 'left',
                borderBottom: '1px solid #f0f0f0',
                padding: '8px',
                whiteSpace: 'nowrap',
              }}
            >
              {column.label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, idx) => (
          <tr
            key={`${row.id ?? 'r'}-${idx}`}
            onClick={() => onRowClick?.(row)}
            style={{
              cursor: onRowClick ? 'pointer' : 'default',
              background: onRowClick ? '#fff' : 'transparent',
            }}
          >
            {columns.map((column) => {
              const raw = row[column.key]
              const text = formatCellValue(raw)
              const displayText =
                column.type === 'textarea' || column.type === 'json'
                  ? truncateText(text, 220)
                  : truncateText(text, 80)

              return (
                <td
                  key={column.key}
                  style={{
                    borderBottom: '1px solid #f7f7f7',
                    padding: '8px',
                    verticalAlign: 'top',
                    color: column.type === 'textarea' || column.type === 'json' ? '#555' : '#333',
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                  }}
                >
                  {displayText || '-'}
                </td>
              )
            })}
          </tr>
        ))}
      </tbody>
    </table>
  )
}
