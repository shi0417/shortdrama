import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import {
  EpisodeDurationMode,
  EpisodeGenerationMode,
  PipelineEpisodeScriptGenerateDraftDto,
  PipelineEpisodeScriptPersistDto,
  PipelineEpisodeScriptPreviewDto,
  PipelineEpisodeScriptReferenceTable,
  allowedEpisodeScriptReferenceTables,
} from './dto/pipeline-episode-script.dto';
import { SourceRetrievalService } from '../source-texts/source-retrieval.service';

type RowRecord = Record<string, any>;

type ReferenceSummaryItem = {
  table: PipelineEpisodeScriptReferenceTable;
  label: string;
  rowCount: number;
  fields: string[];
  note?: string;
  usedChars?: number;
};

type EpisodeDraft = {
  episodeNumber: number;
  episodeTitle: string;
  sortOrder: number;
  outline: {
    arc: string;
    opening: string;
    coreConflict: string;
    historyOutline: string;
    rewriteDiff: string;
    outlineContent: string;
  };
  script: {
    hooks: string;
    cliffhanger: string;
    fullContent: string;
  };
  structureTemplate: {
    chapterId: number;
    themeType: string;
    structureName: string;
    powerLevel: number;
    isPowerUpChapter: number;
    powerUpContent: string;
    identityGap: string;
    pressureSource: string;
    firstReverse: string;
    continuousUpgrade: string;
    suspenseHook: string;
    typicalOpening: string;
    suitableTheme: string;
    hotLevel: number;
    remarks: string;
  };
  hookRhythm: {
    episodeNumber: number;
    emotionLevel: number;
    hookType: string;
    description: string;
    cliffhanger: string;
  };
};

type EpisodePackage = {
  version: string;
  novelId: number;
  durationMode: EpisodeDurationMode;
  episodes: EpisodeDraft[];
};

const DEFAULT_REFERENCE_TABLES: PipelineEpisodeScriptReferenceTable[] = [
  'drama_novels',
  'novel_source_segments',
  'novel_adaptation_strategy',
  'adaptation_modes',
  'set_core',
  'novel_timelines',
  'novel_characters',
  'novel_key_nodes',
  'novel_explosions',
  'novel_skeleton_topics',
  'novel_skeleton_topic_items',
];

const DEFAULT_CHAR_BUDGET = 30000;
const EPISODE_DEFAULT_MODEL_CANDIDATES = [
  'claude-3-7-sonnet-20250219',
  'claude-3-5-sonnet-20241022',
  'claude-3-5-sonnet-20240620',
  'chatgpt-4o-latest',
];

@Injectable()
export class PipelineEpisodeScriptService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly sourceRetrievalService: SourceRetrievalService,
  ) {}

  async previewPrompt(novelId: number, dto: PipelineEpisodeScriptPreviewDto) {
    await this.assertNovelExists(novelId);
    const referenceTables = this.resolveReferenceTables(dto.referenceTables);
    const usedModelKey = await this.resolveOptionalModelKey(dto.modelKey);
    const warnings: string[] = [];
    const { promptPreview, referenceSummary } = await this.buildPrompt(
      novelId,
      referenceTables,
      dto.userInstruction,
      dto.sourceTextCharBudget,
      dto.durationMode,
      dto.generationMode,
      dto.targetEpisodeCount,
      warnings,
    );

    return {
      promptPreview,
      usedModelKey,
      referenceTables,
      referenceSummary,
      warnings: warnings.length ? warnings : undefined,
    };
  }

  async generateDraft(novelId: number, dto: PipelineEpisodeScriptGenerateDraftDto) {
    await this.assertNovelExists(novelId);
    const referenceTables = this.resolveReferenceTables(dto.referenceTables);
    const usedModelKey = await this.resolveOptionalModelKey(dto.modelKey);
    const warnings: string[] = [];
    const { promptPreview, referenceSummary } = await this.buildPrompt(
      novelId,
      referenceTables,
      dto.userInstruction,
      dto.sourceTextCharBudget,
      dto.durationMode,
      dto.generationMode,
      dto.targetEpisodeCount,
      warnings,
    );
    const finalPrompt =
      dto.allowPromptEdit && this.normalizeText(dto.promptOverride)
        ? dto.promptOverride!.trim()
        : promptPreview;

    const aiJson = await this.callLcAiApi(usedModelKey, finalPrompt);
    const normalizationWarnings: string[] = [];
    const validationWarnings: string[] = [];
    const draft = this.validateAndNormalizeEpisodePackage(
      novelId,
      aiJson,
      dto.durationMode || '60s',
      normalizationWarnings,
      validationWarnings,
      dto.generationMode,
      dto.targetEpisodeCount,
    );

    const actualEpisodeCount = draft.episodes.length;
    const countMismatchWarning =
      dto.targetEpisodeCount && actualEpisodeCount !== dto.targetEpisodeCount
        ? `【生成集数不足】目标 ${dto.targetEpisodeCount} 集，实际仅生成 ${actualEpisodeCount} 集`
        : undefined;

    return {
      usedModelKey,
      generationMode: dto.generationMode || 'outline_and_script',
      promptPreview: finalPrompt,
      referenceTables,
      referenceSummary,
      draft: { episodePackage: draft },
      targetEpisodeCount: dto.targetEpisodeCount,
      actualEpisodeCount,
      countMismatchWarning,
      warnings: warnings.length ? warnings : undefined,
      normalizationWarnings: normalizationWarnings.length ? normalizationWarnings : undefined,
      validationWarnings: validationWarnings.length ? validationWarnings : undefined,
    };
  }

  async persistDraft(novelId: number, dto: PipelineEpisodeScriptPersistDto) {
    await this.assertNovelExists(novelId);
    await this.assertBaseOutputTablesExist();
    const normalizationWarnings: string[] = [];
    const validationWarnings: string[] = [];
    const draft = this.validateAndNormalizeEpisodePackage(
      novelId,
      dto.draft,
      '60s',
      normalizationWarnings,
      validationWarnings,
      dto.generationMode,
    );
    const hookTableStatus = await this.detectHookRhythmTableIfExists();
    const warnings: string[] = [];
    if (!hookTableStatus.exists) {
      warnings.push('novel_hook_rhythm 表不存在，已跳过该表落库');
    }

    const episodeNumbers = draft.episodes
      .map((item) => item.episodeNumber)
      .sort((a, b) => a - b);

    const summary = await this.dataSource.transaction(async (manager) => {
      await this.deleteExistingEpisodeScriptData(
        novelId,
        episodeNumbers,
        hookTableStatus,
        manager,
      );
      return this.insertEpisodePackage(novelId, draft, hookTableStatus, manager, warnings);
    });

    const affectedTables = ['novel_episodes', 'drama_structure_template'];
    const skippedTables = hookTableStatus.exists ? [] : ['novel_hook_rhythm'];
    const episodeRange = this.formatEpisodeRange(episodeNumbers);

    return {
      ok: true,
      summary: {
        ...summary,
        generationMode: dto.generationMode || 'outline_and_script',
        episodeNumbers,
        affectedTables,
        skippedTables,
        overwriteScopeDescription: `将覆盖第 ${episodeRange} 集的已有数据，不影响其它集数`,
      },
      warnings: warnings.length ? warnings : undefined,
      normalizationWarnings: normalizationWarnings.length ? normalizationWarnings : undefined,
      validationWarnings: validationWarnings.length ? validationWarnings : undefined,
    };
  }

  private resolveReferenceTables(
    referenceTables: PipelineEpisodeScriptReferenceTable[] | undefined,
  ): PipelineEpisodeScriptReferenceTable[] {
    const candidate = referenceTables?.length ? referenceTables : DEFAULT_REFERENCE_TABLES;
    const valid = candidate.filter((item) =>
      (allowedEpisodeScriptReferenceTables as readonly string[]).includes(item),
    );
    return valid.length ? valid : DEFAULT_REFERENCE_TABLES;
  }

  private async buildPrompt(
    novelId: number,
    referenceTables: PipelineEpisodeScriptReferenceTable[],
    userInstruction: string | undefined,
    sourceTextCharBudget: number | undefined,
    durationMode: EpisodeDurationMode | undefined,
    generationMode: EpisodeGenerationMode | undefined,
    targetEpisodeCount: number | undefined,
    warnings: string[],
  ): Promise<{ promptPreview: string; referenceSummary: ReferenceSummaryItem[] }> {
    const referenceSummary: ReferenceSummaryItem[] = [];
    const blocks: string[] = [];
    const charBudget = Math.max(8000, Math.min(sourceTextCharBudget ?? DEFAULT_CHAR_BUDGET, 120000));
    let segmentEvidenceCount = 0;

    const prioritizedTables = [
      ...referenceTables.filter((item) => item === 'novel_source_segments'),
      ...referenceTables.filter((item) => item !== 'novel_source_segments'),
    ];

    for (const table of prioritizedTables) {
      if (table === 'drama_source_text' && segmentEvidenceCount > 0) {
        warnings.push('已命中 novel_source_segments 证据，跳过 drama_source_text 直注入');
        continue;
      }
      const built = await this.buildReferenceBlock(novelId, table, charBudget, warnings);
      if (built) {
        blocks.push(built.block);
        referenceSummary.push(built.summary);
        if (table === 'novel_source_segments') {
          segmentEvidenceCount = built.summary.rowCount;
        }
      }
    }

    const promptPreview = [
      '【任务定义】',
      '你是短剧工业化编剧助手，需要输出“每集纲要/每集剧本生产包”。请严格按 JSON 返回，不要 markdown，不要解释。',
      '',
      '【生成规则】',
      `- 生成模式：${generationMode || 'outline_and_script'}`,
      `- 时长模板：${durationMode || '60s'}`,
      `- 目标集数：第 1 集至第 ${targetEpisodeCount || '?'} 集，必须完整生成所有集数，不得跳号或缺失`,
      '- 每集必须包含剧情弧、核心冲突、历史线概要、改写差异、尾钩。',
      '- 若是 outline_only，可简化 fullContent，但结构字段仍需保留。',
      '- 保持历史逻辑与改写逻辑并行，避免空泛描述。',
      `- ⚠️ 必须生成完整的 1..N 集，episodes 数组长度必须等于 ${targetEpisodeCount || 'N'}`,
      '- ⚠️ 若无法一次性完整生成，不要擅自减少集数，仍应尽力输出完整结构，保持集数连续',
      '',
      '【短剧节奏模板】',
      '60s：0-5秒冲突；5-10秒身份揭示；10-20秒压迫；20-30秒小反击；30-45秒再压制；45-60秒爽点+尾钩。',
      '90s：0-8秒冲突；8-18秒关系揭示；18-35秒压迫升级；35-55秒策略反击；55-75秒大逆转；75-90秒阶段胜利+尾钩。',
      '',
      '【输出 JSON 契约】',
      '以下是单集示例。实际输出时应重复此结构，完整生成 1..N 集。',
      this.getJsonContractTemplate(),
      '',
      '【参考资料】',
      blocks.join('\n\n'),
      '',
      '【用户附加要求】',
      this.normalizeText(userInstruction) || '（无）',
    ].join('\n');

    return { promptPreview, referenceSummary };
  }

  private async buildReferenceBlock(
    novelId: number,
    table: PipelineEpisodeScriptReferenceTable,
    sourceTextCharBudget: number,
    warnings: string[],
  ): Promise<{ block: string; summary: ReferenceSummaryItem } | null> {
    switch (table) {
      case 'drama_novels': {
        const rows = await this.dataSource.query(
          `SELECT id, novels_name, total_chapters, power_up_interval, author, description, status
           FROM drama_novels WHERE id = ? LIMIT 1`,
          [novelId],
        );
        return this.serializeRows(table, '项目主信息', rows, [
          'id',
          'novels_name',
          'total_chapters',
          'power_up_interval',
          'author',
          'description',
          'status',
        ]);
      }
      case 'drama_source_text': {
        const built = await this.getRawSourceTextBlock(novelId, Math.floor(sourceTextCharBudget * 0.35));
        return {
          block: `【原始素材补充（drama_source_text）】\n${built.block || '（无）'}`,
          summary: {
            table,
            label: '原始素材补充',
            rowCount: built.rowCount,
            fields: ['source_text'],
            note: '仅补充节选，不全量注入',
            usedChars: built.usedChars,
          },
        };
      }
      case 'novel_source_segments': {
        const evidence = await this.sourceRetrievalService.buildWorldviewEvidence(
          novelId,
          sourceTextCharBudget,
        );
        warnings.push(...evidence.warnings);
        return {
          block: `【原始素材切片证据（novel_source_segments）】\n${evidence.block || '（无）'}`,
          summary: {
            table,
            label: '原始素材切片证据',
            rowCount: evidence.segmentCount,
            fields: ['segment_index', 'chapter_label', 'title_hint', 'content_text', 'keyword_text'],
            usedChars: evidence.evidenceChars,
            note: evidence.usedFallback ? 'segments 不足，包含 raw fallback' : undefined,
          },
        };
      }
      case 'novel_adaptation_strategy': {
        const rows = await this.dataSource.query(
          `SELECT strategy_title, strategy_description, ai_prompt_template, version
           FROM novel_adaptation_strategy WHERE novel_id = ? ORDER BY version DESC, id DESC LIMIT 5`,
          [novelId],
        );
        return this.serializeRows(table, '改编策略', rows, [
          'strategy_title',
          'strategy_description',
          'ai_prompt_template',
          'version',
        ]);
      }
      case 'adaptation_modes': {
        const rows = await this.dataSource.query(
          `SELECT mode_key, mode_name, description FROM adaptation_modes ORDER BY id ASC`,
          [],
        );
        return this.serializeRows(table, '改编模式', rows, ['mode_key', 'mode_name', 'description']);
      }
      case 'set_core':
        return this.serializeRows(
          table,
          '核心设定',
          await this.dataSource.query(
            `SELECT title, core_text, protagonist_name, protagonist_identity, target_story, rewrite_goal, constraint_text
             FROM set_core WHERE novel_id = ? AND is_active = 1 ORDER BY version DESC, id DESC LIMIT 1`,
            [novelId],
          ),
          [
            'title',
            'core_text',
            'protagonist_name',
            'protagonist_identity',
            'target_story',
            'rewrite_goal',
            'constraint_text',
          ],
        );
      case 'novel_timelines':
        return this.serializeRows(
          table,
          '时间线',
          await this.dataSource.query(
            `SELECT time_node, event, sort_order FROM novel_timelines WHERE novel_id = ? ORDER BY sort_order ASC, id ASC`,
            [novelId],
          ),
          ['time_node', 'event', 'sort_order'],
        );
      case 'novel_characters':
        return this.serializeRows(
          table,
          '人物',
          await this.dataSource.query(
            `SELECT name, faction, description, personality FROM novel_characters WHERE novel_id = ? ORDER BY sort_order ASC, id ASC`,
            [novelId],
          ),
          ['name', 'faction', 'description', 'personality'],
        );
      case 'novel_key_nodes':
        return this.serializeRows(
          table,
          '关键节点',
          await this.dataSource.query(
            `SELECT category, title, description, timeline_id, sort_order FROM novel_key_nodes WHERE novel_id = ? ORDER BY sort_order ASC, id ASC`,
            [novelId],
          ),
          ['category', 'title', 'description', 'timeline_id', 'sort_order'],
        );
      case 'novel_explosions':
        return this.serializeRows(
          table,
          '爆点',
          await this.dataSource.query(
            `SELECT explosion_type, title, subtitle, scene_restoration, dramatic_quality, adaptability, sort_order
             FROM novel_explosions WHERE novel_id = ? ORDER BY sort_order ASC, id ASC`,
            [novelId],
          ),
          [
            'explosion_type',
            'title',
            'subtitle',
            'scene_restoration',
            'dramatic_quality',
            'adaptability',
            'sort_order',
          ],
        );
      case 'novel_skeleton_topics':
        return this.serializeRows(
          table,
          '骨架主题',
          await this.dataSource.query(
            `SELECT topic_key, topic_name, topic_type, description, sort_order
             FROM novel_skeleton_topics WHERE novel_id = ? AND is_enabled = 1 ORDER BY sort_order ASC, id ASC`,
            [novelId],
          ),
          ['topic_key', 'topic_name', 'topic_type', 'description', 'sort_order'],
        );
      case 'novel_skeleton_topic_items':
        return this.serializeRows(
          table,
          '骨架主题详情',
          await this.dataSource.query(
            `SELECT topic_id, item_title, content, content_json, sort_order
             FROM novel_skeleton_topic_items WHERE novel_id = ? ORDER BY sort_order ASC, id ASC`,
            [novelId],
          ),
          ['topic_id', 'item_title', 'content', 'content_json', 'sort_order'],
        );
      case 'set_payoff_arch':
        return this.serializeRows(
          table,
          '爽点架构',
          await this.dataSource.query(
            `SELECT name, notes FROM set_payoff_arch WHERE novel_id = ? ORDER BY version DESC, id DESC LIMIT 1`,
            [novelId],
          ),
          ['name', 'notes'],
        );
      case 'set_payoff_lines':
        return this.serializeRows(
          table,
          '爽点线',
          await this.dataSource.query(
            `SELECT line_key, line_name, line_content, start_ep, end_ep, stage_text, sort_order
             FROM set_payoff_lines WHERE novel_id = ? ORDER BY sort_order ASC, id ASC`,
            [novelId],
          ),
          ['line_key', 'line_name', 'line_content', 'start_ep', 'end_ep', 'stage_text', 'sort_order'],
        );
      case 'set_opponent_matrix':
        return this.serializeRows(
          table,
          '对手矩阵',
          await this.dataSource.query(
            `SELECT name, description FROM set_opponent_matrix WHERE novel_id = ? ORDER BY version DESC, id DESC LIMIT 1`,
            [novelId],
          ),
          ['name', 'description'],
        );
      case 'set_opponents':
        return this.serializeRows(
          table,
          '对手明细',
          await this.dataSource.query(
            `SELECT level_name, opponent_name, threat_type, detailed_desc, sort_order
             FROM set_opponents WHERE novel_id = ? ORDER BY sort_order ASC, id ASC`,
            [novelId],
          ),
          ['level_name', 'opponent_name', 'threat_type', 'detailed_desc', 'sort_order'],
        );
      case 'set_power_ladder':
        return this.serializeRows(
          table,
          '权力升级阶梯',
          await this.dataSource.query(
            `SELECT level_no, level_title, identity_desc, ability_boundary, start_ep, end_ep
             FROM set_power_ladder WHERE novel_id = ? ORDER BY sort_order ASC, id ASC`,
            [novelId],
          ),
          ['level_no', 'level_title', 'identity_desc', 'ability_boundary', 'start_ep', 'end_ep'],
        );
      case 'set_traitor_system':
        return this.serializeRows(
          table,
          '内鬼系统',
          await this.dataSource.query(
            `SELECT name, description FROM set_traitor_system WHERE novel_id = ? ORDER BY version DESC, id DESC LIMIT 1`,
            [novelId],
          ),
          ['name', 'description'],
        );
      case 'set_traitors':
        return this.serializeRows(
          table,
          '内鬼角色',
          await this.dataSource.query(
            `SELECT name, public_identity, real_identity, mission, threat_desc, sort_order
             FROM set_traitors WHERE novel_id = ? ORDER BY sort_order ASC, id ASC`,
            [novelId],
          ),
          ['name', 'public_identity', 'real_identity', 'mission', 'threat_desc', 'sort_order'],
        );
      case 'set_traitor_stages':
        return this.serializeRows(
          table,
          '内鬼阶段',
          await this.dataSource.query(
            `SELECT stage_title, stage_desc, start_ep, end_ep, sort_order
             FROM set_traitor_stages WHERE novel_id = ? ORDER BY sort_order ASC, id ASC`,
            [novelId],
          ),
          ['stage_title', 'stage_desc', 'start_ep', 'end_ep', 'sort_order'],
        );
      case 'set_story_phases':
        return this.serializeRows(
          table,
          '故事阶段',
          await this.dataSource.query(
            `SELECT phase_name, start_ep, end_ep, historical_path, rewrite_path, sort_order
             FROM set_story_phases WHERE novel_id = ? ORDER BY sort_order ASC, id ASC`,
            [novelId],
          ),
          ['phase_name', 'start_ep', 'end_ep', 'historical_path', 'rewrite_path', 'sort_order'],
        );
      default:
        return null;
    }
  }

  private serializeRows(
    table: PipelineEpisodeScriptReferenceTable,
    label: string,
    rows: RowRecord[],
    fields: string[],
  ): { block: string; summary: ReferenceSummaryItem } {
    const simplified = (rows || []).slice(0, 80).map((row) => {
      const output: RowRecord = {};
      fields.forEach((field) => {
        const value = row[field];
        if (typeof value === 'string') {
          output[field] = this.trimBlock(value, 600);
        } else {
          output[field] = value;
        }
      });
      return output;
    });
    return {
      block: `【${label}（${table}）】\n${JSON.stringify(simplified, null, 2)}`,
      summary: {
        table,
        label,
        rowCount: rows.length,
        fields,
      },
    };
  }

  private formatEpisodeRange(episodeNumbers: number[]): string {
    if (!episodeNumbers.length) return '-';
    const sorted = [...episodeNumbers].sort((a, b) => a - b);
    if (sorted.length === 1) return `${sorted[0]}`;
    const isContiguous = sorted.every((n, i) => i === 0 || n === sorted[i - 1] + 1);
    return isContiguous ? `${sorted[0]}-${sorted[sorted.length - 1]}` : sorted.join(', ');
  }

  private validateAndNormalizeEpisodePackage(
    novelId: number,
    raw: unknown,
    fallbackDurationMode: EpisodeDurationMode,
    normalizationWarnings: string[],
    validationWarnings: string[],
    generationMode?: EpisodeGenerationMode,
    targetEpisodeCount?: number,
  ): EpisodePackage {
    const payload = this.parseToRecord(raw);
    const root = payload && this.asRecord(payload.episodePackage)
      ? (payload.episodePackage as RowRecord)
      : null;
    if (!root) {
      throw new BadRequestException('AI 返回结构缺少 episodePackage 根节点');
    }

    const episodesRaw = Array.isArray(root.episodes) ? root.episodes : [];
    if (!episodesRaw.length) {
      throw new BadRequestException('AI 返回的 episodePackage.episodes 为空');
    }

    const usedEpisodeNumbers = new Set<number>();
    const episodes: EpisodeDraft[] = episodesRaw.map((item: unknown, index: number) => {
      const row = this.asRecord(item) || {};
      const episodeNumber = this.toPositiveInt(row.episodeNumber) ?? index + 1;
      if (usedEpisodeNumbers.has(episodeNumber)) {
        throw new BadRequestException(`episodeNumber 重复: ${episodeNumber}`);
      }
      usedEpisodeNumbers.add(episodeNumber);
      if (!this.toPositiveInt(row.episodeNumber)) {
        normalizationWarnings.push(`episodes[${index}].episodeNumber 缺失，已自动补为 ${episodeNumber}`);
      }
      const outline = this.asRecord(row.outline) || {};
      const script = this.asRecord(row.script) || {};
      const structureTemplate = this.asRecord(row.structureTemplate) || {};
      const hookRhythm = this.asRecord(row.hookRhythm) || {};

      const normalized: EpisodeDraft = {
        episodeNumber,
        episodeTitle: this.normalizeText(row.episodeTitle) || `第${episodeNumber}集`,
        sortOrder: this.toPositiveInt(row.sortOrder) ?? episodeNumber,
        outline: {
          arc: this.normalizeText(outline.arc),
          opening: this.normalizeText(outline.opening),
          coreConflict: this.normalizeText(outline.coreConflict),
          historyOutline: this.normalizeText(outline.historyOutline),
          rewriteDiff: this.normalizeText(outline.rewriteDiff),
          outlineContent: this.normalizeText(outline.outlineContent),
        },
        script: {
          hooks: this.normalizeText(script.hooks),
          cliffhanger: this.normalizeText(script.cliffhanger),
          fullContent: this.normalizeText(script.fullContent),
        },
        structureTemplate: {
          chapterId: this.toPositiveInt(structureTemplate.chapterId) ?? episodeNumber,
          themeType: this.normalizeText(structureTemplate.themeType),
          structureName: this.normalizeText(structureTemplate.structureName),
          powerLevel: this.toPositiveInt(structureTemplate.powerLevel) ?? 1,
          isPowerUpChapter: this.toBooleanInt(structureTemplate.isPowerUpChapter),
          powerUpContent: this.normalizeText(structureTemplate.powerUpContent),
          identityGap: this.normalizeText(structureTemplate.identityGap),
          pressureSource: this.normalizeText(structureTemplate.pressureSource),
          firstReverse: this.normalizeText(structureTemplate.firstReverse),
          continuousUpgrade: this.normalizeText(structureTemplate.continuousUpgrade),
          suspenseHook: this.normalizeText(structureTemplate.suspenseHook),
          typicalOpening: this.normalizeText(structureTemplate.typicalOpening),
          suitableTheme: this.normalizeText(structureTemplate.suitableTheme),
          hotLevel: this.toPositiveInt(structureTemplate.hotLevel) ?? 3,
          remarks: this.normalizeText(structureTemplate.remarks),
        },
        hookRhythm: {
          episodeNumber,
          emotionLevel: this.toPositiveInt(hookRhythm.emotionLevel) ?? 3,
          hookType: this.normalizeText(hookRhythm.hookType),
          description: this.normalizeText(hookRhythm.description),
          cliffhanger: this.normalizeText(hookRhythm.cliffhanger),
        },
      };

      if (!normalized.structureTemplate.themeType) {
        validationWarnings.push(`episodes[${index}].structureTemplate.themeType 为空`);
      }
      if (!normalized.structureTemplate.structureName) {
        validationWarnings.push(`episodes[${index}].structureTemplate.structureName 为空`);
      }
      if (!normalized.outline.coreConflict) {
        validationWarnings.push(`episodes[${index}].outline.coreConflict 为空`);
      }
      // outline_only 模式下允许 script 字段为空，其余模式标记警告
      if (generationMode !== 'outline_only') {
        if (!normalized.script.fullContent) {
          validationWarnings.push(`[剧本内容不完整] episodes[${index}].script.fullContent 为空`);
        }
        if (!normalized.script.cliffhanger) {
          validationWarnings.push(`[剧本内容不完整] episodes[${index}].script.cliffhanger 为空`);
        }
      }

      return normalized;
    });

    // 集数完整性校验
    if (targetEpisodeCount && targetEpisodeCount > 0) {
      const actualCount = episodes.length;
      if (actualCount !== targetEpisodeCount) {
        validationWarnings.push(`【生成集数不足】目标 ${targetEpisodeCount} 集，实际仅生成 ${actualCount} 集`);
      }
      // 检查是否有缺失集数
      const episodeSet = new Set(episodes.map((e) => e.episodeNumber));
      const missing: number[] = [];
      for (let i = 1; i <= targetEpisodeCount; i++) {
        if (!episodeSet.has(i)) {
          missing.push(i);
        }
      }
      if (missing.length > 0) {
        const missingStr = missing.length > 10 
          ? `${missing.slice(0, 5).join(', ')}...共 ${missing.length} 集`
          : missing.join(', ');
        validationWarnings.push(`【集数缺失】缺少第 ${missingStr} 集`);
      }
    }

    return {
      version: this.normalizeText(root.version) || 'v1',
      novelId,
      durationMode: this.normalizeDurationMode(root.durationMode) || fallbackDurationMode,
      episodes,
    };
  }

  private async deleteExistingEpisodeScriptData(
    novelId: number,
    episodeNumbers: number[],
    hookTableStatus: { exists: boolean; columns: Set<string> },
    manager: DataSource['manager'],
  ): Promise<void> {
    if (!episodeNumbers.length) return;
    const normalizedEpisodeNumbers = Array.from(
      new Set(episodeNumbers.filter((item) => Number.isInteger(item) && item > 0)),
    );
    if (!normalizedEpisodeNumbers.length) return;
    const placeholders = normalizedEpisodeNumbers.map(() => '?').join(', ');
    await manager.query(
      `DELETE FROM novel_episodes WHERE novel_id = ? AND episode_number IN (${placeholders})`,
      [novelId, ...normalizedEpisodeNumbers],
    );
    await manager.query(
      `DELETE FROM drama_structure_template WHERE novels_id = ? AND chapter_id IN (${placeholders})`,
      [novelId, ...normalizedEpisodeNumbers],
    );

    const hasHookRequiredColumns =
      hookTableStatus.exists &&
      hookTableStatus.columns.has('novel_id') &&
      hookTableStatus.columns.has('episode_number');
    if (hasHookRequiredColumns) {
      await manager.query(
        `DELETE FROM novel_hook_rhythm WHERE novel_id = ? AND episode_number IN (${placeholders})`,
        [novelId, ...normalizedEpisodeNumbers],
      );
    }
  }

  private async insertEpisodePackage(
    novelId: number,
    pkg: EpisodePackage,
    hookTableStatus: { exists: boolean; columns: Set<string> },
    manager: DataSource['manager'],
    warnings: string[],
  ): Promise<{
    episodes: number;
    structureTemplates: number;
    hookRhythm: number;
  }> {
    let structureTemplates = 0;
    let episodes = 0;
    let hookRhythm = 0;
    const templateIdByEpisode = new Map<number, number>();

    for (const item of pkg.episodes) {
      const result: any = await manager.query(
        `INSERT INTO drama_structure_template (
          novels_id, chapter_id, power_level, is_power_up_chapter, power_up_content,
          theme_type, structure_name, identity_gap, pressure_source, first_reverse,
          continuous_upgrade, suspense_hook, typical_opening, suitable_theme, hot_level, remarks
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          novelId,
          item.structureTemplate.chapterId,
          item.structureTemplate.powerLevel,
          item.structureTemplate.isPowerUpChapter,
          item.structureTemplate.powerUpContent || null,
          item.structureTemplate.themeType || '未分类',
          item.structureTemplate.structureName || `结构模板-${item.episodeNumber}`,
          item.structureTemplate.identityGap || null,
          item.structureTemplate.pressureSource || null,
          item.structureTemplate.firstReverse || null,
          item.structureTemplate.continuousUpgrade || null,
          item.structureTemplate.suspenseHook || null,
          item.structureTemplate.typicalOpening || null,
          item.structureTemplate.suitableTheme || null,
          item.structureTemplate.hotLevel,
          item.structureTemplate.remarks || null,
        ],
      );
      const templateId = Number(result.insertId);
      templateIdByEpisode.set(item.episodeNumber, templateId);
      structureTemplates += 1;
    }

    for (const item of pkg.episodes) {
      await manager.query(
        `INSERT INTO novel_episodes (
          novel_id, episode_number, episode_title, arc, opening, core_conflict, hooks, cliffhanger,
          full_content, outline_content, history_outline, rewrite_diff, structure_template_id, sort_order
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          novelId,
          item.episodeNumber,
          item.episodeTitle || `第${item.episodeNumber}集`,
          item.outline.arc || null,
          item.outline.opening || null,
          item.outline.coreConflict || null,
          item.script.hooks || null,
          item.script.cliffhanger || null,
          item.script.fullContent || null,
          item.outline.outlineContent || null,
          item.outline.historyOutline || null,
          item.outline.rewriteDiff || null,
          templateIdByEpisode.get(item.episodeNumber) ?? null,
          item.sortOrder,
        ],
      );
      episodes += 1;
    }

    if (!hookTableStatus.exists) {
      return { episodes, structureTemplates, hookRhythm };
    }

    const required = ['novel_id', 'episode_number'];
    const hasRequired = required.every((key) => hookTableStatus.columns.has(key));
    if (!hasRequired) {
      warnings.push('novel_hook_rhythm 字段不兼容，已跳过落库');
      return { episodes, structureTemplates, hookRhythm };
    }

    const optionalMappings: Array<[string, (item: EpisodeDraft) => any]> = [
      ['emotion_level', (item) => item.hookRhythm.emotionLevel],
      ['hook_type', (item) => item.hookRhythm.hookType || null],
      ['description', (item) => item.hookRhythm.description || null],
      ['cliffhanger', (item) => item.hookRhythm.cliffhanger || null],
      ['sort_order', (item) => item.sortOrder],
    ];

    for (const item of pkg.episodes) {
      const columns = ['novel_id', 'episode_number'];
      const values: any[] = [novelId, item.episodeNumber];
      optionalMappings.forEach(([column, getter]) => {
        if (hookTableStatus.columns.has(column)) {
          columns.push(column);
          values.push(getter(item));
        }
      });
      const placeholders = columns.map(() => '?').join(', ');
      await manager.query(
        `INSERT INTO novel_hook_rhythm (${columns.join(', ')}) VALUES (${placeholders})`,
        values,
      );
      hookRhythm += 1;
    }

    return { episodes, structureTemplates, hookRhythm };
  }

  private async detectHookRhythmTableIfExists(): Promise<{ exists: boolean; columns: Set<string> }> {
    const tableRows = await this.dataSource.query(
      `SELECT COUNT(*) AS cnt
       FROM information_schema.tables
       WHERE table_schema = DATABASE() AND table_name = 'novel_hook_rhythm'`,
      [],
    );
    const exists = Number(tableRows[0]?.cnt || 0) > 0;
    if (!exists) {
      return { exists: false, columns: new Set() };
    }
    const columnRows = await this.dataSource.query(
      `SELECT column_name AS columnName
       FROM information_schema.columns
       WHERE table_schema = DATABASE() AND table_name = 'novel_hook_rhythm'`,
      [],
    );
    return {
      exists: true,
      columns: new Set(columnRows.map((item: RowRecord) => this.normalizeText(item.columnName).toLowerCase())),
    };
  }

  private async assertNovelExists(novelId: number): Promise<void> {
    const rows = await this.dataSource.query(`SELECT id FROM drama_novels WHERE id = ? LIMIT 1`, [novelId]);
    if (!rows.length) {
      throw new NotFoundException(`Novel ${novelId} not found`);
    }
  }

  private async assertBaseOutputTablesExist(): Promise<void> {
    const tables = ['novel_episodes', 'drama_structure_template'];
    for (const table of tables) {
      const rows = await this.dataSource.query(
        `SELECT COUNT(*) AS cnt
         FROM information_schema.tables
         WHERE table_schema = DATABASE() AND table_name = ?`,
        [table],
      );
      if (Number(rows[0]?.cnt || 0) <= 0) {
        throw new BadRequestException(`Required output table missing: ${table}`);
      }
    }
  }

  private async resolveOptionalModelKey(modelKey?: string): Promise<string> {
    try {
      const rows: Array<{ modelKey: string; provider: string; family: string; modality: string }> =
        await this.dataSource.query(
          `SELECT model_key AS modelKey, provider, family, modality
           FROM lc_api_models
           WHERE is_deleted = 0`,
          [],
        );
      if (!rows.length) {
        throw new BadRequestException('No AI model available');
      }
      const safe = rows.filter((item) => this.isSafeTextModel(item));
      if (!safe.length) {
        throw new BadRequestException('No safe text model available');
      }
      if (modelKey) {
        const matched = safe.find((item) => item.modelKey === modelKey);
        if (!matched) {
          throw new BadRequestException(`Model ${modelKey} is unavailable for episode-script`);
        }
        return matched.modelKey;
      }
      for (const candidate of EPISODE_DEFAULT_MODEL_CANDIDATES) {
        const hit = safe.find((item) => item.modelKey === candidate);
        if (hit) return hit.modelKey;
      }
      return safe[0].modelKey;
    } catch (error: any) {
      const message = this.normalizeText(error?.message).toLowerCase();
      const isMissingModelTable =
        message.includes('lc_api_models') && message.includes("doesn't exist");
      if (!isMissingModelTable) {
        throw error;
      }
      const fallbackFromRequest = this.normalizeText(modelKey);
      if (fallbackFromRequest) {
        return fallbackFromRequest;
      }
      return EPISODE_DEFAULT_MODEL_CANDIDATES[0];
    }
  }

  private isSafeTextModel(row: {
    modelKey: string;
    provider?: string;
    family?: string;
    modality?: string;
  }): boolean {
    const key = this.normalizeText(row.modelKey).toLowerCase();
    const provider = this.normalizeText(row.provider).toLowerCase();
    const family = this.normalizeText(row.family).toLowerCase();
    const modality = this.normalizeText(row.modality).toLowerCase();
    if (key.includes('imagine') || key.includes('midjourney')) return false;
    if (provider.includes('midjourney')) return false;
    if (modality && modality !== 'text') return false;
    return (
      key.includes('claude') ||
      key.includes('gpt') ||
      key.includes('deepseek') ||
      family.includes('claude') ||
      family.includes('gpt') ||
      family.includes('deepseek')
    );
  }

  private async getRawSourceTextBlock(
    novelId: number,
    charBudget: number,
  ): Promise<{ block: string; rowCount: number; usedChars: number }> {
    const rows = await this.dataSource.query(
      `SELECT id, source_text AS sourceText
       FROM drama_source_text
       WHERE novels_id = ?
       ORDER BY id ASC`,
      [novelId],
    );
    if (!rows.length) {
      return { block: '', rowCount: 0, usedChars: 0 };
    }
    const used: string[] = [];
    let usedChars = 0;
    const limit = Math.max(1500, charBudget);
    for (const row of rows) {
      const text = this.normalizeText(row.sourceText);
      if (!text) continue;
      const remain = limit - usedChars;
      if (remain <= 0) break;
      const clipped = text.slice(0, remain);
      used.push(`[source_text#${row.id}] ${clipped}`);
      usedChars += clipped.length;
    }
    return { block: used.join('\n\n'), rowCount: rows.length, usedChars };
  }

  private async callLcAiApi(modelKey: string, promptPreview: string): Promise<Record<string, unknown>> {
    const endpoint = this.getLcApiEndpoint();
    const apiKey = this.getLcApiKey();
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: modelKey,
        temperature: 0.45,
        messages: [
          {
            role: 'system',
            content:
              '你是短剧每集纲要/剧本结构化生成助手。你必须只输出严格 JSON，不要输出 markdown 和解释。',
          },
          { role: 'user', content: promptPreview },
        ],
      }),
    });
    const contentType = response.headers.get('content-type') || '';
    const rawText = await response.text();
    if (this.isHtmlResponse(contentType, rawText)) {
      throw new BadRequestException(
        `Episode script request reached HTML page. endpoint=${endpoint}, status=${response.status}, body=${this.summarizeBody(rawText)}`,
      );
    }
    if (!response.ok) {
      throw new BadRequestException(
        `Episode script request failed. endpoint=${endpoint}, status=${response.status}, body=${this.summarizeBody(rawText)}`,
      );
    }
    let payload: any;
    try {
      payload = JSON.parse(rawText);
    } catch {
      throw new BadRequestException('Episode script AI response is not valid JSON');
    }
    const text = this.extractAiText(payload);
    if (!text) {
      throw new BadRequestException('Episode script AI response does not contain text content');
    }
    return this.parseJsonObjectFromText(text);
  }

  private getJsonContractTemplate(): string {
    return JSON.stringify(
      {
        episodePackage: {
          version: 'v1',
          novelId: 1,
          durationMode: '60s',
          episodes: [
            {
              episodeNumber: 1,
              episodeTitle: '第1集标题',
              sortOrder: 1,
              outline: {
                arc: '本集剧情弧',
                opening: '开场',
                coreConflict: '核心冲突',
                historyOutline: '历史线概要',
                rewriteDiff: '改写差异',
                outlineContent: '本集纲要',
              },
              script: {
                hooks: '本集前置钩子',
                cliffhanger: '本集尾钩',
                fullContent: '完整剧本',
              },
              structureTemplate: {
                chapterId: 1,
                themeType: '权谋',
                structureName: '压迫-反击-爆发',
                powerLevel: 1,
                isPowerUpChapter: 0,
                powerUpContent: '',
                identityGap: '主角身份弱势点',
                pressureSource: '本集压迫源',
                firstReverse: '第一次反转内容',
                continuousUpgrade: '连续升级路径',
                suspenseHook: '悬念钩子',
                typicalOpening: '典型开场',
                suitableTheme: '权谋/历史改写',
                hotLevel: 4,
                remarks:
                  '前10秒冲突：xx；第一次权力反转：xx秒；每60秒悬念：是；爽点频率：2次/分钟；情绪曲线：压迫→反击→爆发',
              },
              hookRhythm: {
                episodeNumber: 1,
                emotionLevel: 4,
                hookType: '反转',
                description: '本集最强钩子一句话',
                cliffhanger: '尾钩内容',
              },
            },
          ],
        },
      },
      null,
      2,
    );
  }

  private extractAiText(payload: any): string {
    if (typeof payload === 'string') return payload;
    const content = payload?.choices?.[0]?.message?.content;
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) {
      return content
        .map((item) => {
          if (typeof item === 'string') return item;
          if (typeof item?.text === 'string') return item.text;
          if (typeof item?.content === 'string') return item.content;
          return '';
        })
        .join('\n');
    }
    if (typeof payload?.output_text === 'string') return payload.output_text;
    if (typeof payload?.response === 'string') return payload.response;
    return '';
  }

  private parseJsonObjectFromText(text: string): Record<string, unknown> {
    const trimmed = this.stripMarkdownCodeFence(text.trim());
    try {
      return JSON.parse(trimmed);
    } catch {
      const start = trimmed.indexOf('{');
      const end = trimmed.lastIndexOf('}');
      if (start >= 0 && end > start) {
        return this.parsePossiblyDirtyJson(trimmed.slice(start, end + 1));
      }
    }
    return this.parsePossiblyDirtyJson(trimmed);
  }

  private parsePossiblyDirtyJson(text: string): Record<string, unknown> {
    const candidates = [text, this.normalizeJsonLikeText(text)];
    for (const candidate of candidates) {
      try {
        return JSON.parse(candidate);
      } catch {
        // try next
      }
    }
    throw new BadRequestException(`Episode script JSON parse failed: ${text.slice(0, 400)}`);
  }

  private parseToRecord(raw: unknown): RowRecord | null {
    if (!raw) return null;
    if (typeof raw === 'string') {
      return this.parseJsonObjectFromText(raw);
    }
    if (typeof raw === 'object' && !Array.isArray(raw)) {
      return raw as RowRecord;
    }
    return null;
  }

  private asRecord(value: unknown): RowRecord | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    return value as RowRecord;
  }

  private normalizeText(value: unknown): string {
    if (value === null || value === undefined) return '';
    if (typeof value === 'string') return value.trim();
    if (typeof value === 'number' || typeof value === 'boolean') return String(value).trim();
    return '';
  }

  private toPositiveInt(value: unknown): number | null {
    if (value === null || value === undefined || value === '') return null;
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return null;
    const intVal = Math.trunc(parsed);
    return intVal > 0 ? intVal : null;
  }

  private toBooleanInt(value: unknown): number {
    if (value === true || value === 1 || value === '1' || value === 'true') return 1;
    return 0;
  }

  private normalizeDurationMode(value: unknown): EpisodeDurationMode | null {
    const text = this.normalizeText(value);
    return text === '90s' ? '90s' : text === '60s' ? '60s' : null;
  }

  private trimBlock(value: unknown, maxLength: number): string {
    const text = this.normalizeText(value);
    if (!text) return '';
    if (text.length <= maxLength) return text;
    return `${text.slice(0, maxLength)}...(截断)`;
  }

  private getLcApiEndpoint(): string {
    const raw = process.env.lc_api_url?.trim();
    if (!raw) {
      throw new InternalServerErrorException('lc_api_url is not configured');
    }
    const normalized = raw.replace(/\/+$/, '');
    if (
      normalized.endsWith('/v1/chat/completions') ||
      normalized.endsWith('/chat/completions')
    ) {
      return normalized;
    }
    return `${normalized}/v1/chat/completions`;
  }

  private getLcApiKey(): string {
    const key = process.env.lc_api_key?.trim();
    if (!key) {
      throw new InternalServerErrorException('lc_api_key is not configured');
    }
    return key;
  }

  private isHtmlResponse(contentType: string, body: string): boolean {
    return contentType.includes('text/html') || /^\s*<!doctype html/i.test(body);
  }

  private summarizeBody(body: string): string {
    return body.replace(/\s+/g, ' ').slice(0, 500);
  }

  private stripMarkdownCodeFence(text: string): string {
    return text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  }

  private normalizeJsonLikeText(text: string): string {
    return text
      .replace(/[\u2018\u2019]/g, "'")
      .replace(/[\u201C\u201D]/g, '"')
      .replace(/^\uFEFF/, '')
      .trim();
  }
}

