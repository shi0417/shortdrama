import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { DataSource, EntityManager } from 'typeorm';
import {
  PipelineSecondReviewDto,
  PipelineSecondReviewReferenceTable,
  PipelineSecondReviewTargetTable,
} from './dto/pipeline-second-review.dto';

type RowRecord = Record<string, any>;

type TimelineInput = {
  timeNode: string;
  event: string;
};

type CharacterInput = {
  name: string;
  faction: string;
  description: string;
  personality: string;
  settingWords: string;
};

type KeyNodeInput = {
  category: string;
  title: string;
  description: string;
  timelineRef: string;
};

type SkeletonTopicItemInput = {
  itemTitle: string;
  content: string;
  contentJson: Record<string, unknown> | unknown[] | null;
  sourceRef: string;
};

type SkeletonTopicItemGroupInput = {
  topicKey: string;
  items: SkeletonTopicItemInput[];
};

type ExplosionInput = {
  explosionType: string;
  title: string;
  subtitle: string;
  sceneRestoration: string;
  dramaticQuality: string;
  adaptability: string;
  timelineRef: string;
};

type ReviewNoteInput = {
  table: PipelineSecondReviewTargetTable;
  issue: string;
  fix: string;
};

type PipelineReviewAiResult = {
  timelines: TimelineInput[];
  characters: CharacterInput[];
  keyNodes: KeyNodeInput[];
  skeletonTopicItems: SkeletonTopicItemGroupInput[];
  explosions: ExplosionInput[];
  reviewNotes: ReviewNoteInput[];
};

type TimelineLookupRow = {
  id: number;
  timeNode: string;
  event: string;
};

type RevisionNoteEntry = {
  reviewedAt: string;
  reviewModel: string;
  reviewBatchId: string;
  targetTable: string;
  source: 'ai' | 'fallback';
  action: string;
  reason: string;
  beforeSummary: string;
  afterSummary: string;
};

type ReviewNotesDiagnostics = {
  rawCount: number;
  normalizedCount: number;
  droppedCount: number;
  reviewNotesByTable: Record<string, number>;
};

type TableWriteDetails = {
  usedAiNotes: number;
  usedFallback: boolean;
  mergedWithHistory: number;
  insertedRows: number;
};

type ExistingRevisionNotesIndex = Record<
  PipelineSecondReviewTargetTable,
  Map<string, RevisionNoteEntry[]>
>;

type SkeletonTopicMeta = {
  id: number;
  topicKey: string;
  topicName: string;
  topicType: string;
  description: string;
};

type ReviewQualityDiagnostics = {
  charactersAliasNormalizedCount: number;
  skeletonTopicWeakItemCount: number;
  explosionWeakCount: number;
};

export type PipelineSecondReviewPromptPreviewResponse = {
  promptPreview: string;
  usedModelKey: string;
  targetTables: PipelineSecondReviewTargetTable[];
  referenceTables: PipelineSecondReviewReferenceTable[];
};

export type PipelineSecondReviewResponse = {
  ok: true;
  summary: {
    timelines: number;
    characters: number;
    keyNodes: number;
    skeletonTopicItems: number;
    explosions: number;
  };
  reviewNotes: ReviewNoteInput[];
  warnings?: string[];
  details?: {
    reviewNotes: ReviewNotesDiagnostics;
    tables: Record<PipelineSecondReviewTargetTable, TableWriteDetails>;
  };
};

const DEFAULT_REFERENCE_TABLES: PipelineSecondReviewReferenceTable[] = [
  'drama_novels',
  'drama_source_text',
  'novel_adaptation_strategy',
  'adaptation_modes',
  'set_core',
];

@Injectable()
export class PipelineReviewService {
  constructor(private readonly dataSource: DataSource) {}

  async previewPrompt(
    novelId: number,
    dto: PipelineSecondReviewDto,
  ): Promise<PipelineSecondReviewPromptPreviewResponse> {
    await this.assertNovelExists(novelId);
    const targetTables = this.resolveTargetTables(dto.targetTables);
    const referenceTables = this.resolveReferenceTables(dto.referenceTables);
    const usedModelKey = await this.resolveOptionalModelKey(dto.modelKey);
    const promptPreview = await this.buildReviewPrompt(
      novelId,
      targetTables,
      referenceTables,
      dto.userInstruction,
    );

    return {
      promptPreview,
      usedModelKey,
      targetTables,
      referenceTables,
    };
  }

  async reviewAndCorrect(
    novelId: number,
    dto: PipelineSecondReviewDto,
  ): Promise<PipelineSecondReviewResponse> {
    await this.assertNovelExists(novelId);
    const targetTables = this.resolveTargetTables(dto.targetTables);
    const referenceTables = this.resolveReferenceTables(dto.referenceTables);
    const usedModelKey = await this.resolveOptionalModelKey(dto.modelKey);
    const promptPreview =
      dto.allowPromptEdit && dto.promptOverride?.trim()
        ? dto.promptOverride.trim()
        : await this.buildReviewPrompt(
            novelId,
            targetTables,
            referenceTables,
            dto.userInstruction,
          );

    this.logReviewStage('request start', {
      novelId,
      modelKey: usedModelKey,
      targetTables,
      referenceTables,
      promptLength: promptPreview.length,
    });

    const aiJson = await this.callLcAiApi(usedModelKey, promptPreview);
    const topicMap = await this.getEnabledSkeletonTopicMap(novelId);
    const {
      normalized,
      warnings,
      noteDiagnostics,
      qualityDiagnostics,
    } = this.validateAndNormalizeReviewResult(
      aiJson,
      topicMap,
      targetTables,
    );

    const reviewBatchId = randomUUID();
    const reviewedAt = new Date().toISOString();
    const revisionNotesByTable = this.buildRevisionNotesByTable(
      targetTables,
      normalized.reviewNotes,
      usedModelKey,
      reviewBatchId,
      reviewedAt,
    );

    this.logReviewStage(
      'quality diagnostics',
      {
        charactersAliasNormalizedCount:
          qualityDiagnostics.charactersAliasNormalizedCount,
        skeletonTopicWeakItemCount: qualityDiagnostics.skeletonTopicWeakItemCount,
        explosionWeakCount: qualityDiagnostics.explosionWeakCount,
        reviewNotesByTable: noteDiagnostics.reviewNotesByTable,
        focusTablesReceivedAiNotes: {
          novel_characters:
            (noteDiagnostics.reviewNotesByTable.novel_characters ?? 0) > 0,
          novel_skeleton_topic_items:
            (noteDiagnostics.reviewNotesByTable.novel_skeleton_topic_items ??
              0) > 0,
          novel_explosions:
            (noteDiagnostics.reviewNotesByTable.novel_explosions ?? 0) > 0,
        },
      },
      qualityDiagnostics.skeletonTopicWeakItemCount > 0 ||
        qualityDiagnostics.explosionWeakCount > 0
        ? 'warn'
        : 'log',
    );

    const { summary, tableDetails } = await this.persistReviewedData(
      novelId,
      targetTables,
      normalized,
      topicMap,
      revisionNotesByTable,
      warnings,
    );

    return {
      ok: true,
      summary,
      reviewNotes: normalized.reviewNotes,
      warnings: warnings.length ? warnings : undefined,
      details: {
        reviewNotes: noteDiagnostics,
        tables: tableDetails,
      },
    };
  }

  private resolveTargetTables(
    targetTables?: PipelineSecondReviewTargetTable[],
  ): PipelineSecondReviewTargetTable[] {
    if (!targetTables?.length) {
      throw new BadRequestException('targetTables 至少选择一项');
    }

    const unique = [...new Set(targetTables)];
    if (
      unique.includes('novel_timelines') &&
      (!unique.includes('novel_key_nodes') || !unique.includes('novel_explosions'))
    ) {
      throw new BadRequestException(
        '选择 novel_timelines 进行覆盖写回时，必须同时选择 novel_key_nodes 和 novel_explosions，以避免未选中表的 timeline_id 被动变化。',
      );
    }
    return unique;
  }

  private resolveReferenceTables(
    referenceTables?: PipelineSecondReviewReferenceTable[],
  ): PipelineSecondReviewReferenceTable[] {
    if (!referenceTables?.length) {
      return DEFAULT_REFERENCE_TABLES;
    }
    return [...new Set(referenceTables)];
  }

  private async resolveOptionalModelKey(modelKey?: string): Promise<string> {
    const normalized = this.normalizeText(modelKey);
    if (normalized) {
      return this.resolveModelKey(normalized);
    }

    const rows = await this.dataSource.query(
      `
      SELECT model_key AS modelKey
      FROM ai_model_catalog
      WHERE is_active = 1
      ORDER BY sort_order ASC, display_name ASC, model_key ASC
      LIMIT 1
      `,
    );
    if (!rows.length) {
      throw new BadRequestException('No active AI model is available');
    }
    return String(rows[0].modelKey);
  }

  private async resolveModelKey(modelKey: string): Promise<string> {
    const rows = await this.dataSource.query(
      `
      SELECT model_key AS modelKey
      FROM ai_model_catalog
      WHERE is_active = 1 AND model_key = ?
      LIMIT 1
      `,
      [modelKey],
    );

    if (!rows.length) {
      throw new BadRequestException(`AI model ${modelKey} is not available`);
    }

    return modelKey;
  }

  private async buildReviewPrompt(
    novelId: number,
    targetTables: PipelineSecondReviewTargetTable[],
    referenceTables: PipelineSecondReviewReferenceTable[],
    userInstruction?: string,
  ): Promise<string> {
    const currentResultBlocks = await this.buildCurrentResultBlocks(novelId, targetTables);
    const referenceBlocks = await this.buildReferenceBlocks(novelId, referenceTables);
    const skeletonTopicBlock = await this.buildSkeletonTopicDefinitionBlock(novelId);

    const targetTableBlock = [
      '【本次检测对象表】',
      ...targetTables.map((tableName) => `- ${tableName}`),
    ].join('\n');

    const rulesBlock = [
      '【二次AI自检目标】',
      '你不是重新裸生成，而是基于当前数据库中已经生成的结构化结果进行二次审查和纠偏。',
      '请重点完成：核对、补漏、去重、纠偏、强化短剧爆点质量，并让 skeletonTopicItems 真正围绕 topic 定义。',
      '',
      '【你的角色】',
      '你是“历史骨架与短剧爆点结构化质检纠偏器”，不是普通润色助手。你必须优先修正结构质量，而不是简单换一种说法复述。',
      '',
      '【自检规则】',
      '1. 对于未被选中的 targetTables，请返回空数组，不要输出新内容。',
      '2. 对于被选中的 targetTables，请输出修正后的完整数组，后端会覆盖写回所选表。',
      '3. timelines 要检查顺序、缺漏、重复。',
      '4. characters 要检查核心人物补漏、去重、阵营统一。',
      '5. keyNodes 要检查是否覆盖关键阶段、标题是否重复。',
      '6. skeletonTopicItems 必须严格围绕系统提供的 topic 定义，不允许泛泛复述 source_text。',
      '7. explosions 要更像短剧爆点，而不是普通摘要。',
      '8. reviewNotes 用于说明本次发现的问题与修正动作。',
      '9. reviewNotes.table 必须使用数据库目标表全名之一：novel_timelines、novel_characters、novel_key_nodes、novel_skeleton_topic_items、novel_explosions。',
      '',
      '【characters 强规则】',
      '1. 必须尽量覆盖主角、核心对手、关键盟友/辅臣、关键阻碍者/内应。',
      '2. 必须统一人物别名，不允许把多个写法直接拼接在 name 字段里。',
      '3. faction 要规范化，避免同类阵营出现多种散乱写法。',
      '4. description 必须回答“此人如何推动剧情”，不能只是泛泛人物介绍。',
      '5. personality 必须服务剧情推进，不能只有空泛褒义词。',
      '6. settingWords 要适合后续角色设定/绘图/风格化生成，不要写成长段散文。',
      '',
      '【skeletonTopicItems 强规则】',
      '1. 每组 skeletonTopicItems 必须严格围绕对应 topic 的 topicKey、topicName、topicType、description 作答。',
      '2. 不允许只是把 drama_source_text 改写成另一段摘要。',
      '3. 如果 topicType = list，必须拆成多个有区分度的 item，每条都要是独立观点/阶段/原因/结论。',
      '4. 如果 topicType = text，仍然优先拆成多个 item，从不同分析维度回答该 topic；除非资料极少，否则不要只输出 1 条大段总结。',
      '5. topicType = text 时，每条 item 至少要回答以下之一：为什么会发生、关键误判是什么、结构性后果是什么、改写抓手在哪里。',
      '6. 对“过程分析”类 topic，不要按时间顺序平铺流水账，而要提炼转折点、关键博弈、策略变化和因果链。',
      '7. 对“失败原因分析”类 topic，不要把事件重说一遍，而要拆成可复用的原因维度，例如决策失误、用人问题、军事短板、情报失效、内部背叛。',
      '8. 每个 item 必须具备分析/提炼价值，而不是原文摘抄；content 至少要体现“结论 + 依据/影响”。',
      '9. itemTitle 必须像一个分析结论，而不是章节标题；优先使用“削藩策略过急导致燕王提前反叛”这类可直接表达判断的标题。',
      '10. 严禁大量使用“原因一/阶段一/过程一/内容一”这类空标题。',
      '11. 如果你发现当前 skeletonTopicItems 仍偏摘要，请主动重写为围绕 topic 定义的分析结果，即使需要压缩原始细节，也要优先保证分析性和针对性。',
      '',
      '【explosions 强规则】',
      '1. 每个 explosion 必须是“短剧可拍的爆点单元”，不是普通历史摘要。',
      '2. 每条至少体现以下元素中的两项：压迫、反击、反转、翻盘、身份差、权力逆转、生死危机、情绪释放。',
      '3. title 必须短剧化，不能像教材目录。',
      '4. sceneRestoration 必须写出角色、场景、动作、冲突，形成画面感。',
      '5. dramaticQuality 必须明确说明“为什么有戏”，包括冲突点、反转点或情绪爆发点。',
      '6. adaptability 必须明确说明为什么适合短剧改编，例如单场景强冲突、高反转、低成本可拍、强情绪释放、易形成集尾钩子。',
      '',
      '【reviewNotes 强规则】',
      '1. reviewNotes 不能只写宽泛评价，必须写本轮具体修正动作。',
      '2. 对 novel_characters：要说明补了哪些关键人物、统一了哪些别名、规范了哪些 faction。',
      '3. 对 novel_skeleton_topic_items：要说明哪些 topic 原先过于摘要化，以及现在如何改成围绕 topic 定义的提炼结果。',
      '4. 对 novel_explosions：要说明哪些爆点原先太平，以及现在增强了哪些冲突、反转、画面感或传播钩子。',
      '',
      '【输出要求】',
      '1. 必须输出严格 JSON。',
      '2. 顶层必须包含：timelines、characters、keyNodes、skeletonTopicItems、explosions、reviewNotes。',
      '3. 所有数组字段都必须存在，即使为空也必须返回空数组。',
      '4. reviewNotes 元素格式：{ "table": "字符串", "issue": "字符串", "fix": "字符串" }',
    ].join('\n');

    const userInstructionBlock = [
      '【用户附加要求】',
      this.normalizeText(userInstruction) || '无',
    ].join('\n');

    const schemaBlock = [
      '【输出 JSON Schema】',
      '{',
      '  "timelines": [',
      '    { "timeNode": "字符串", "event": "字符串" }',
      '  ],',
      '  "characters": [',
      '    { "name": "字符串", "faction": "字符串", "description": "字符串", "personality": "字符串", "settingWords": "字符串" }',
      '  ],',
      '  "keyNodes": [',
      '    { "category": "字符串", "title": "字符串", "description": "字符串", "timelineRef": "字符串，可选" }',
      '  ],',
      '  "skeletonTopicItems": [',
      '    {',
      '      "topicKey": "必须对应已存在 topic_key",',
      '      "items": [',
      '        { "itemTitle": "字符串", "content": "字符串", "contentJson": null, "sourceRef": "字符串" }',
      '      ]',
      '    }',
      '  ],',
      '  "explosions": [',
      '    { "explosionType": "字符串", "title": "字符串", "subtitle": "字符串", "sceneRestoration": "字符串", "dramaticQuality": "字符串", "adaptability": "字符串", "timelineRef": "字符串，可选" }',
      '  ],',
      '  "reviewNotes": [',
      '    { "table": "必须是 novel_timelines/novel_characters/novel_key_nodes/novel_skeleton_topic_items/novel_explosions 之一", "issue": "字符串", "fix": "字符串" }',
      '  ]',
      '}',
    ].join('\n');

    return [
      '【System Prompt】',
      '你是短剧 Pipeline 二次AI自检助手，负责对当前已生成结果做结构审查与纠偏。',
      '',
      targetTableBlock,
      '',
      currentResultBlocks || '【当前已生成结果】\n无',
      '',
      referenceBlocks || '【参考资料】\n无',
      '',
      skeletonTopicBlock,
      '',
      rulesBlock,
      '',
      userInstructionBlock,
      '',
      schemaBlock,
    ].join('\n');
  }

  private async buildCurrentResultBlocks(
    novelId: number,
    targetTables: PipelineSecondReviewTargetTable[],
  ): Promise<string> {
    const blocks: string[] = [];

    if (targetTables.includes('novel_timelines')) {
      const rows = await this.selectByNovel('novel_timelines', 't', novelId, {
        orderBy: 't.sort_order',
      });
      blocks.push(
        [
          '【当前结果：novel_timelines】',
          rows.length
            ? rows
                .map(
                  (row, index) =>
                    `${index + 1}. timeNode=${row.time_node ?? ''} | event=${this.trimBlock(
                      row.event,
                      300,
                    )}`,
                )
                .join('\n')
            : '无',
        ].join('\n'),
      );
    }

    if (targetTables.includes('novel_characters')) {
      const rows = await this.selectByNovel('novel_characters', 'c', novelId, {
        orderBy: 'c.sort_order',
      });
      blocks.push(
        [
          '【当前结果：novel_characters】',
          rows.length
            ? rows
                .map(
                  (row, index) =>
                    `${index + 1}. name=${row.name ?? ''} | faction=${row.faction ?? ''} | description=${this.trimBlock(
                      row.description,
                      240,
                    )} | personality=${this.trimBlock(row.personality, 180)}`,
                )
                .join('\n')
            : '无',
        ].join('\n'),
      );
    }

    if (targetTables.includes('novel_key_nodes')) {
      const rows = await this.selectByNovel('novel_key_nodes', 'k', novelId, {
        orderBy: 'k.sort_order',
      });
      blocks.push(
        [
          '【当前结果：novel_key_nodes】',
          rows.length
            ? rows
                .map(
                  (row, index) =>
                    `${index + 1}. category=${row.category ?? ''} | title=${row.title ?? ''} | description=${this.trimBlock(
                      row.description,
                      240,
                    )} | timelineId=${row.timeline_id ?? ''}`,
                )
                .join('\n')
            : '无',
        ].join('\n'),
      );
    }

    if (targetTables.includes('novel_skeleton_topic_items')) {
      const rows = await this.loadSkeletonTopicReviewRows(novelId);
      blocks.push(
        [
          '【当前结果：novel_skeleton_topic_items】',
          rows.length
            ? rows
                .map((row) => {
                  const items = Array.isArray(row.items)
                    ? row.items
                        .map(
                          (item: RowRecord, index: number) =>
                            `  ${index + 1}. itemTitle=${item.item_title ?? ''} | content=${this.trimBlock(
                              item.content,
                              200,
                            )} | sourceRef=${item.source_ref ?? ''}`,
                        )
                        .join('\n')
                    : '  无';

                  return [
                    `topicKey=${row.topicKey} | topicName=${row.topicName} | topicType=${row.topicType}`,
                    `topicDescription=${row.topicDescription ?? ''}`,
                    items,
                  ].join('\n');
                })
                .join('\n\n')
            : '无',
        ].join('\n'),
      );
    }

    if (targetTables.includes('novel_explosions')) {
      const rows = await this.selectByNovel('novel_explosions', 'e', novelId, {
        orderBy: 'e.sort_order',
      });
      blocks.push(
        [
          '【当前结果：novel_explosions】',
          rows.length
            ? rows
                .map(
                  (row, index) =>
                    `${index + 1}. explosionType=${row.explosion_type ?? ''} | title=${row.title ?? ''} | subtitle=${row.subtitle ?? ''} | sceneRestoration=${this.trimBlock(
                      row.scene_restoration,
                      220,
                    )} | dramaticQuality=${this.trimBlock(row.dramatic_quality, 180)}`,
                )
                .join('\n')
            : '无',
        ].join('\n'),
      );
    }

    return blocks.join('\n\n');
  }

  private async loadSkeletonTopicReviewRows(novelId: number): Promise<RowRecord[]> {
    if (!(await this.hasTable('novel_skeleton_topics'))) {
      return [];
    }

    const topicRows = await this.dataSource.query(
      `
      SELECT
        st.id,
        st.topic_key AS topicKey,
        st.topic_name AS topicName,
        st.topic_type AS topicType,
        st.description AS topicDescription,
        st.sort_order AS sortOrder
      FROM novel_skeleton_topics st
      WHERE st.novel_id = ? AND st.is_enabled = 1
      ORDER BY st.sort_order ASC, st.id ASC
      `,
      [novelId],
    );

    if (!(await this.hasTable('novel_skeleton_topic_items'))) {
      return topicRows.map((row: RowRecord) => ({ ...row, items: [] }));
    }

    const itemRows = await this.dataSource.query(
      `
      SELECT
        i.topic_id,
        i.item_title,
        i.content,
        i.content_json,
        i.source_ref,
        i.sort_order
      FROM novel_skeleton_topic_items i
      WHERE i.novel_id = ?
      ORDER BY i.topic_id ASC, i.sort_order ASC, i.id ASC
      `,
      [novelId],
    );

    const itemsByTopicId = new Map<number, RowRecord[]>();
    for (const row of itemRows) {
      const topicId = Number(row.topic_id);
      if (!itemsByTopicId.has(topicId)) {
        itemsByTopicId.set(topicId, []);
      }
      itemsByTopicId.get(topicId)?.push(row);
    }

    return topicRows.map((row: RowRecord) => ({
      ...row,
      items: itemsByTopicId.get(Number(row.id)) ?? [],
    }));
  }

  private async buildReferenceBlocks(
    novelId: number,
    referenceTables: PipelineSecondReviewReferenceTable[],
  ): Promise<string> {
    const blocks: string[] = [];

    if (referenceTables.includes('drama_novels')) {
      const base = await this.getNovelBaseInfo(novelId);
      if (base) {
        blocks.push(
          [
            '【项目基础信息】',
            `项目名：${base.novels_name ?? ''}`,
            `简介：${this.trimBlock(base.description, 800)}`,
            `总章节：${base.total_chapters ?? ''}`,
            `升级节奏：${base.power_up_interval ?? ''}`,
            `作者：${base.author ?? ''}`,
          ].join('\n'),
        );
      }
    }

    if (referenceTables.includes('drama_source_text')) {
      const block = await this.getSourceTextBlock(novelId);
      if (block) {
        blocks.push(block);
      }
    }

    const latestStrategy = referenceTables.includes('novel_adaptation_strategy')
      ? await this.getLatestAdaptationStrategy(novelId)
      : null;

    if (latestStrategy) {
      blocks.push(
        [
          '【改编策略】',
          `版本：v${latestStrategy.version ?? ''}`,
          `标题：${latestStrategy.strategy_title ?? ''}`,
          `说明：${this.trimBlock(latestStrategy.strategy_description, 800)}`,
          `Prompt 模板：${this.trimBlock(latestStrategy.ai_prompt_template, 1200)}`,
        ].join('\n'),
      );
    }

    if (referenceTables.includes('adaptation_modes') && latestStrategy?.mode_id) {
      const mode = await this.getAdaptationMode(Number(latestStrategy.mode_id));
      if (mode) {
        blocks.push(
          [
            '【改编模式】',
            `mode_key：${mode.mode_key ?? ''}`,
            `mode_name：${mode.mode_name ?? ''}`,
            `description：${this.trimBlock(mode.description, 500)}`,
          ].join('\n'),
        );
      }
    }

    if (referenceTables.includes('set_core')) {
      const activeSetCore = await this.getActiveSetCore(novelId);
      if (activeSetCore) {
        blocks.push(
          [
            '【当前核心设定】',
            `title：${activeSetCore.title ?? ''}`,
            `core_text：${this.trimBlock(activeSetCore.core_text, 1800)}`,
            `protagonist_name：${activeSetCore.protagonist_name ?? ''}`,
            `protagonist_identity：${activeSetCore.protagonist_identity ?? ''}`,
            `target_story：${activeSetCore.target_story ?? ''}`,
            `rewrite_goal：${activeSetCore.rewrite_goal ?? ''}`,
            `constraint_text：${activeSetCore.constraint_text ?? ''}`,
          ].join('\n'),
        );
      }
    }

    return blocks.join('\n\n');
  }

  private async buildSkeletonTopicDefinitionBlock(novelId: number): Promise<string> {
    const rows = await this.listEnabledSkeletonTopics(novelId);
    if (!rows.length) {
      return [
        '【系统预定义骨架主题】',
        '当前项目没有启用的 novel_skeleton_topics。',
      ].join('\n');
    }

    return [
      '【系统预定义骨架主题】',
      '以下是系统已存在且启用的 topic 定义。review 纠偏时必须围绕这些 topicKey，不允许新增 topic。',
      ...rows.map(
        (topic) =>
          `- topicKey=${topic.topic_key} | topicName=${topic.topic_name} | topicType=${topic.topic_type} | description=${topic.description ?? ''}`,
      ),
    ].join('\n');
  }

  private validateAndNormalizeReviewResult(
    aiJson: Record<string, unknown>,
    topicMap: Map<string, SkeletonTopicMeta>,
    targetTables: PipelineSecondReviewTargetTable[],
  ): {
    normalized: PipelineReviewAiResult;
    warnings: string[];
    noteDiagnostics: ReviewNotesDiagnostics;
    qualityDiagnostics: ReviewQualityDiagnostics;
  } {
    const requiredKeys = [
      'timelines',
      'characters',
      'keyNodes',
      'skeletonTopicItems',
      'explosions',
    ] as const;

    for (const key of requiredKeys) {
      if (!(key in aiJson) || !Array.isArray(aiJson[key])) {
        throw new BadRequestException(`AI result field "${key}" must be an array`);
      }
    }

    const warnings: string[] = [];
    const timelines = this.normalizeTimelines(aiJson.timelines as unknown[], warnings);
    const { items: characters, aliasNormalizedCount } = this.normalizeCharacters(
      aiJson.characters as unknown[],
      warnings,
    );
    const keyNodes = this.normalizeKeyNodes(aiJson.keyNodes as unknown[], warnings);
    const {
      groups: skeletonTopicItems,
      weakItemCount: skeletonTopicWeakItemCount,
    } = this.normalizeSkeletonTopicItems(
      aiJson.skeletonTopicItems as unknown[],
      topicMap,
      warnings,
    );
    const { items: explosions, weakCount: explosionWeakCount } =
      this.normalizeExplosions(aiJson.explosions as unknown[], warnings);
    const rawReviewNotes = Array.isArray(aiJson.reviewNotes) ? (aiJson.reviewNotes as unknown[]) : [];
    const { reviewNotes, diagnostics: noteDiagnostics } = this.normalizeReviewNotes(
      rawReviewNotes,
      targetTables,
      warnings,
    );

    return {
      normalized: {
        timelines,
        characters,
        keyNodes,
        skeletonTopicItems,
        explosions,
        reviewNotes,
      },
      warnings,
      noteDiagnostics,
      qualityDiagnostics: {
        charactersAliasNormalizedCount: aliasNormalizedCount,
        skeletonTopicWeakItemCount,
        explosionWeakCount,
      },
    };
  }

  private normalizeReviewNotes(
    items: unknown[],
    targetTables: PipelineSecondReviewTargetTable[],
    warnings: string[],
  ): { reviewNotes: ReviewNoteInput[]; diagnostics: ReviewNotesDiagnostics } {
    const allowed = new Set<string>(targetTables);
    const result: ReviewNoteInput[] = [];
    const byTable = new Map<string, number>();
    let droppedCount = 0;

    for (const raw of items) {
      const item = this.asRecord(raw);
      const rawTable = this.normalizeText(item.table);
      const table = this.normalizeReviewNoteTableName(rawTable);
      const issue = this.normalizeText(item.issue);
      const fix = this.normalizeText(item.fix);

      if (!rawTable || !issue || !fix) {
        warnings.push('Dropped reviewNote because table/issue/fix is empty');
        droppedCount += 1;
        continue;
      }

      if (!table) {
        warnings.push(`Dropped reviewNote because table name is unsupported: ${rawTable}`);
        droppedCount += 1;
        continue;
      }

      if (!allowed.has(table)) {
        warnings.push(`Dropped reviewNote because table is not selected: ${table}`);
        droppedCount += 1;
        continue;
      }

      result.push({ table, issue, fix });
      byTable.set(table, (byTable.get(table) ?? 0) + 1);
    }

    this.logReviewStage('review notes normalized', {
      rawReviewNotesCount: items.length,
      normalizedReviewNotesCount: result.length,
      droppedReviewNotesCount: droppedCount,
      reviewNotesByTable: Object.fromEntries(byTable.entries()),
    });

    return {
      reviewNotes: result,
      diagnostics: {
        rawCount: items.length,
        normalizedCount: result.length,
        droppedCount,
        reviewNotesByTable: Object.fromEntries(byTable.entries()),
      },
    };
  }

  private async persistReviewedData(
    novelId: number,
    targetTables: PipelineSecondReviewTargetTable[],
    result: PipelineReviewAiResult,
    topicMap: Map<string, SkeletonTopicMeta>,
    revisionNotesByTable: Map<PipelineSecondReviewTargetTable, RevisionNoteEntry[]>,
    warnings: string[],
  ): Promise<{
    summary: PipelineSecondReviewResponse['summary'];
    tableDetails: Record<PipelineSecondReviewTargetTable, TableWriteDetails>;
  }> {
    this.logReviewStage('transaction start', { novelId, targetTables });

    try {
      const resultWithDetails = await this.dataSource.transaction(async (manager) => {
        const existingNotesIndex = await this.loadExistingRevisionNotesIndex(
          novelId,
          targetTables,
          manager,
        );
        await this.deleteSelectedData(novelId, targetTables, manager);

        const tableDetails = this.createInitialTableWriteDetails(targetTables, revisionNotesByTable);

        const shouldWriteTimelines = targetTables.includes('novel_timelines');
        const shouldWriteCharacters = targetTables.includes('novel_characters');
        const shouldWriteKeyNodes = targetTables.includes('novel_key_nodes');
        const shouldWriteSkeletonTopicItems = targetTables.includes(
          'novel_skeleton_topic_items',
        );
        const shouldWriteExplosions = targetTables.includes('novel_explosions');

        const insertedTimelines = shouldWriteTimelines
          ? await this.insertTimelines(
              novelId,
              result.timelines,
              manager,
              revisionNotesByTable.get('novel_timelines') ?? null,
              existingNotesIndex.novel_timelines,
              tableDetails.novel_timelines,
            )
          : await this.loadExistingTimelines(novelId, manager);
        const timelineLookup = this.buildTimelineLookup(insertedTimelines);

        const insertedCharacters = shouldWriteCharacters
          ? await this.insertCharacters(
              novelId,
              result.characters,
              manager,
              revisionNotesByTable.get('novel_characters') ?? null,
              existingNotesIndex.novel_characters,
              tableDetails.novel_characters,
            )
          : 0;

        const insertedKeyNodes = shouldWriteKeyNodes
          ? await this.insertKeyNodes(
              novelId,
              result.keyNodes,
              timelineLookup,
              manager,
              revisionNotesByTable.get('novel_key_nodes') ?? null,
              existingNotesIndex.novel_key_nodes,
              tableDetails.novel_key_nodes,
            )
          : 0;

        const insertedSkeletonTopicItems = shouldWriteSkeletonTopicItems
          ? await this.insertSkeletonTopicItems(
              novelId,
              result.skeletonTopicItems,
              topicMap,
              manager,
              warnings,
              revisionNotesByTable.get('novel_skeleton_topic_items') ?? null,
              existingNotesIndex.novel_skeleton_topic_items,
              tableDetails.novel_skeleton_topic_items,
            )
          : 0;

        const insertedExplosions = shouldWriteExplosions
          ? await this.insertExplosions(
              novelId,
              result.explosions,
              timelineLookup,
              manager,
              warnings,
              revisionNotesByTable.get('novel_explosions') ?? null,
              existingNotesIndex.novel_explosions,
              tableDetails.novel_explosions,
            )
          : 0;

        if (shouldWriteTimelines) {
          tableDetails.novel_timelines.insertedRows = result.timelines.length;
        }
        if (shouldWriteCharacters) {
          tableDetails.novel_characters.insertedRows = insertedCharacters;
        }
        if (shouldWriteKeyNodes) {
          tableDetails.novel_key_nodes.insertedRows = insertedKeyNodes;
        }
        if (shouldWriteSkeletonTopicItems) {
          tableDetails.novel_skeleton_topic_items.insertedRows = insertedSkeletonTopicItems;
        }
        if (shouldWriteExplosions) {
          tableDetails.novel_explosions.insertedRows = insertedExplosions;
        }

        this.logReviewStage('revision note usage summary', tableDetails);

        return {
          summary: {
            timelines: shouldWriteTimelines ? result.timelines.length : 0,
            characters: insertedCharacters,
            keyNodes: insertedKeyNodes,
            skeletonTopicItems: insertedSkeletonTopicItems,
            explosions: insertedExplosions,
          },
          tableDetails,
        };
      });

      this.logReviewStage('transaction commit', {
        novelId,
        summary: resultWithDetails.summary,
        tableDetails: resultWithDetails.tableDetails,
      });
      return resultWithDetails;
    } catch (error) {
      this.logReviewStage(
        'transaction rollback',
        { novelId, errorMessage: this.getErrorMessage(error) },
        'error',
      );
      throw error;
    }
  }

  private async deleteSelectedData(
    novelId: number,
    targetTables: PipelineSecondReviewTargetTable[],
    manager: EntityManager,
  ): Promise<void> {
    if (targetTables.includes('novel_key_nodes')) {
      await manager.query(`DELETE FROM novel_key_nodes WHERE novel_id = ?`, [novelId]);
    }
    if (targetTables.includes('novel_explosions')) {
      await manager.query(`DELETE FROM novel_explosions WHERE novel_id = ?`, [novelId]);
    }
    if (targetTables.includes('novel_skeleton_topic_items')) {
      await manager.query(`DELETE FROM novel_skeleton_topic_items WHERE novel_id = ?`, [novelId]);
    }
    if (targetTables.includes('novel_characters')) {
      await manager.query(`DELETE FROM novel_characters WHERE novel_id = ?`, [novelId]);
    }
    if (targetTables.includes('novel_timelines')) {
      await manager.query(`DELETE FROM novel_timelines WHERE novel_id = ?`, [novelId]);
    }
  }

  private async loadExistingTimelines(
    novelId: number,
    manager: EntityManager,
  ): Promise<TimelineLookupRow[]> {
    const rows = await manager.query(
      `
      SELECT id, time_node AS timeNode, event
      FROM novel_timelines
      WHERE novel_id = ?
      ORDER BY sort_order ASC, id ASC
      `,
      [novelId],
    );
    return rows.map((row: RowRecord) => ({
      id: Number(row.id),
      timeNode: this.normalizeText(row.timeNode),
      event: this.normalizeText(row.event),
    }));
  }

  private async insertTimelines(
    novelId: number,
    timelines: TimelineInput[],
    manager: EntityManager,
    revisionNotes: RevisionNoteEntry[] | null,
    existingNotesIndex: Map<string, RevisionNoteEntry[]>,
    tableDetails: TableWriteDetails,
  ): Promise<TimelineLookupRow[]> {
    const inserted: TimelineLookupRow[] = [];

    for (const [index, item] of timelines.entries()) {
      this.assertMaxLength('novel_timelines', 'time_node', item.timeNode, 100, index, {
        timeNodePreview: this.previewText(item.timeNode),
      });

      try {
        const result: any = await manager.query(
          `
          INSERT INTO novel_timelines (novel_id, time_node, event, sort_order, revision_notes_json)
          VALUES (?, ?, ?, ?, ?)
          `,
          [
            novelId,
            item.timeNode,
            item.event,
            index,
            JSON.stringify(
              this.mergeRevisionNotes(
                existingNotesIndex.get(this.buildTimelineRevisionKey(item.timeNode, item.event)),
                revisionNotes,
                tableDetails,
              ),
            ),
          ],
        );
        inserted.push({
          id: Number(result.insertId),
          timeNode: item.timeNode,
          event: item.event,
        });
      } catch (error) {
        const context = {
          timeNodePreview: this.previewText(item.timeNode),
          eventPreview: this.previewText(item.event),
          timeNodeLength: this.getStringLength(item.timeNode),
          eventLength: this.getStringLength(item.event),
        };
        this.logRowFailure('novel_timelines', index, context, error);
        throw this.formatPersistError(error, 'novel_timelines', index, context);
      }
    }

    return inserted;
  }

  private async insertCharacters(
    novelId: number,
    characters: CharacterInput[],
    manager: EntityManager,
    revisionNotes: RevisionNoteEntry[] | null,
    existingNotesIndex: Map<string, RevisionNoteEntry[]>,
    tableDetails: TableWriteDetails,
  ): Promise<number> {
    for (const [index, item] of characters.entries()) {
      this.assertMaxLength('novel_characters', 'name', item.name, 100, index);
      this.assertMaxLength('novel_characters', 'faction', item.faction, 50, index);

      try {
        await manager.query(
          `
          INSERT INTO novel_characters (
            novel_id,
            name,
            faction,
            description,
            personality,
            setting_words,
            sort_order,
            revision_notes_json
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          `,
          [
            novelId,
            item.name,
            item.faction || null,
            item.description || null,
            item.personality || null,
            item.settingWords || null,
            index,
            JSON.stringify(
              this.mergeRevisionNotes(
                existingNotesIndex.get(this.buildCharacterRevisionKey(item.name)),
                revisionNotes,
                tableDetails,
              ),
            ),
          ],
        );
      } catch (error) {
        const context = {
          namePreview: this.previewText(item.name),
          factionPreview: this.previewText(item.faction),
          nameLength: this.getStringLength(item.name),
          factionLength: this.getStringLength(item.faction),
        };
        this.logRowFailure('novel_characters', index, context, error);
        throw this.formatPersistError(error, 'novel_characters', index, context);
      }
    }

    return characters.length;
  }

  private async insertKeyNodes(
    novelId: number,
    keyNodes: KeyNodeInput[],
    timelineLookup: Map<string, number>,
    manager: EntityManager,
    revisionNotes: RevisionNoteEntry[] | null,
    existingNotesIndex: Map<string, RevisionNoteEntry[]>,
    tableDetails: TableWriteDetails,
  ): Promise<number> {
    for (const [index, item] of keyNodes.entries()) {
      const category = item.category || '未分类';
      this.assertMaxLength('novel_key_nodes', 'category', category, 50, index);
      this.assertMaxLength('novel_key_nodes', 'title', item.title, 255, index);

      try {
        await manager.query(
          `
          INSERT INTO novel_key_nodes (
            novel_id,
            timeline_id,
            category,
            title,
            description,
            sort_order,
            revision_notes_json
          ) VALUES (?, ?, ?, ?, ?, ?, ?)
          `,
          [
            novelId,
            this.resolveTimelineId(item.timelineRef, timelineLookup),
            category,
            item.title,
            item.description || null,
            index,
            JSON.stringify(
              this.mergeRevisionNotes(
                existingNotesIndex.get(this.buildKeyNodeRevisionKey(category, item.title)),
                revisionNotes,
                tableDetails,
              ),
            ),
          ],
        );
      } catch (error) {
        const context = {
          titlePreview: this.previewText(item.title),
          categoryPreview: this.previewText(category),
          titleLength: this.getStringLength(item.title),
          categoryLength: this.getStringLength(category),
        };
        this.logRowFailure('novel_key_nodes', index, context, error);
        throw this.formatPersistError(error, 'novel_key_nodes', index, context);
      }
    }

    return keyNodes.length;
  }

  private async insertSkeletonTopicItems(
    novelId: number,
    groups: SkeletonTopicItemGroupInput[],
    topicMap: Map<string, SkeletonTopicMeta>,
    manager: EntityManager,
    warnings: string[],
    revisionNotes: RevisionNoteEntry[] | null,
    existingNotesIndex: Map<string, RevisionNoteEntry[]>,
    tableDetails: TableWriteDetails,
  ): Promise<number> {
    let total = 0;

    for (const group of groups) {
      const topic = topicMap.get(group.topicKey);
      if (!topic) {
        warnings.push(`Skipped skeletonTopicItems insert because topicKey does not exist: ${group.topicKey}`);
        continue;
      }

      for (const [index, item] of group.items.entries()) {
        const itemTitle = this.truncateWithWarning(
          'novel_skeleton_topic_items',
          'item_title',
          item.itemTitle,
          255,
          index,
          warnings,
        );
        const sourceRef = this.truncateWithWarning(
          'novel_skeleton_topic_items',
          'source_ref',
          item.sourceRef,
          255,
          index,
          warnings,
        );

        try {
          await manager.query(
            `
            INSERT INTO novel_skeleton_topic_items (
              novel_id,
              topic_id,
              item_title,
              content,
              content_json,
              sort_order,
              source_ref,
              revision_notes_json
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            `,
            [
              novelId,
              topic.id,
              itemTitle || null,
              item.content || null,
              item.contentJson === null ? null : JSON.stringify(item.contentJson),
              index,
              sourceRef || null,
              JSON.stringify(
                this.mergeRevisionNotes(
                  existingNotesIndex.get(
                    this.buildSkeletonItemRevisionKey(topic.id, itemTitle, item.content),
                  ),
                  revisionNotes,
                  tableDetails,
                ),
              ),
            ],
          );
          total += 1;
        } catch (error) {
          const context = {
            topicKey: group.topicKey,
            itemTitlePreview: this.previewText(itemTitle),
            sourceRefPreview: this.previewText(sourceRef),
          };
          this.logRowFailure('novel_skeleton_topic_items', index, context, error);
          throw this.formatPersistError(
            error,
            'novel_skeleton_topic_items',
            index,
            context,
          );
        }
      }
    }

    return total;
  }

  private async insertExplosions(
    novelId: number,
    explosions: ExplosionInput[],
    timelineLookup: Map<string, number>,
    manager: EntityManager,
    warnings: string[],
    revisionNotes: RevisionNoteEntry[] | null,
    existingNotesIndex: Map<string, RevisionNoteEntry[]>,
    tableDetails: TableWriteDetails,
  ): Promise<number> {
    for (const [index, item] of explosions.entries()) {
      this.assertMaxLength('novel_explosions', 'explosion_type', item.explosionType, 50, index);
      this.assertMaxLength('novel_explosions', 'title', item.title, 255, index);
      const subtitle = this.truncateWithWarning(
        'novel_explosions',
        'subtitle',
        item.subtitle,
        255,
        index,
        warnings,
      );

      try {
        await manager.query(
          `
          INSERT INTO novel_explosions (
            novel_id,
            timeline_id,
            explosion_type,
            title,
            subtitle,
            scene_restoration,
            dramatic_quality,
            adaptability,
            sort_order,
            revision_notes_json
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `,
          [
            novelId,
            this.resolveTimelineId(item.timelineRef, timelineLookup),
            item.explosionType,
            item.title,
            subtitle || null,
            item.sceneRestoration || null,
            item.dramaticQuality || null,
            item.adaptability || null,
            index,
            JSON.stringify(
              this.mergeRevisionNotes(
                existingNotesIndex.get(
                  this.buildExplosionRevisionKey(item.explosionType, item.title),
                ),
                revisionNotes,
                tableDetails,
              ),
            ),
          ],
        );
      } catch (error) {
        const context = {
          explosionTypePreview: this.previewText(item.explosionType),
          titlePreview: this.previewText(item.title),
          subtitlePreview: this.previewText(subtitle),
        };
        this.logRowFailure('novel_explosions', index, context, error);
        throw this.formatPersistError(error, 'novel_explosions', index, context);
      }
    }

    return explosions.length;
  }

  private buildRevisionNotesByTable(
    targetTables: PipelineSecondReviewTargetTable[],
    reviewNotes: ReviewNoteInput[],
    reviewModel: string,
    reviewBatchId: string,
    reviewedAt: string,
  ): Map<PipelineSecondReviewTargetTable, RevisionNoteEntry[]> {
    const result = new Map<PipelineSecondReviewTargetTable, RevisionNoteEntry[]>();

    for (const tableName of targetTables) {
      const tableNotes = reviewNotes
        .filter((note) => note.table === tableName)
        .map((note) => ({
          reviewedAt,
          reviewModel,
          reviewBatchId,
          targetTable: tableName,
          source: 'ai' as const,
          action: 'updated',
          reason: note.issue,
          beforeSummary: note.issue,
          afterSummary: note.fix,
        }));

      result.set(
        tableName,
        tableNotes.length
          ? tableNotes
          : [
              {
                reviewedAt,
                reviewModel,
                reviewBatchId,
                targetTable: tableName,
                source: 'fallback' as const,
                action: 'reviewed',
                reason: 'AI reviewNotes missing for this table',
                beforeSummary: 'Existing generated result reviewed',
                afterSummary: 'Result rewritten during the current review batch',
              },
            ],
      );

      this.logReviewStage('table revision notes prepared', {
        tableName,
        usedAiNotesCount: tableNotes.length,
        usedFallback: tableNotes.length === 0,
        finalRevisionNotesCount: result.get(tableName)?.length ?? 0,
      });
    }

    return result;
  }

  private createInitialTableWriteDetails(
    targetTables: PipelineSecondReviewTargetTable[],
    revisionNotesByTable: Map<PipelineSecondReviewTargetTable, RevisionNoteEntry[]>,
  ): Record<PipelineSecondReviewTargetTable, TableWriteDetails> {
    const allTables: PipelineSecondReviewTargetTable[] = [
      'novel_timelines',
      'novel_characters',
      'novel_key_nodes',
      'novel_skeleton_topic_items',
      'novel_explosions',
    ];
    const details = {} as Record<PipelineSecondReviewTargetTable, TableWriteDetails>;
    for (const tableName of allTables) {
      const notes = revisionNotesByTable.get(tableName) ?? [];
      details[tableName] = {
        usedAiNotes: notes.filter((item) => item.source === 'ai').length,
        usedFallback: notes.some((item) => item.source === 'fallback'),
        mergedWithHistory: 0,
        insertedRows: 0,
      };
    }
    return details;
  }

  private normalizeReviewNoteTableName(
    raw: string,
  ): PipelineSecondReviewTargetTable | null {
    const normalized = raw.trim().toLowerCase();
    switch (normalized) {
      case 'timelines':
      case 'novel_timelines':
        return 'novel_timelines';
      case 'characters':
      case 'novel_characters':
        return 'novel_characters';
      case 'keynodes':
      case 'key_nodes':
      case 'novel_key_nodes':
        return 'novel_key_nodes';
      case 'skeletontopicitems':
      case 'skeleton_topic_items':
      case 'novel_skeleton_topic_items':
        return 'novel_skeleton_topic_items';
      case 'explosions':
      case 'novel_explosions':
        return 'novel_explosions';
      default:
        return null;
    }
  }

  private async loadExistingRevisionNotesIndex(
    novelId: number,
    targetTables: PipelineSecondReviewTargetTable[],
    manager: EntityManager,
  ): Promise<ExistingRevisionNotesIndex> {
    const index = {
      novel_timelines: new Map<string, RevisionNoteEntry[]>(),
      novel_characters: new Map<string, RevisionNoteEntry[]>(),
      novel_key_nodes: new Map<string, RevisionNoteEntry[]>(),
      novel_skeleton_topic_items: new Map<string, RevisionNoteEntry[]>(),
      novel_explosions: new Map<string, RevisionNoteEntry[]>(),
    } satisfies ExistingRevisionNotesIndex;

    if (targetTables.includes('novel_timelines')) {
      const rows = await manager.query(
        `SELECT time_node AS timeNode, event, revision_notes_json FROM novel_timelines WHERE novel_id = ?`,
        [novelId],
      );
      for (const row of rows) {
        const key = this.buildTimelineRevisionKey(row.timeNode, row.event);
        this.appendExistingNotes(index.novel_timelines, key, row.revision_notes_json, 'novel_timelines');
      }
    }

    if (targetTables.includes('novel_characters')) {
      const rows = await manager.query(
        `SELECT name, revision_notes_json FROM novel_characters WHERE novel_id = ?`,
        [novelId],
      );
      for (const row of rows) {
        const key = this.buildCharacterRevisionKey(row.name);
        this.appendExistingNotes(index.novel_characters, key, row.revision_notes_json, 'novel_characters');
      }
    }

    if (targetTables.includes('novel_key_nodes')) {
      const rows = await manager.query(
        `SELECT category, title, revision_notes_json FROM novel_key_nodes WHERE novel_id = ?`,
        [novelId],
      );
      for (const row of rows) {
        const key = this.buildKeyNodeRevisionKey(row.category, row.title);
        this.appendExistingNotes(index.novel_key_nodes, key, row.revision_notes_json, 'novel_key_nodes');
      }
    }

    if (targetTables.includes('novel_skeleton_topic_items')) {
      const rows = await manager.query(
        `SELECT topic_id AS topicId, item_title AS itemTitle, content, revision_notes_json FROM novel_skeleton_topic_items WHERE novel_id = ?`,
        [novelId],
      );
      for (const row of rows) {
        const key = this.buildSkeletonItemRevisionKey(row.topicId, row.itemTitle, row.content);
        this.appendExistingNotes(
          index.novel_skeleton_topic_items,
          key,
          row.revision_notes_json,
          'novel_skeleton_topic_items',
        );
      }
    }

    if (targetTables.includes('novel_explosions')) {
      const rows = await manager.query(
        `SELECT explosion_type AS explosionType, title, revision_notes_json FROM novel_explosions WHERE novel_id = ?`,
        [novelId],
      );
      for (const row of rows) {
        const key = this.buildExplosionRevisionKey(row.explosionType, row.title);
        this.appendExistingNotes(index.novel_explosions, key, row.revision_notes_json, 'novel_explosions');
      }
    }

    return index;
  }

  private appendExistingNotes(
    target: Map<string, RevisionNoteEntry[]>,
    key: string,
    rawNotes: unknown,
    tableName: PipelineSecondReviewTargetTable,
  ): void {
    if (!key) {
      return;
    }
    const parsed = this.parseExistingRevisionNotes(rawNotes, tableName);
    if (!parsed.length) {
      return;
    }
    target.set(key, [...(target.get(key) ?? []), ...parsed]);
  }

  private parseExistingRevisionNotes(
    rawNotes: unknown,
    tableName: PipelineSecondReviewTargetTable,
  ): RevisionNoteEntry[] {
    if (rawNotes === null || rawNotes === undefined || rawNotes === '') {
      return [];
    }

    if (typeof rawNotes !== 'string') {
      throw new BadRequestException(
        `读取 ${tableName} 的 revision_notes_json 失败：字段不是字符串，无法合并历史记录`,
      );
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(rawNotes);
    } catch (error) {
      throw new BadRequestException(
        `读取 ${tableName} 的 revision_notes_json 失败：不是合法 JSON。原始错误：${this.getErrorMessage(error)}`,
      );
    }

    if (!Array.isArray(parsed)) {
      throw new BadRequestException(
        `读取 ${tableName} 的 revision_notes_json 失败：JSON 根结构不是数组，无法合并历史记录`,
      );
    }

    return parsed.map((item, index) => {
      const record = this.asRecord(item);
      const reviewedAt = this.normalizeText(record.reviewedAt);
      const reviewModel = this.normalizeText(record.reviewModel);
      const reviewBatchId = this.normalizeText(record.reviewBatchId);
      const targetTable = this.normalizeText(record.targetTable) || tableName;
      const source =
        this.normalizeText(record.source) === 'fallback' ? 'fallback' : 'ai';
      const action = this.normalizeText(record.action);
      const reason = this.normalizeText(record.reason);
      const beforeSummary = this.normalizeText(record.beforeSummary);
      const afterSummary = this.normalizeText(record.afterSummary);

      if (!reviewedAt || !reviewModel || !reviewBatchId || !action || !reason) {
        throw new BadRequestException(
          `读取 ${tableName} 的 revision_notes_json 失败：第 ${index + 1} 条历史 note 缺少必要字段`,
        );
      }

      return {
        reviewedAt,
        reviewModel,
        reviewBatchId,
        targetTable,
        source,
        action,
        reason,
        beforeSummary,
        afterSummary,
      };
    });
  }

  private mergeRevisionNotes(
    existingNotes: RevisionNoteEntry[] | undefined,
    currentNotes: RevisionNoteEntry[] | null,
    tableDetails: TableWriteDetails,
  ): RevisionNoteEntry[] {
    const merged = [...(existingNotes ?? [])];
    if (existingNotes?.length) {
      tableDetails.mergedWithHistory += 1;
    }
    for (const note of currentNotes ?? []) {
      const duplicate = merged.some(
        (existing) =>
          existing.reviewBatchId === note.reviewBatchId &&
          existing.targetTable === note.targetTable &&
          existing.reason === note.reason &&
          existing.afterSummary === note.afterSummary,
      );
      if (!duplicate) {
        merged.push(note);
      }
    }
    return merged;
  }

  private buildTimelineRevisionKey(timeNode: unknown, event: unknown): string {
    return `${this.normalizeComparableText(timeNode)}::${this.normalizeComparableText(event)}`;
  }

  private buildCharacterRevisionKey(name: unknown): string {
    return this.normalizeComparableText(name);
  }

  private buildKeyNodeRevisionKey(category: unknown, title: unknown): string {
    return `${this.normalizeComparableText(category)}::${this.normalizeComparableText(title)}`;
  }

  private buildSkeletonItemRevisionKey(
    topicId: unknown,
    itemTitle: unknown,
    content: unknown,
  ): string {
    const normalizedTitle = this.normalizeComparableText(itemTitle);
    const normalizedContent = this.normalizeComparableText(
      this.previewText(content, 120),
    );
    return `${String(topicId ?? '')}::${normalizedTitle || normalizedContent}`;
  }

  private buildExplosionRevisionKey(
    explosionType: unknown,
    title: unknown,
  ): string {
    return `${this.normalizeComparableText(explosionType)}::${this.normalizeComparableText(title)}`;
  }

  private buildTimelineLookup(rows: TimelineLookupRow[]): Map<string, number> {
    const lookup = new Map<string, number>();

    for (const row of rows) {
      const timeNodeKey = this.normalizeComparableText(row.timeNode);
      const eventKey = this.normalizeComparableText(row.event);

      if (timeNodeKey && !lookup.has(timeNodeKey)) {
        lookup.set(timeNodeKey, row.id);
      }
      if (eventKey && !lookup.has(eventKey)) {
        lookup.set(eventKey, row.id);
      }
    }

    return lookup;
  }

  private resolveTimelineId(
    timelineRef: string,
    timelineLookup: Map<string, number>,
  ): number | null {
    const normalizedRef = this.normalizeComparableText(timelineRef);
    if (!normalizedRef) {
      return null;
    }

    if (timelineLookup.has(normalizedRef)) {
      return timelineLookup.get(normalizedRef) ?? null;
    }

    for (const [key, value] of timelineLookup.entries()) {
      if (key.includes(normalizedRef) || normalizedRef.includes(key)) {
        return value;
      }
    }

    return null;
  }

  private normalizeTimelines(items: unknown[], warnings: string[]): TimelineInput[] {
    const seen = new Set<string>();
    const result: TimelineInput[] = [];

    for (const raw of items) {
      const item = this.asRecord(raw);
      const timeNode = this.normalizeText(item.timeNode);
      const event = this.normalizeText(item.event);
      if (!timeNode || !event) {
        warnings.push('Dropped timeline item because timeNode/event is empty');
        continue;
      }
      const dedupeKey = `${this.normalizeComparableText(timeNode)}::${this.normalizeComparableText(event)}`;
      if (seen.has(dedupeKey)) {
        warnings.push(`Dropped duplicate timeline: ${timeNode}`);
        continue;
      }
      seen.add(dedupeKey);
      result.push({ timeNode, event });
    }

    return result;
  }

  private normalizeCharacters(
    items: unknown[],
    warnings: string[],
  ): { items: CharacterInput[]; aliasNormalizedCount: number } {
    const seen = new Set<string>();
    const result: CharacterInput[] = [];
    let aliasNormalizedCount = 0;

    for (const raw of items) {
      const item = this.asRecord(raw);
      const normalizedCharacter = this.normalizeCharacterNameAndDescription(
        item.name,
        item.description,
      );
      const name = normalizedCharacter.name;
      if (!name) {
        warnings.push('Dropped character because name is empty');
        continue;
      }
      const dedupeKey = this.normalizeComparableText(name);
      if (seen.has(dedupeKey)) {
        warnings.push(`Dropped duplicate character: ${name}`);
        continue;
      }
      seen.add(dedupeKey);
      if (normalizedCharacter.aliasNormalized) {
        aliasNormalizedCount += 1;
      }
      result.push({
        name,
        faction: this.normalizeText(item.faction),
        description: normalizedCharacter.description,
        personality: this.normalizeText(item.personality),
        settingWords: this.normalizeText(item.settingWords),
      });
    }

    return { items: result, aliasNormalizedCount };
  }

  private normalizeKeyNodes(items: unknown[], warnings: string[]): KeyNodeInput[] {
    const seen = new Set<string>();
    const result: KeyNodeInput[] = [];

    for (const raw of items) {
      const item = this.asRecord(raw);
      const title = this.normalizeText(item.title);
      if (!title) {
        warnings.push('Dropped keyNode because title is empty');
        continue;
      }

      const category = this.normalizeText(item.category) || '未分类';
      const dedupeKey = `${this.normalizeComparableText(category)}::${this.normalizeComparableText(title)}`;
      if (seen.has(dedupeKey)) {
        warnings.push(`Dropped duplicate keyNode: ${title}`);
        continue;
      }

      seen.add(dedupeKey);
      result.push({
        category,
        title,
        description: this.normalizeText(item.description),
        timelineRef: this.normalizeText(item.timelineRef),
      });
    }

    return result;
  }

  private normalizeSkeletonTopicItems(
    items: unknown[],
    topicMap: Map<string, SkeletonTopicMeta>,
    warnings: string[],
  ): { groups: SkeletonTopicItemGroupInput[]; weakItemCount: number } {
    const result: SkeletonTopicItemGroupInput[] = [];
    let weakItemCount = 0;

    for (const raw of items) {
      const group = this.asRecord(raw);
      const topicKey = this.normalizeText(group.topicKey).toLowerCase();
      if (!topicKey) {
        warnings.push('Dropped skeletonTopicItems group because topicKey is empty');
        continue;
      }
      if (!topicMap.has(topicKey)) {
        warnings.push(`Dropped skeletonTopicItems group because topicKey does not exist: ${topicKey}`);
        continue;
      }
      if (!Array.isArray(group.items)) {
        warnings.push(`Dropped skeletonTopicItems group because items is not an array: ${topicKey}`);
        continue;
      }

      const topicMeta = topicMap.get(topicKey);
      const normalizedItems: SkeletonTopicItemInput[] = [];
      for (const rawItem of group.items) {
        const item = this.asRecord(rawItem);
        const itemTitle = this.normalizeText(item.itemTitle);
        const content = this.normalizeText(item.content);
        const sourceRef = this.normalizeText(item.sourceRef);
        const contentJson = this.normalizeJsonValue(item.contentJson);

        if (!itemTitle && !content && !sourceRef && contentJson === null) {
          warnings.push(`Dropped empty skeleton item under topicKey ${topicKey}`);
          continue;
        }

        if (this.isWeakSkeletonTopicItem(itemTitle, content)) {
          weakItemCount += 1;
        }

        normalizedItems.push({
          itemTitle,
          content,
          contentJson,
          sourceRef,
        });
      }

      if (topicMeta) {
        const topicType = this.normalizeText(topicMeta.topicType).toLowerCase();
        if (topicType === 'list' && normalizedItems.length < 2) {
          warnings.push(
            `Skeleton topic ${topicKey} 是 list 类型，但当前仅输出 ${normalizedItems.length} 条 item，拆条粒度可能不足`,
          );
          weakItemCount += normalizedItems.length || 1;
        }

        if (
          topicType === 'text' &&
          normalizedItems.length > 0 &&
          normalizedItems.every((item) =>
            this.isWeakSkeletonTopicItem(item.itemTitle, item.content),
          )
        ) {
          warnings.push(
            `Skeleton topic ${topicKey} 是 text 类型，但当前内容仍偏空泛摘要，未明显围绕 topic 定义展开`,
          );
        }
      }

      result.push({ topicKey, items: normalizedItems });
    }

    return { groups: result, weakItemCount };
  }

  private normalizeExplosions(
    items: unknown[],
    warnings: string[],
  ): { items: ExplosionInput[]; weakCount: number } {
    const seen = new Set<string>();
    const result: ExplosionInput[] = [];
    let weakCount = 0;

    for (const raw of items) {
      const item = this.asRecord(raw);
      const explosionType = this.normalizeText(item.explosionType);
      const title = this.normalizeText(item.title);
      if (!explosionType || !title) {
        warnings.push('Dropped explosion because explosionType/title is empty');
        continue;
      }
      const dedupeKey = `${this.normalizeComparableText(explosionType)}::${this.normalizeComparableText(title)}`;
      if (seen.has(dedupeKey)) {
        warnings.push(`Dropped duplicate explosion: ${title}`);
        continue;
      }
      seen.add(dedupeKey);
      const dramaticQuality = this.normalizeText(item.dramaticQuality);
      const adaptability = this.normalizeText(item.adaptability);
      if (
        this.isWeakExplosionField(dramaticQuality) ||
        this.isWeakExplosionField(adaptability)
      ) {
        weakCount += 1;
        warnings.push(
          `Explosion "${title}" 的 dramaticQuality/adaptability 仍偏空泛，建议进一步强化短剧化表达`,
        );
      }
      result.push({
        explosionType,
        title,
        subtitle: this.normalizeText(item.subtitle),
        sceneRestoration: this.normalizeText(item.sceneRestoration),
        dramaticQuality,
        adaptability,
        timelineRef: this.normalizeText(item.timelineRef),
      });
    }

    return { items: result, weakCount };
  }

  private normalizeJsonValue(
    value: unknown,
  ): Record<string, unknown> | unknown[] | null {
    if (value === null || value === undefined || value === '') {
      return null;
    }
    if (Array.isArray(value)) {
      return value;
    }
    if (typeof value === 'object') {
      return value as Record<string, unknown>;
    }
    return null;
  }

  private asRecord(value: unknown): RowRecord {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return {};
    }
    return value as RowRecord;
  }

  private safeTrim(value: unknown): string {
    return this.normalizeText(value);
  }

  private previewText(value: unknown, maxLength = 80): string {
    const text = this.safeTrim(value);
    if (!text) return '';
    return text.length <= maxLength ? text : `${text.slice(0, maxLength)}...(truncated)`;
  }

  private getStringLength(value: unknown): number {
    return Array.from(this.safeTrim(value)).length;
  }

  private assertMaxLength(
    tableName: string,
    fieldName: string,
    value: unknown,
    max: number,
    itemIndex: number,
    context?: RowRecord,
  ): void {
    const text = this.safeTrim(value);
    const length = this.getStringLength(text);
    if (!text || length <= max) {
      return;
    }
    throw new BadRequestException(
      `写入 ${tableName} 失败：第 ${itemIndex + 1} 条记录的 ${fieldName} 长度为 ${length}，超过上限 ${max}${context ? `；上下文：${JSON.stringify(context)}` : ''}`,
    );
  }

  private truncateWithWarning(
    tableName: string,
    fieldName: string,
    value: unknown,
    max: number,
    itemIndex: number,
    warnings: string[],
  ): string {
    const text = this.safeTrim(value);
    if (!text) {
      return '';
    }
    const length = this.getStringLength(text);
    if (length <= max) {
      return text;
    }
    warnings.push(
      `写入 ${tableName} 前已截断：第 ${itemIndex + 1} 条记录的 ${fieldName} 长度为 ${length}，已截断到 ${max}`,
    );
    return text.slice(0, max);
  }

  private logRowFailure(
    tableName: string,
    itemIndex: number,
    context: RowRecord,
    error: unknown,
  ): void {
    this.logReviewStage(
      'insert row failed',
      {
        tableName,
        itemIndex,
        context,
        errorMessage: this.getErrorMessage(error),
      },
      'error',
    );
  }

  private formatPersistError(
    error: unknown,
    tableName: string,
    itemIndex?: number,
    context?: RowRecord,
  ): BadRequestException | InternalServerErrorException {
    const rawMessage = this.getErrorMessage(error);
    const itemPrefix =
      typeof itemIndex === 'number'
        ? `写入 ${tableName} 第 ${itemIndex + 1} 条记录失败：`
        : `写入 ${tableName} 失败：`;

    if (/Data too long for column/i.test(rawMessage)) {
      return new BadRequestException(`${itemPrefix}${rawMessage}`);
    }
    if (/Incorrect string value/i.test(rawMessage)) {
      return new BadRequestException(`${itemPrefix}存在数据库无法接受的字符内容。原始错误：${rawMessage}`);
    }
    if (/Cannot add or update a child row/i.test(rawMessage)) {
      return new BadRequestException(`${itemPrefix}外键映射失败。原始错误：${rawMessage}`);
    }
    if (/Invalid JSON text/i.test(rawMessage)) {
      return new BadRequestException(`${itemPrefix}content_json 不是合法 JSON。原始错误：${rawMessage}`);
    }

    return new InternalServerErrorException(
      `${itemPrefix}${rawMessage}${context ? `；上下文：${JSON.stringify(context)}` : ''}`,
    );
  }

  private logReviewStage(
    message: string,
    context?: Record<string, unknown>,
    level: 'log' | 'warn' | 'error' = 'log',
  ): void {
    const serialized = context ? ` ${this.safeJsonStringify(context)}` : '';
    console[level](`[pipeline:review] ${message}${serialized}`);
  }

  private safeJsonStringify(value: unknown): string {
    try {
      return JSON.stringify(value);
    } catch {
      return '[unserializable-context]';
    }
  }

  private getErrorMessage(error: unknown): string {
    if (error instanceof Error) {
      return error.message;
    }
    return String(error);
  }

  private async selectByNovel(
    tableName: string,
    alias: string,
    novelId: number,
    options?: { orderBy?: string },
  ): Promise<RowRecord[]> {
    if (!(await this.hasTable(tableName))) {
      return [];
    }

    const qb = this.dataSource
      .createQueryBuilder()
      .select(`${alias}.*`)
      .from(tableName, alias)
      .where(`${alias}.novel_id = :novelId`, { novelId });

    if (options?.orderBy) {
      qb.orderBy(options.orderBy, 'ASC');
    }

    return qb.getRawMany();
  }

  private async getNovelBaseInfo(novelId: number): Promise<RowRecord | null> {
    const rows = await this.dataSource.query(
      `
      SELECT novels_name, description, total_chapters, power_up_interval, author
      FROM drama_novels
      WHERE id = ?
      LIMIT 1
      `,
      [novelId],
    );
    return rows[0] ?? null;
  }

  private async getSourceTextBlock(novelId: number): Promise<string> {
    if (!(await this.hasTable('drama_source_text'))) {
      return '';
    }

    const rows = await this.dataSource.query(
      `
      SELECT source_text AS sourceText
      FROM drama_source_text
      WHERE novels_id = ?
      ORDER BY update_time DESC, id DESC
      `,
      [novelId],
    );

    if (!rows.length) {
      return '';
    }

    const parts: string[] = ['【背景原始资料】'];
    let totalLength = 0;
    for (const [index, row] of rows.entries()) {
      const text = this.normalizeText(row.sourceText);
      if (!text) continue;
      const remaining = 15000 - totalLength;
      if (remaining <= 0) break;
      const truncated = this.trimBlock(text, Math.min(remaining, 5000));
      parts.push(`--- 原始资料 ${index + 1} ---`);
      parts.push(truncated);
      totalLength += truncated.length;
    }

    return parts.join('\n');
  }

  private async getLatestAdaptationStrategy(novelId: number): Promise<RowRecord | null> {
    if (!(await this.hasTable('novel_adaptation_strategy'))) {
      return null;
    }

    const rows = await this.dataSource.query(
      `
      SELECT mode_id, strategy_title, strategy_description, ai_prompt_template, version
      FROM novel_adaptation_strategy
      WHERE novel_id = ?
      ORDER BY version DESC, updated_at DESC, id DESC
      LIMIT 1
      `,
      [novelId],
    );
    return rows[0] ?? null;
  }

  private async getAdaptationMode(modeId: number): Promise<RowRecord | null> {
    if (!(await this.hasTable('adaptation_modes'))) {
      return null;
    }

    const rows = await this.dataSource.query(
      `
      SELECT mode_key, mode_name, description
      FROM adaptation_modes
      WHERE id = ?
      LIMIT 1
      `,
      [modeId],
    );
    return rows[0] ?? null;
  }

  private async getActiveSetCore(novelId: number): Promise<RowRecord | null> {
    if (!(await this.hasTable('set_core'))) {
      return null;
    }

    const rows = await this.dataSource.query(
      `
      SELECT title, core_text, protagonist_name, protagonist_identity, target_story, rewrite_goal, constraint_text
      FROM set_core
      WHERE novel_id = ? AND is_active = 1
      ORDER BY version DESC, id DESC
      LIMIT 1
      `,
      [novelId],
    );
    return rows[0] ?? null;
  }

  private async listEnabledSkeletonTopics(novelId: number): Promise<RowRecord[]> {
    if (!(await this.hasTable('novel_skeleton_topics'))) {
      return [];
    }

    return this.dataSource.query(
      `
      SELECT id, topic_key, topic_name, topic_type, description, sort_order, is_enabled
      FROM novel_skeleton_topics
      WHERE novel_id = ? AND is_enabled = 1
      ORDER BY sort_order ASC, id ASC
      `,
      [novelId],
    );
  }

  private async getEnabledSkeletonTopicMap(
    novelId: number,
  ): Promise<Map<string, SkeletonTopicMeta>> {
    const rows = await this.listEnabledSkeletonTopics(novelId);
    const topicMap = new Map<string, SkeletonTopicMeta>();
    for (const row of rows) {
      const topicKey = this.normalizeText(row.topic_key).toLowerCase();
      if (!topicKey) continue;
      topicMap.set(topicKey, {
        id: Number(row.id),
        topicKey,
        topicName: this.normalizeText(row.topic_name),
        topicType: this.normalizeText(row.topic_type),
        description: this.normalizeText(row.description),
      });
    }
    return topicMap;
  }

  private normalizeCharacterNameAndDescription(
    rawName: unknown,
    rawDescription: unknown,
  ): { name: string; description: string; aliasNormalized: boolean } {
    const name = this.normalizeText(rawName);
    const description = this.normalizeText(rawDescription);
    if (!/[\/／]/.test(name)) {
      return { name, description, aliasNormalized: false };
    }

    const parts = name
      .split(/[\/／]/)
      .map((item) => item.trim())
      .filter(Boolean);
    if (!parts.length) {
      return { name: '', description, aliasNormalized: false };
    }

    const [primaryName, ...aliases] = parts;
    const uniqueAliases = [...new Set(aliases.filter((alias) => alias !== primaryName))];
    if (!uniqueAliases.length) {
      return { name: primaryName, description, aliasNormalized: true };
    }

    const aliasPrefix = `别名：${uniqueAliases.join('、')}。`;
    return {
      name: primaryName,
      description: description.startsWith(aliasPrefix)
        ? description
        : `${aliasPrefix}${description}`.trim(),
      aliasNormalized: true,
    };
  }

  private isWeakSkeletonTopicItem(itemTitle: string, content: string): boolean {
    const genericTitlePattern =
      /^(过程|阶段|原因|结论|内容|条目|项目|分析)[一二三四五六七八九十0-9]*$/;
    if (itemTitle && genericTitlePattern.test(itemTitle)) {
      return true;
    }
    return this.normalizeText(content).length > 0 && this.normalizeText(content).length < 30;
  }

  private isWeakExplosionField(value: string): boolean {
    const text = this.normalizeText(value);
    if (!text || text.length < 12) {
      return true;
    }
    const genericPhrases = [
      '很有戏剧性',
      '戏剧性很强',
      '适合短剧',
      '适合改编',
      '冲突强',
      '有爽点',
      '有反转',
    ];
    return genericPhrases.some((phrase) => text === phrase);
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

  private async callLcAiApi(
    modelKey: string,
    promptPreview: string,
  ): Promise<Record<string, unknown>> {
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
        temperature: 0.3,
        messages: [
          {
            role: 'system',
            content:
              '你是短剧 Pipeline 二次AI自检助手。你必须输出严格 JSON，不要输出 markdown，不要输出解释。',
          },
          { role: 'user', content: promptPreview },
        ],
      }),
    });

    const contentType = response.headers.get('content-type') || '';
    const rawText = await response.text();

    if (this.isHtmlResponse(contentType, rawText)) {
      throw new BadRequestException(
        `Pipeline second review request reached an HTML page instead of JSON API. endpoint=${endpoint}, status=${response.status}, contentType=${contentType}, body=${this.summarizeBody(rawText)}`,
      );
    }
    if (!response.ok) {
      throw new BadRequestException(
        `Pipeline second review request failed. endpoint=${endpoint}, status=${response.status}, contentType=${contentType}, body=${this.summarizeBody(rawText)}`,
      );
    }

    let payload: any;
    try {
      payload = JSON.parse(rawText);
    } catch {
      throw new BadRequestException(
        `Pipeline second review response is not valid JSON. endpoint=${endpoint}, status=${response.status}, contentType=${contentType}, body=${this.summarizeBody(rawText)}`,
      );
    }

    const content = this.extractAiText(payload);
    if (!content) {
      throw new BadRequestException(
        'Pipeline second review response does not contain usable text content',
      );
    }

    return this.parseJsonObjectFromText(content);
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
        const candidate = trimmed.slice(start, end + 1);
        return this.parsePossiblyDirtyJson(candidate);
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
        // Try next candidate.
      }
    }
    throw new BadRequestException(
      `Pipeline second review content is not valid JSON: ${text.slice(0, 500)}`,
    );
  }

  private stripMarkdownCodeFence(text: string): string {
    return text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  }

  private normalizeJsonLikeText(text: string): string {
    return text
      .replace(/[\u2018\u2019]/g, "'")
      .replace(/[\u201C\u201D]/g, '"')
      .replace(/^\uFEFF/, '')
      .replace(/,\s*([}\]])/g, '$1')
      .replace(/([{,]\s*)([A-Za-z0-9_]+)\s*:/g, '$1"$2":')
      .replace(/:\s*'([^']*)'/g, ': "$1"');
  }

  private isHtmlResponse(contentType: string, rawText: string): boolean {
    const trimmed = rawText.trimStart();
    return (
      contentType.toLowerCase().includes('text/html') ||
      trimmed.startsWith('<!DOCTYPE html') ||
      trimmed.startsWith('<html')
    );
  }

  private summarizeBody(rawText: string, maxLength = 400): string {
    const normalized = rawText.replace(/\s+/g, ' ').trim();
    return normalized.length <= maxLength
      ? normalized
      : `${normalized.slice(0, maxLength)}...(truncated)`;
  }

  private trimBlock(value: unknown, maxLength: number): string {
    const text = this.normalizeText(value);
    if (!text) return '';
    return text.length <= maxLength ? text : `${text.slice(0, maxLength)}...(截断)`;
  }

  private normalizeText(value: unknown): string {
    return typeof value === 'string' ? value.trim() : '';
  }

  private normalizeComparableText(value: unknown): string {
    return this.normalizeText(value).toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '');
  }

  private async hasTable(tableName: string): Promise<boolean> {
    const rows = await this.dataSource.query(
      `
      SELECT 1
      FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?
      LIMIT 1
      `,
      [tableName],
    );
    return rows.length > 0;
  }

  private async assertNovelExists(
    novelId: number,
    manager: EntityManager = this.dataSource.manager,
  ): Promise<void> {
    const rows = await manager.query(`SELECT id FROM drama_novels WHERE id = ? LIMIT 1`, [
      novelId,
    ]);
    if (!rows.length) {
      throw new NotFoundException(`Novel ${novelId} not found`);
    }
  }
}
