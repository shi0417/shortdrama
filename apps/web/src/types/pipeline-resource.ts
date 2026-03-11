export type PipelineResourceName =
  | 'timelines'
  | 'characters'
  | 'key-nodes'
  | 'explosions'
  | 'skeleton-topics'
  | 'skeleton-topic-items'
  | 'payoff-arch'
  | 'payoff-lines'
  | 'opponent-matrix'
  | 'opponents'
  | 'power-ladder'
  | 'traitor-system'
  | 'traitors'
  | 'traitor-stages'
  | 'story-phases'

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
  'payoff-arch': {
    resource: 'payoff-arch',
    title: '爽点架构',
    currentPageTitle: '核心爽点架构',
    pageTitle: '爽点架构管理',
    routeSegment: 'payoff-arch',
    defaultSectionColumns: ['name', 'notes'],
    defaultPageColumns: ['id', 'name', 'notes', 'version', 'is_active', 'created_at', 'updated_at'],
    fields: [
      { key: 'id', label: 'ID', type: 'number', readonly: true },
      { key: 'novel_id', label: 'Novel ID', type: 'number', readonly: true },
      { key: 'name', label: '架构名称', type: 'text', editable: true },
      { key: 'notes', label: '总体说明', type: 'textarea', editable: true },
      { key: 'version', label: '版本', type: 'number', editable: true },
      { key: 'is_active', label: '启用', type: 'boolean', editable: true },
      { key: 'created_at', label: '创建时间', type: 'text', readonly: true },
      { key: 'updated_at', label: '更新时间', type: 'text', readonly: true },
    ],
  },
  'payoff-lines': {
    resource: 'payoff-lines',
    title: '爽点线',
    currentPageTitle: '爽点线明细',
    pageTitle: '爽点线管理',
    routeSegment: 'payoff-lines',
    defaultSectionColumns: ['line_name', 'line_content', 'stage_text'],
    defaultPageColumns: [
      'id',
      'payoff_arch_id',
      'line_key',
      'line_name',
      'line_content',
      'start_ep',
      'end_ep',
      'stage_text',
      'sort_order',
      'created_at',
      'updated_at',
    ],
    fields: [
      { key: 'id', label: 'ID', type: 'number', readonly: true },
      { key: 'novel_id', label: 'Novel ID', type: 'number', readonly: true },
      { key: 'payoff_arch_id', label: 'Payoff Arch ID', type: 'number', editable: true },
      { key: 'line_key', label: '线 Key', type: 'text', editable: true },
      { key: 'line_name', label: '爽点线名称', type: 'text', editable: true },
      { key: 'line_content', label: '爽点线内容', type: 'textarea', editable: true },
      { key: 'start_ep', label: '开始集', type: 'number', editable: true },
      { key: 'end_ep', label: '结束集', type: 'number', editable: true },
      { key: 'stage_text', label: '阶段文本', type: 'text', editable: true },
      { key: 'sort_order', label: '排序', type: 'number', editable: true },
      { key: 'created_at', label: '创建时间', type: 'text', readonly: true },
      { key: 'updated_at', label: '更新时间', type: 'text', readonly: true },
    ],
  },
  'opponent-matrix': {
    resource: 'opponent-matrix',
    title: '对手矩阵',
    currentPageTitle: '对手矩阵',
    pageTitle: '对手矩阵管理',
    routeSegment: 'opponent-matrix',
    defaultSectionColumns: ['name', 'description'],
    defaultPageColumns: ['id', 'name', 'description', 'version', 'is_active', 'created_at', 'updated_at'],
    fields: [
      { key: 'id', label: 'ID', type: 'number', readonly: true },
      { key: 'novel_id', label: 'Novel ID', type: 'number', readonly: true },
      { key: 'name', label: '矩阵名称', type: 'text', editable: true },
      { key: 'description', label: '整体说明', type: 'textarea', editable: true },
      { key: 'version', label: '版本', type: 'number', editable: true },
      { key: 'is_active', label: '启用', type: 'boolean', editable: true },
      { key: 'created_at', label: '创建时间', type: 'text', readonly: true },
      { key: 'updated_at', label: '更新时间', type: 'text', readonly: true },
    ],
  },
  opponents: {
    resource: 'opponents',
    title: '对手明细',
    currentPageTitle: '对手明细',
    pageTitle: '对手明细管理',
    routeSegment: 'opponents',
    defaultSectionColumns: ['level_name', 'opponent_name', 'threat_type'],
    defaultPageColumns: [
      'id',
      'opponent_matrix_id',
      'level_name',
      'opponent_name',
      'threat_type',
      'detailed_desc',
      'sort_order',
      'created_at',
    ],
    fields: [
      { key: 'id', label: 'ID', type: 'number', readonly: true },
      { key: 'novel_id', label: 'Novel ID', type: 'number', readonly: true },
      { key: 'opponent_matrix_id', label: 'Opponent Matrix ID', type: 'number', editable: true },
      { key: 'level_name', label: '层级名', type: 'text', editable: true },
      { key: 'opponent_name', label: '对手名称', type: 'text', editable: true },
      { key: 'threat_type', label: '威胁方式', type: 'text', editable: true },
      { key: 'detailed_desc', label: '详细描述', type: 'textarea', editable: true },
      { key: 'sort_order', label: '排序', type: 'number', editable: true },
      { key: 'created_at', label: '创建时间', type: 'text', readonly: true },
    ],
  },
  'power-ladder': {
    resource: 'power-ladder',
    title: '权力阶梯',
    currentPageTitle: '权力升级阶梯',
    pageTitle: '权力升级阶梯管理',
    routeSegment: 'power-ladder',
    defaultSectionColumns: ['level_no', 'level_title', 'identity_desc'],
    defaultPageColumns: [
      'id',
      'level_no',
      'level_title',
      'identity_desc',
      'ability_boundary',
      'start_ep',
      'end_ep',
      'sort_order',
      'created_at',
    ],
    fields: [
      { key: 'id', label: 'ID', type: 'number', readonly: true },
      { key: 'novel_id', label: 'Novel ID', type: 'number', readonly: true },
      { key: 'level_no', label: '等级序号', type: 'number', editable: true },
      { key: 'level_title', label: '等级标题', type: 'text', editable: true },
      { key: 'identity_desc', label: '身份描述', type: 'textarea', editable: true },
      { key: 'ability_boundary', label: '能力边界', type: 'textarea', editable: true },
      { key: 'start_ep', label: '开始集', type: 'number', editable: true },
      { key: 'end_ep', label: '结束集', type: 'number', editable: true },
      { key: 'sort_order', label: '排序', type: 'number', editable: true },
      { key: 'created_at', label: '创建时间', type: 'text', readonly: true },
    ],
  },
  'traitor-system': {
    resource: 'traitor-system',
    title: '内鬼系统',
    currentPageTitle: '内鬼系统',
    pageTitle: '内鬼系统管理',
    routeSegment: 'traitor-system',
    defaultSectionColumns: ['name', 'description'],
    defaultPageColumns: ['id', 'name', 'description', 'version', 'is_active', 'created_at'],
    fields: [
      { key: 'id', label: 'ID', type: 'number', readonly: true },
      { key: 'novel_id', label: 'Novel ID', type: 'number', readonly: true },
      { key: 'name', label: '系统名称', type: 'text', editable: true },
      { key: 'description', label: '系统描述', type: 'textarea', editable: true },
      { key: 'version', label: '版本', type: 'number', editable: true },
      { key: 'is_active', label: '启用', type: 'boolean', editable: true },
      { key: 'created_at', label: '创建时间', type: 'text', readonly: true },
    ],
  },
  traitors: {
    resource: 'traitors',
    title: '内鬼角色',
    currentPageTitle: '内鬼角色',
    pageTitle: '内鬼角色管理',
    routeSegment: 'traitors',
    defaultSectionColumns: ['name', 'public_identity', 'real_identity'],
    defaultPageColumns: [
      'id',
      'traitor_system_id',
      'name',
      'public_identity',
      'real_identity',
      'mission',
      'threat_desc',
      'sort_order',
      'created_at',
    ],
    fields: [
      { key: 'id', label: 'ID', type: 'number', readonly: true },
      { key: 'novel_id', label: 'Novel ID', type: 'number', readonly: true },
      { key: 'traitor_system_id', label: 'Traitor System ID', type: 'number', editable: true },
      { key: 'name', label: '角色名', type: 'text', editable: true },
      { key: 'public_identity', label: '表面身份', type: 'text', editable: true },
      { key: 'real_identity', label: '真实身份', type: 'text', editable: true },
      { key: 'mission', label: '任务目标', type: 'textarea', editable: true },
      { key: 'threat_desc', label: '威胁描述', type: 'textarea', editable: true },
      { key: 'sort_order', label: '排序', type: 'number', editable: true },
      { key: 'created_at', label: '创建时间', type: 'text', readonly: true },
    ],
  },
  'traitor-stages': {
    resource: 'traitor-stages',
    title: '内鬼阶段',
    currentPageTitle: '内鬼阶段',
    pageTitle: '内鬼阶段管理',
    routeSegment: 'traitor-stages',
    defaultSectionColumns: ['stage_title', 'stage_desc', 'start_ep', 'end_ep'],
    defaultPageColumns: [
      'id',
      'traitor_system_id',
      'stage_title',
      'stage_desc',
      'start_ep',
      'end_ep',
      'sort_order',
      'created_at',
    ],
    fields: [
      { key: 'id', label: 'ID', type: 'number', readonly: true },
      { key: 'novel_id', label: 'Novel ID', type: 'number', readonly: true },
      { key: 'traitor_system_id', label: 'Traitor System ID', type: 'number', editable: true },
      { key: 'stage_title', label: '阶段标题', type: 'text', editable: true },
      { key: 'stage_desc', label: '阶段描述', type: 'textarea', editable: true },
      { key: 'start_ep', label: '开始集', type: 'number', editable: true },
      { key: 'end_ep', label: '结束集', type: 'number', editable: true },
      { key: 'sort_order', label: '排序', type: 'number', editable: true },
      { key: 'created_at', label: '创建时间', type: 'text', readonly: true },
    ],
  },
  'story-phases': {
    resource: 'story-phases',
    title: '故事阶段',
    currentPageTitle: '故事发展阶段',
    pageTitle: '故事发展阶段管理',
    routeSegment: 'story-phases',
    defaultSectionColumns: ['phase_name', 'historical_path', 'rewrite_path'],
    defaultPageColumns: [
      'id',
      'phase_name',
      'start_ep',
      'end_ep',
      'historical_path',
      'rewrite_path',
      'sort_order',
      'created_at',
    ],
    fields: [
      { key: 'id', label: 'ID', type: 'number', readonly: true },
      { key: 'novel_id', label: 'Novel ID', type: 'number', readonly: true },
      { key: 'phase_name', label: '阶段名', type: 'text', editable: true },
      { key: 'start_ep', label: '开始集', type: 'number', editable: true },
      { key: 'end_ep', label: '结束集', type: 'number', editable: true },
      { key: 'historical_path', label: '历史走向', type: 'textarea', editable: true },
      { key: 'rewrite_path', label: '改写走向', type: 'textarea', editable: true },
      { key: 'sort_order', label: '排序', type: 'number', editable: true },
      { key: 'created_at', label: '创建时间', type: 'text', readonly: true },
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
