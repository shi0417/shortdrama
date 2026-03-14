import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { SourceRetrievalService } from '../source-texts/source-retrieval.service';

/** 核心三表（必选） */
export const CORE_REFERENCE_TABLES = [
  'novel_episodes',
  'drama_structure_template',
  'novel_hook_rhythm',
] as const;

/** 扩展参考表（可选，表存在则读） */
export const EXTENDED_REFERENCE_TABLES = [
  'drama_novels',
  'drama_source_text',
  'novel_adaptation_strategy',
  'novel_characters',
  'novel_explosions',
  'novel_key_nodes',
  'novel_skeleton_topic_items',
  'novel_skeleton_topics',
  'novel_source_segments',
  'novel_timelines',
  'set_core',
  'set_opponent_matrix',
  'set_opponents',
  'set_payoff_arch',
  'set_payoff_lines',
  'set_power_ladder',
  'set_story_phases',
  'set_traitor_stages',
  'set_traitor_system',
  'set_traitors',
] as const;

/** narrator 默认扩展表 */
export const NARRATOR_DEFAULT_EXTENSION: string[] = [
  'set_core',
  'set_payoff_arch',
  'set_payoff_lines',
  'set_opponents',
  'set_power_ladder',
  'set_story_phases',
  'novel_characters',
  'novel_key_nodes',
  'novel_timelines',
];

/** episode-script 默认扩展表（保守） */
export const EPISODE_SCRIPT_DEFAULT_EXTENSION: string[] = [
  'set_core',
  'novel_characters',
  'novel_key_nodes',
  'novel_timelines',
  'set_payoff_arch',
  'set_payoff_lines',
  'set_opponents',
  'set_power_ladder',
];

export type CoreTableName = (typeof CORE_REFERENCE_TABLES)[number];
export type ExtendedTableName = (typeof EXTENDED_REFERENCE_TABLES)[number];

export interface PipelineReferenceContext {
  novel: Record<string, unknown> | null;
  episodes: Record<string, unknown>[];
  structureTemplates: Record<string, unknown>[];
  hookRhythms: Record<string, unknown>[];
  optionalTables: Record<string, Record<string, unknown>[]>;
  meta: {
    requestedTables: string[];
    existingTables: string[];
    missingTables: string[];
    episodeNumbers: number[];
  };
}

export interface GetContextOptions {
  episodeNumbers?: number[];
  startEpisode?: number;
  endEpisode?: number;
  requestedTables?: string[];
  overallCharBudget?: number;
  optionalTablesCharBudget?: number;
  perTableMaxChars?: number;
}

export interface TableBlockSummary {
  table: string;
  label: string;
  rowCount: number;
  fields: string[];
  usedChars?: number;
}

const DEFAULT_OVERALL_CHAR_BUDGET = 60000;
const DEFAULT_OPTIONAL_CHAR_BUDGET = 25000;
const DEFAULT_PER_TABLE_MAX_CHARS = 4000;
const WORLDVIEW_TRIM_FIELD = 600;

/** 扩展表配置：label, sql, fields；params 缺省为 [novelId]，无 novelId 的表传 params: [] */
const EXTENDED_TABLE_CONFIG: Record<
  string,
  { label: string; sql: string; fields: string[]; params?: unknown[] }
> = {
  adaptation_modes: {
    label: '改编模式',
    sql: `SELECT mode_key, mode_name, description FROM adaptation_modes ORDER BY id ASC`,
    fields: ['mode_key', 'mode_name', 'description'],
    params: [],
  },
  drama_novels: {
    label: '项目主信息',
    sql: `SELECT id, novels_name, total_chapters, power_up_interval, author, description, status
          FROM drama_novels WHERE id = ? LIMIT 1`,
    fields: ['id', 'novels_name', 'total_chapters', 'power_up_interval', 'author', 'description', 'status'],
  },
  novel_adaptation_strategy: {
    label: '改编策略',
    sql: `SELECT strategy_title, strategy_description, ai_prompt_template, version
          FROM novel_adaptation_strategy WHERE novel_id = ? ORDER BY version DESC, id DESC LIMIT 5`,
    fields: ['strategy_title', 'strategy_description', 'ai_prompt_template', 'version'],
  },
  novel_characters: {
    label: '人物',
    sql: `SELECT name, faction, description, personality FROM novel_characters WHERE novel_id = ? ORDER BY sort_order ASC, id ASC`,
    fields: ['name', 'faction', 'description', 'personality'],
  },
  novel_explosions: {
    label: '爆点',
    sql: `SELECT explosion_type, title, subtitle, scene_restoration, dramatic_quality, adaptability, sort_order
          FROM novel_explosions WHERE novel_id = ? ORDER BY sort_order ASC, id ASC`,
    fields: ['explosion_type', 'title', 'subtitle', 'scene_restoration', 'dramatic_quality', 'adaptability', 'sort_order'],
  },
  novel_key_nodes: {
    label: '关键节点',
    sql: `SELECT category, title, description, timeline_id, sort_order FROM novel_key_nodes WHERE novel_id = ? ORDER BY sort_order ASC, id ASC`,
    fields: ['category', 'title', 'description', 'timeline_id', 'sort_order'],
  },
  novel_skeleton_topic_items: {
    label: '骨架主题详情',
    sql: `SELECT topic_id, item_title, content, content_json, sort_order
          FROM novel_skeleton_topic_items WHERE novel_id = ? ORDER BY sort_order ASC, id ASC`,
    fields: ['topic_id', 'item_title', 'content', 'content_json', 'sort_order'],
  },
  novel_skeleton_topics: {
    label: '骨架主题',
    sql: `SELECT topic_key, topic_name, topic_type, description, sort_order
          FROM novel_skeleton_topics WHERE novel_id = ? AND is_enabled = 1 ORDER BY sort_order ASC, id ASC`,
    fields: ['topic_key', 'topic_name', 'topic_type', 'description', 'sort_order'],
  },
  novel_timelines: {
    label: '时间线',
    sql: `SELECT time_node, event, sort_order FROM novel_timelines WHERE novel_id = ? ORDER BY sort_order ASC, id ASC`,
    fields: ['time_node', 'event', 'sort_order'],
  },
  set_core: {
    label: '核心设定',
    sql: `SELECT title, core_text, protagonist_name, protagonist_identity, target_story, rewrite_goal, constraint_text
          FROM set_core WHERE novel_id = ? AND is_active = 1 ORDER BY version DESC, id DESC LIMIT 1`,
    fields: ['title', 'core_text', 'protagonist_name', 'protagonist_identity', 'target_story', 'rewrite_goal', 'constraint_text'],
  },
  set_opponent_matrix: {
    label: '对手矩阵',
    sql: `SELECT name, description FROM set_opponent_matrix WHERE novel_id = ? ORDER BY version DESC, id DESC LIMIT 1`,
    fields: ['name', 'description'],
  },
  set_opponents: {
    label: '对手明细',
    sql: `SELECT level_name, opponent_name, threat_type, detailed_desc, sort_order
          FROM set_opponents WHERE novel_id = ? ORDER BY sort_order ASC, id ASC`,
    fields: ['level_name', 'opponent_name', 'threat_type', 'detailed_desc', 'sort_order'],
  },
  set_payoff_arch: {
    label: '爽点架构',
    sql: `SELECT name, notes FROM set_payoff_arch WHERE novel_id = ? ORDER BY version DESC, id DESC LIMIT 1`,
    fields: ['name', 'notes'],
  },
  set_payoff_lines: {
    label: '爽点线',
    sql: `SELECT line_key, line_name, line_content, start_ep, end_ep, stage_text, sort_order
          FROM set_payoff_lines WHERE novel_id = ? ORDER BY sort_order ASC, id ASC`,
    fields: ['line_key', 'line_name', 'line_content', 'start_ep', 'end_ep', 'stage_text', 'sort_order'],
  },
  set_power_ladder: {
    label: '权力阶梯',
    sql: `SELECT level_no, level_title, identity_desc, ability_boundary, start_ep, end_ep
          FROM set_power_ladder WHERE novel_id = ? ORDER BY sort_order ASC, id ASC`,
    fields: ['level_no', 'level_title', 'identity_desc', 'ability_boundary', 'start_ep', 'end_ep'],
  },
  set_story_phases: {
    label: '故事阶段',
    sql: `SELECT phase_name, start_ep, end_ep, historical_path, rewrite_path, sort_order
          FROM set_story_phases WHERE novel_id = ? ORDER BY sort_order ASC, id ASC`,
    fields: ['phase_name', 'start_ep', 'end_ep', 'historical_path', 'rewrite_path', 'sort_order'],
  },
  set_traitor_stages: {
    label: '内鬼阶段',
    sql: `SELECT stage_title, stage_desc, start_ep, end_ep, sort_order
          FROM set_traitor_stages WHERE novel_id = ? ORDER BY sort_order ASC, id ASC`,
    fields: ['stage_title', 'stage_desc', 'start_ep', 'end_ep', 'sort_order'],
  },
  set_traitor_system: {
    label: '内鬼系统',
    sql: `SELECT name, description FROM set_traitor_system WHERE novel_id = ? ORDER BY version DESC, id DESC LIMIT 1`,
    fields: ['name', 'description'],
  },
  set_traitors: {
    label: '内鬼角色',
    sql: `SELECT name, public_identity, real_identity, mission, threat_desc, sort_order
          FROM set_traitors WHERE novel_id = ? ORDER BY sort_order ASC, id ASC`,
    fields: ['name', 'public_identity', 'real_identity', 'mission', 'threat_desc', 'sort_order'],
  },
};

/** 共享服务可提供单表 block 的表名集合（含 drama_source_text / novel_source_segments 等需特殊取数的表） */
export const SHARED_SERVICE_TABLE_NAMES = new Set<string>([
  ...Object.keys(EXTENDED_TABLE_CONFIG),
  'drama_source_text',
  'novel_source_segments',
]);

@Injectable()
export class PipelineReferenceContextService {
  private readonly logger = new Logger(PipelineReferenceContextService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly sourceRetrievalService: SourceRetrievalService,
  ) {}

  async hasTable(tableName: string): Promise<boolean> {
    const raw: any = await this.dataSource.query(
      `SELECT COUNT(*) AS cnt FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = ?`,
      [tableName],
    );
    const row = Array.isArray(raw) ? raw[0] : raw;
    return Number((row as Record<string, unknown>)?.cnt || 0) > 0;
  }

  /**
   * 获取结构化参考上下文：核心三表 + 请求的扩展表。
   * 表不存在时记录到 meta.missingTables，不抛错。
   */
  async getContext(
    novelId: number,
    options: GetContextOptions = {},
  ): Promise<PipelineReferenceContext> {
    const {
      episodeNumbers: requestedEpisodes,
      startEpisode,
      endEpisode,
      requestedTables = [],
      overallCharBudget = DEFAULT_OVERALL_CHAR_BUDGET,
      optionalTablesCharBudget = DEFAULT_OPTIONAL_CHAR_BUDGET,
      perTableMaxChars = DEFAULT_PER_TABLE_MAX_CHARS,
    } = options;

    const existingTables: string[] = [];
    const missingTables: string[] = [];
    const tablesToCheck = [...CORE_REFERENCE_TABLES, ...new Set(requestedTables)];

    for (const t of tablesToCheck) {
      const exists = await this.hasTable(t);
      if (exists) existingTables.push(t);
      else if (requestedTables.includes(t) || CORE_REFERENCE_TABLES.includes(t as CoreTableName))
        missingTables.push(t);
    }

    let episodes: Record<string, unknown>[] = [];
    let structureTemplates: Record<string, unknown>[] = [];
    let hookRhythms: Record<string, unknown>[] = [];
    let novel: Record<string, unknown> | null = null;

    if (existingTables.includes('novel_episodes')) {
      const rows = await this.dataSource.query(
        `SELECT id, novel_id, episode_number, episode_title, arc, opening, core_conflict, hooks, cliffhanger,
                full_content, outline_content, history_outline, rewrite_diff, structure_template_id, sort_order
         FROM novel_episodes WHERE novel_id = ? ORDER BY episode_number ASC, id ASC`,
        [novelId],
      );
      let list = (rows || []) as Record<string, unknown>[];
      if (startEpisode != null) list = list.filter((r) => Number(r.episode_number) >= startEpisode);
      if (endEpisode != null) list = list.filter((r) => Number(r.episode_number) <= endEpisode);
      if (requestedEpisodes?.length) {
        const set = new Set(requestedEpisodes);
        list = list.filter((r) => set.has(Number(r.episode_number)));
      }
      episodes = list;
    }

    if (existingTables.includes('drama_structure_template')) {
      const rows = await this.dataSource.query(
        `SELECT id, novels_id, chapter_id, power_level, structure_name, identity_gap, pressure_source,
                first_reverse, continuous_upgrade, suspense_hook, typical_opening, suitable_theme, hot_level, remarks
         FROM drama_structure_template WHERE novels_id = ? ORDER BY chapter_id ASC, id ASC`,
        [novelId],
      );
      structureTemplates = (rows || []) as Record<string, unknown>[];
    }

    if (existingTables.includes('novel_hook_rhythm')) {
      const rows = await this.dataSource.query(
        `SELECT id, novel_id, episode_number, emotion_level, hook_type, description, cliffhanger
         FROM novel_hook_rhythm WHERE novel_id = ? ORDER BY episode_number ASC, id ASC`,
        [novelId],
      );
      let list = (rows || []) as Record<string, unknown>[];
      if (startEpisode != null) list = list.filter((r) => Number(r.episode_number) >= startEpisode);
      if (endEpisode != null) list = list.filter((r) => Number(r.episode_number) <= endEpisode);
      if (requestedEpisodes?.length) {
        const set = new Set(requestedEpisodes);
        list = list.filter((r) => set.has(Number(r.episode_number)));
      }
      hookRhythms = list;
    }

    if (existingTables.includes('drama_novels')) {
      const rows = await this.dataSource.query(
        `SELECT id, novels_name, total_chapters, power_up_interval, author, description, status
         FROM drama_novels WHERE id = ? LIMIT 1`,
        [novelId],
      );
      const arr = Array.isArray(rows) ? rows : [rows];
      novel = (arr[0] as Record<string, unknown>) || null;
    }

    const episodeNumbers = [...new Set(episodes.map((e) => Number(e.episode_number)))].sort((a, b) => a - b);
    const optionalTables: Record<string, Record<string, unknown>[]> = {};
    let usedOptionalChars = 0;
    const optionalBudget = Math.min(optionalTablesCharBudget, overallCharBudget);

    for (const tableName of requestedTables) {
      if (usedOptionalChars >= optionalBudget) break;
      if (tableName === 'drama_source_text') {
        if (!existingTables.includes(tableName)) continue;
        try {
          const r = await this.getDramaSourceTextBlock(novelId, optionalBudget - usedOptionalChars);
          optionalTables[tableName] = [{ block: r.block, rowCount: r.rowCount, usedChars: r.usedChars }];
          usedOptionalChars += r.usedChars;
        } catch {
          missingTables.push(tableName);
        }
        continue;
      }
      if (tableName === 'novel_source_segments') {
        if (!existingTables.includes(tableName) || !this.sourceRetrievalService) continue;
        try {
          const evidence = await this.sourceRetrievalService.buildWorldviewEvidence(
            novelId,
            optionalBudget - usedOptionalChars,
          );
          optionalTables[tableName] = [
            {
              block: evidence.block,
              segmentCount: evidence.segmentCount,
              evidenceChars: evidence.evidenceChars,
              usedFallback: evidence.usedFallback,
            },
          ];
          usedOptionalChars += evidence.evidenceChars;
        } catch {
          missingTables.push(tableName);
        }
        continue;
      }
      if (!existingTables.includes(tableName) || !EXTENDED_TABLE_CONFIG[tableName]) continue;
      const cfg = EXTENDED_TABLE_CONFIG[tableName];
      const params = cfg.params ?? [novelId];
      try {
        const rows = await this.dataSource.query(cfg.sql, params) as Record<string, unknown>[];
        const maxPerRow = Math.min(WORLDVIEW_TRIM_FIELD, Math.floor((optionalBudget - usedOptionalChars) / Math.max(1, (rows?.length || 0))));
        const simplified = (rows || []).slice(0, 30).map((row) => {
          const out: Record<string, unknown> = {};
          cfg.fields.forEach((f) => {
            const v = row[f];
            out[f] = typeof v === 'string' && (v as string).length > maxPerRow ? (v as string).slice(0, maxPerRow) + '...' : v;
          });
          return out;
        });
        const blockLen = JSON.stringify(simplified).length;
        if (blockLen + usedOptionalChars > optionalBudget) break;
        usedOptionalChars += blockLen;
        optionalTables[tableName] = simplified;
      } catch {
        missingTables.push(tableName);
      }
    }

    return {
      novel,
      episodes,
      structureTemplates,
      hookRhythms,
      optionalTables,
      meta: {
        requestedTables: [...CORE_REFERENCE_TABLES, ...requestedTables],
        existingTables,
        missingTables,
        episodeNumbers,
      },
    };
  }

  /**
   * 构建供 narrator LLM 使用的世界观/参考字符串块（仅扩展表部分；分集信息由调用方从 context.episodes 等拼）。
   */
  buildNarratorPromptContext(
    context: PipelineReferenceContext,
    options: { charBudget?: number } = {},
  ): string {
    const budget = options.charBudget ?? DEFAULT_OPTIONAL_CHAR_BUDGET;
    const sections: string[] = [];
    let used = 0;
    const labelFor = (name: string) =>
      EXTENDED_TABLE_CONFIG[name]?.label ?? (name === 'drama_source_text' ? '原始素材补充' : name === 'novel_source_segments' ? '原始素材切片证据' : name);
    for (const [tableName, rows] of Object.entries(context.optionalTables)) {
      if (used >= budget) break;
      const label = labelFor(tableName);
      const block = `【${label}（${tableName}）】\n${JSON.stringify(rows, null, 2)}`;
      const len = block.length;
      if (used + len > budget) {
        sections.push(block.slice(0, budget - used) + '\n...(截断)');
        used = budget;
      } else {
        sections.push(block);
        used += len;
      }
    }
    return sections.length ? sections.join('\n\n') : '';
  }

  /**
   * 从 context 构建参考摘要（供 narrator preview 等返回 referenceSummary）。
   */
  buildReferenceSummary(context: PipelineReferenceContext): TableBlockSummary[] {
    const labelFor = (name: string) =>
      EXTENDED_TABLE_CONFIG[name]?.label ?? (name === 'drama_source_text' ? '原始素材补充' : name === 'novel_source_segments' ? '原始素材切片证据' : name);
    const out: TableBlockSummary[] = [];
    for (const [tableName, rows] of Object.entries(context.optionalTables)) {
      const arr = Array.isArray(rows) ? rows : [];
      const row0 = arr[0];
      const fields = row0 && typeof row0 === 'object' && !Array.isArray(row0) ? Object.keys(row0 as object) : [];
      out.push({
        table: tableName,
        label: labelFor(tableName),
        rowCount: arr.length,
        fields,
      });
    }
    return out;
  }

  /**
   * 构建供 episode-script 使用的参考块（扩展表部分），与 narrator 共享数据格式，字符预算可控。
   */
  buildEpisodeScriptPromptContext(
    context: PipelineReferenceContext,
    options: { charBudget?: number; requestedTables?: string[] } = {},
  ): string {
    const budget = options.charBudget ?? DEFAULT_OPTIONAL_CHAR_BUDGET;
    const requested = new Set(options.requestedTables ?? Object.keys(context.optionalTables));
    const sections: string[] = [];
    let used = 0;
    const labelFor = (name: string) =>
      EXTENDED_TABLE_CONFIG[name]?.label ?? (name === 'drama_source_text' ? '原始素材补充' : name === 'novel_source_segments' ? '原始素材切片证据' : name);
    for (const [tableName, rows] of Object.entries(context.optionalTables)) {
      if (!requested.has(tableName) || used >= budget) continue;
      const label = labelFor(tableName);
      const block = `【${label}（${tableName}）】\n${JSON.stringify(rows, null, 2)}`;
      const len = block.length;
      if (used + len > budget) {
        sections.push(block.slice(0, budget - used) + '\n...(截断)');
        used = budget;
      } else {
        sections.push(block);
        used += len;
      }
    }
    return sections.join('\n\n');
  }

  /**
   * drama_source_text 按字符预算取块（与 episode-script getRawSourceTextBlock 逻辑统一）。
   */
  private async getDramaSourceTextBlock(
    novelId: number,
    charBudget: number,
  ): Promise<{ block: string; rowCount: number; usedChars: number }> {
    const rows = await this.dataSource.query(
      `SELECT id, source_text AS sourceText FROM drama_source_text WHERE novels_id = ? ORDER BY id ASC`,
      [novelId],
    ) as Array<{ id: number; sourceText: string | null }>;
    if (!rows?.length) {
      return { block: '', rowCount: 0, usedChars: 0 };
    }
    const limit = Math.max(1500, charBudget);
    const used: string[] = [];
    let usedChars = 0;
    for (const row of rows) {
      const text = (row.sourceText || '').trim();
      if (!text) continue;
      const remain = limit - usedChars;
      if (remain <= 0) break;
      const clipped = text.length > remain ? text.slice(0, remain) + '...(截断)' : text;
      used.push(`[source_text#${row.id}] ${clipped}`);
      usedChars += clipped.length;
    }
    return { block: used.join('\n\n'), rowCount: rows.length, usedChars };
  }

  /**
   * 单表取块，供 episode-script 的 buildReferenceBlock 复用。
   * 支持 EXTENDED_TABLE_CONFIG、drama_source_text、novel_source_segments、adaptation_modes。
   */
  async getTableBlock(
    novelId: number,
    tableName: string,
    charBudget: number = DEFAULT_PER_TABLE_MAX_CHARS,
  ): Promise<{ block: string; summary: TableBlockSummary } | null> {
    const exists = await this.hasTable(tableName);
    if (!exists) return null;

    if (tableName === 'drama_source_text') {
      try {
        const r = await this.getDramaSourceTextBlock(novelId, charBudget);
        const block = `【原始素材补充（drama_source_text）】\n${r.block || '（无）'}`;
        return {
          block: block.length > charBudget ? block.slice(0, charBudget) + '\n...(截断)' : block,
          summary: {
            table: tableName,
            label: '原始素材补充',
            rowCount: r.rowCount,
            fields: ['source_text'],
            usedChars: Math.min(r.usedChars, charBudget),
          },
        };
      } catch {
        return null;
      }
    }

    if (tableName === 'novel_source_segments') {
      if (!this.sourceRetrievalService) return null;
      try {
        const evidence = await this.sourceRetrievalService.buildWorldviewEvidence(novelId, charBudget);
        const block = `【原始素材切片证据（novel_source_segments）】\n${evidence.block || '（无）'}`;
        return {
          block,
          summary: {
            table: tableName,
            label: '原始素材切片证据',
            rowCount: evidence.segmentCount,
            fields: ['segment_index', 'chapter_label', 'title_hint', 'content_text', 'keyword_text'],
            usedChars: evidence.evidenceChars,
          },
        };
      } catch {
        return null;
      }
    }

    const cfg = EXTENDED_TABLE_CONFIG[tableName];
    if (!cfg) return null;
    const params = cfg.params ?? [novelId];
    try {
      const rows = await this.dataSource.query(cfg.sql, params) as Record<string, unknown>[];
      const simplified = (rows || []).slice(0, 80).map((row) => {
        const out: Record<string, unknown> = {};
        cfg.fields.forEach((f) => {
          const v = row[f];
          out[f] = typeof v === 'string' && (v as string).length > 600 ? (v as string).slice(0, 600) + '...' : v;
        });
        return out;
      });
      const block = `【${cfg.label}（${tableName}）】\n${JSON.stringify(simplified, null, 2)}`;
      const usedChars = block.length;
      return {
        block: usedChars > charBudget ? block.slice(0, charBudget) + '\n...(截断)' : block,
        summary: {
          table: tableName,
          label: cfg.label,
          rowCount: rows?.length ?? 0,
          fields: cfg.fields,
          usedChars: Math.min(usedChars, charBudget),
        },
      };
    } catch {
      return null;
    }
  }
}
