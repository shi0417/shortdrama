export type PipelineResourceName =
  | 'timelines'
  | 'characters'
  | 'key-nodes'
  | 'explosions'
  | 'skeleton-topics'
  | 'skeleton-topic-items'

export type PipelineFieldType = 'text' | 'textarea' | 'number' | 'json' | 'boolean'

export interface PipelineResourceRow {
  [key: string]: unknown
}

export interface PipelineFieldConfig {
  key: string
  label: string
  type: PipelineFieldType
  editable?: boolean
  readonly?: boolean
}

export interface PipelineResourceConfig {
  resource: PipelineResourceName
  title: string
  currentPageTitle: string
  pageTitle: string
  routeSegment: string
  defaultSectionColumns: string[]
  defaultPageColumns: string[]
  fields: PipelineFieldConfig[]
}

export const PIPELINE_RESOURCE_CONFIG: Record<PipelineResourceName, PipelineResourceConfig> = {
  timelines: {
    resource: 'timelines',
    title: '时间线',
    currentPageTitle: '时间线列表',
    pageTitle: '时间线管理',
    routeSegment: 'timelines',
    defaultSectionColumns: ['time_node', 'event'],
    defaultPageColumns: ['id', 'time_node', 'event', 'sort_order', 'created_at'],
    fields: [
      { key: 'id', label: 'ID', type: 'number', readonly: true },
      { key: 'novel_id', label: 'Novel ID', type: 'number', readonly: true },
      { key: 'time_node', label: '时间节点', type: 'text', editable: true },
      { key: 'event', label: '事件', type: 'textarea', editable: true },
      { key: 'sort_order', label: '排序', type: 'number', editable: true },
      { key: 'revision_notes_json', label: '修订记录', type: 'json', readonly: true },
      { key: 'created_at', label: '创建时间', type: 'text', readonly: true },
    ],
  },
  characters: {
    resource: 'characters',
    title: '人物',
    currentPageTitle: '人物列表',
    pageTitle: '人物管理',
    routeSegment: 'characters',
    defaultSectionColumns: ['name', 'faction', 'description'],
    defaultPageColumns: [
      'id',
      'name',
      'faction',
      'description',
      'personality',
      'setting_words',
      'image_path',
      'sort_order',
      'created_at',
    ],
    fields: [
      { key: 'id', label: 'ID', type: 'number', readonly: true },
      { key: 'novel_id', label: 'Novel ID', type: 'number', readonly: true },
      { key: 'name', label: '人物名', type: 'text', editable: true },
      { key: 'faction', label: '阵营', type: 'text', editable: true },
      { key: 'description', label: '人物描述', type: 'textarea', editable: true },
      { key: 'personality', label: '性格', type: 'textarea', editable: true },
      { key: 'setting_words', label: '设定关键词', type: 'textarea', editable: true },
      { key: 'image_path', label: '图片路径', type: 'text', editable: true },
      { key: 'sort_order', label: '排序', type: 'number', editable: true },
      { key: 'revision_notes_json', label: '修订记录', type: 'json', readonly: true },
      { key: 'created_at', label: '创建时间', type: 'text', readonly: true },
    ],
  },
  'key-nodes': {
    resource: 'key-nodes',
    title: '关键节点',
    currentPageTitle: '关键节点列表',
    pageTitle: '关键节点管理',
    routeSegment: 'key-nodes',
    defaultSectionColumns: ['category', 'title', 'description'],
    defaultPageColumns: ['id', 'category', 'title', 'description', 'timeline_id', 'sort_order', 'created_at'],
    fields: [
      { key: 'id', label: 'ID', type: 'number', readonly: true },
      { key: 'novel_id', label: 'Novel ID', type: 'number', readonly: true },
      { key: 'timeline_id', label: 'Timeline ID', type: 'number', editable: true },
      { key: 'category', label: '分类', type: 'text', editable: true },
      { key: 'title', label: '标题', type: 'text', editable: true },
      { key: 'description', label: '描述', type: 'textarea', editable: true },
      { key: 'sort_order', label: '排序', type: 'number', editable: true },
      { key: 'revision_notes_json', label: '修订记录', type: 'json', readonly: true },
      { key: 'created_at', label: '创建时间', type: 'text', readonly: true },
    ],
  },
  explosions: {
    resource: 'explosions',
    title: '爆点',
    currentPageTitle: '爆点列表',
    pageTitle: '爆点管理',
    routeSegment: 'explosions',
    defaultSectionColumns: ['explosion_type', 'title', 'subtitle'],
    defaultPageColumns: [
      'id',
      'explosion_type',
      'title',
      'subtitle',
      'scene_restoration',
      'dramatic_quality',
      'adaptability',
      'timeline_id',
      'sort_order',
      'created_at',
    ],
    fields: [
      { key: 'id', label: 'ID', type: 'number', readonly: true },
      { key: 'novel_id', label: 'Novel ID', type: 'number', readonly: true },
      { key: 'timeline_id', label: 'Timeline ID', type: 'number', editable: true },
      { key: 'explosion_type', label: '爆点类型', type: 'text', editable: true },
      { key: 'title', label: '标题', type: 'text', editable: true },
      { key: 'subtitle', label: '副标题', type: 'text', editable: true },
      { key: 'scene_restoration', label: '场景还原', type: 'textarea', editable: true },
      { key: 'dramatic_quality', label: '戏剧性', type: 'textarea', editable: true },
      { key: 'adaptability', label: '短剧适配性', type: 'textarea', editable: true },
      { key: 'sort_order', label: '排序', type: 'number', editable: true },
      { key: 'revision_notes_json', label: '修订记录', type: 'json', readonly: true },
      { key: 'created_at', label: '创建时间', type: 'text', readonly: true },
    ],
  },
  'skeleton-topics': {
    resource: 'skeleton-topics',
    title: '骨架主题',
    currentPageTitle: '骨架主题',
    pageTitle: '骨架主题管理',
    routeSegment: 'skeleton-topics',
    defaultSectionColumns: ['topic_name', 'topic_key', 'topic_type', 'is_enabled'],
    defaultPageColumns: ['id', 'topic_key', 'topic_name', 'topic_type', 'description', 'sort_order', 'is_enabled', 'created_at'],
    fields: [
      { key: 'id', label: 'ID', type: 'number', readonly: true },
      { key: 'novel_id', label: 'Novel ID', type: 'number', readonly: true },
      { key: 'topic_key', label: 'Topic Key', type: 'text', editable: true },
      { key: 'topic_name', label: 'Topic Name', type: 'text', editable: true },
      { key: 'topic_type', label: 'Topic Type', type: 'text', editable: true },
      { key: 'description', label: '描述', type: 'textarea', editable: true },
      { key: 'sort_order', label: '排序', type: 'number', editable: true },
      { key: 'is_enabled', label: '启用', type: 'boolean', editable: true },
      { key: 'created_at', label: '创建时间', type: 'text', readonly: true },
      { key: 'updated_at', label: '更新时间', type: 'text', readonly: true },
    ],
  },
  'skeleton-topic-items': {
    resource: 'skeleton-topic-items',
    title: '骨架主题内容',
    currentPageTitle: '骨架主题抽取结果（Topic Items）',
    pageTitle: '骨架主题内容管理',
    routeSegment: 'skeleton-topic-items',
    defaultSectionColumns: ['topic_id', 'item_title', 'content'],
    defaultPageColumns: ['id', 'topic_id', 'item_title', 'content', 'content_json', 'source_ref', 'sort_order', 'created_at'],
    fields: [
      { key: 'id', label: 'ID', type: 'number', readonly: true },
      { key: 'novel_id', label: 'Novel ID', type: 'number', readonly: true },
      { key: 'topic_id', label: 'Topic ID', type: 'number', editable: true },
      { key: 'item_title', label: '条目标题', type: 'text', editable: true },
      { key: 'content', label: '内容', type: 'textarea', editable: true },
      { key: 'content_json', label: 'JSON 内容', type: 'json', editable: true },
      { key: 'source_ref', label: '来源引用', type: 'text', editable: true },
      { key: 'sort_order', label: '排序', type: 'number', editable: true },
      { key: 'revision_notes_json', label: '修订记录', type: 'json', readonly: true },
      { key: 'created_at', label: '创建时间', type: 'text', readonly: true },
      { key: 'updated_at', label: '更新时间', type: 'text', readonly: true },
    ],
  },
}

export function getPipelineResourceConfig(resource: PipelineResourceName): PipelineResourceConfig {
  return PIPELINE_RESOURCE_CONFIG[resource]
}

export function getPipelineColumnStorageKey(
  resource: PipelineResourceName,
  novelId: number,
  scope: 'section' | 'page'
) {
  return `pipeline-columns:${scope}:${resource}:novel:${novelId}`
}
