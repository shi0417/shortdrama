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
  table: string;
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
  action: string;
  reason: string;
  beforeSummary: string;
  afterSummary: string;
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
    const { normalized, warnings } = this.validateAndNormalizeReviewResult(
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

    const summary = await this.persistReviewedData(
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
      '【自检规则】',
      '1. 对于未被选中的 targetTables，请返回空数组，不要输出新内容。',
      '2. 对于被选中的 targetTables，请输出修正后的完整数组，后端会覆盖写回所选表。',
      '3. timelines 要检查顺序、缺漏、重复。',
      '4. characters 要检查核心人物补漏、去重、阵营统一。',
      '5. keyNodes 要检查是否覆盖关键阶段、标题是否重复。',
      '6. skeletonTopicItems 必须严格围绕系统提供的 topic 定义，不允许泛泛复述 source_text。',
      '7. explosions 要更像短剧爆点，而不是普通摘要。',
      '8. reviewNotes 用于说明本次发现的问题与修正动作。',
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
      '    { "table": "字符串", "issue": "字符串", "fix": "字符串" }',
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
    topicMap: Map<string, { id: number; topicKey: string }>,
    targetTables: PipelineSecondReviewTargetTable[],
  ): { normalized: PipelineReviewAiResult; warnings: string[] } {
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
    const characters = this.normalizeCharacters(aiJson.characters as unknown[], warnings);
    const keyNodes = this.normalizeKeyNodes(aiJson.keyNodes as unknown[], warnings);
    const skeletonTopicItems = this.normalizeSkeletonTopicItems(
      aiJson.skeletonTopicItems as unknown[],
      topicMap,
      warnings,
    );
    const explosions = this.normalizeExplosions(aiJson.explosions as unknown[], warnings);
    const reviewNotes = this.normalizeReviewNotes(
      Array.isArray(aiJson.reviewNotes) ? (aiJson.reviewNotes as unknown[]) : [],
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
    };
  }

  private normalizeReviewNotes(
    items: unknown[],
    targetTables: PipelineSecondReviewTargetTable[],
    warnings: string[],
  ): ReviewNoteInput[] {
    const allowed = new Set<string>(targetTables);
    const result: ReviewNoteInput[] = [];

    for (const raw of items) {
      const item = this.asRecord(raw);
      const table = this.normalizeText(item.table);
      const issue = this.normalizeText(item.issue);
      const fix = this.normalizeText(item.fix);

      if (!table || !issue || !fix) {
        warnings.push('Dropped reviewNote because table/issue/fix is empty');
        continue;
      }

      if (!allowed.has(table)) {
        warnings.push(`Dropped reviewNote because table is not selected: ${table}`);
        continue;
      }

      result.push({ table, issue, fix });
    }

    return result;
  }

  private async persistReviewedData(
    novelId: number,
    targetTables: PipelineSecondReviewTargetTable[],
    result: PipelineReviewAiResult,
    topicMap: Map<string, { id: number; topicKey: string }>,
    revisionNotesByTable: Map<PipelineSecondReviewTargetTable, RevisionNoteEntry[]>,
    warnings: string[],
  ): Promise<PipelineSecondReviewResponse['summary']> {
    this.logReviewStage('transaction start', { novelId, targetTables });

    try {
      const summary = await this.dataSource.transaction(async (manager) => {
        await this.deleteSelectedData(novelId, targetTables, manager);

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
            )
          : await this.loadExistingTimelines(novelId, manager);
        const timelineLookup = this.buildTimelineLookup(insertedTimelines);

        const insertedCharacters = shouldWriteCharacters
          ? await this.insertCharacters(
              novelId,
              result.characters,
              manager,
              revisionNotesByTable.get('novel_characters') ?? null,
            )
          : 0;

        const insertedKeyNodes = shouldWriteKeyNodes
          ? await this.insertKeyNodes(
              novelId,
              result.keyNodes,
              timelineLookup,
              manager,
              revisionNotesByTable.get('novel_key_nodes') ?? null,
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
            )
          : 0;

        return {
          timelines: shouldWriteTimelines ? result.timelines.length : 0,
          characters: insertedCharacters,
          keyNodes: insertedKeyNodes,
          skeletonTopicItems: insertedSkeletonTopicItems,
          explosions: insertedExplosions,
        };
      });

      this.logReviewStage('transaction commit', { novelId, summary });
      return summary;
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
            revisionNotes?.length ? JSON.stringify(revisionNotes) : null,
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
            revisionNotes?.length ? JSON.stringify(revisionNotes) : null,
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
            revisionNotes?.length ? JSON.stringify(revisionNotes) : null,
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
    topicMap: Map<string, { id: number; topicKey: string }>,
    manager: EntityManager,
    warnings: string[],
    revisionNotes: RevisionNoteEntry[] | null,
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
              revisionNotes?.length ? JSON.stringify(revisionNotes) : null,
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
            revisionNotes?.length ? JSON.stringify(revisionNotes) : null,
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
                action: 'reviewed',
                reason: 'AI second review executed',
                beforeSummary: 'Existing generated result reviewed',
                afterSummary: 'Result rewritten during the current review batch',
              },
            ],
      );
    }

    return result;
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

  private normalizeCharacters(items: unknown[], warnings: string[]): CharacterInput[] {
    const seen = new Set<string>();
    const result: CharacterInput[] = [];

    for (const raw of items) {
      const item = this.asRecord(raw);
      const name = this.normalizeText(item.name);
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
      result.push({
        name,
        faction: this.normalizeText(item.faction),
        description: this.normalizeText(item.description),
        personality: this.normalizeText(item.personality),
        settingWords: this.normalizeText(item.settingWords),
      });
    }

    return result;
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
    topicMap: Map<string, { id: number; topicKey: string }>,
    warnings: string[],
  ): SkeletonTopicItemGroupInput[] {
    const result: SkeletonTopicItemGroupInput[] = [];

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

        normalizedItems.push({
          itemTitle,
          content,
          contentJson,
          sourceRef,
        });
      }

      result.push({ topicKey, items: normalizedItems });
    }

    return result;
  }

  private normalizeExplosions(items: unknown[], warnings: string[]): ExplosionInput[] {
    const seen = new Set<string>();
    const result: ExplosionInput[] = [];

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
      result.push({
        explosionType,
        title,
        subtitle: this.normalizeText(item.subtitle),
        sceneRestoration: this.normalizeText(item.sceneRestoration),
        dramaticQuality: this.normalizeText(item.dramaticQuality),
        adaptability: this.normalizeText(item.adaptability),
        timelineRef: this.normalizeText(item.timelineRef),
      });
    }

    return result;
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
  ): Promise<Map<string, { id: number; topicKey: string }>> {
    const rows = await this.listEnabledSkeletonTopics(novelId);
    const topicMap = new Map<string, { id: number; topicKey: string }>();
    for (const row of rows) {
      const topicKey = this.normalizeText(row.topic_key).toLowerCase();
      if (!topicKey) continue;
      topicMap.set(topicKey, { id: Number(row.id), topicKey });
    }
    return topicMap;
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
