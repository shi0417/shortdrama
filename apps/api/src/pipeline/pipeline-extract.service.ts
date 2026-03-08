import {
  BadRequestException,
  HttpException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { DataSource, EntityManager, QueryFailedError } from 'typeorm';
import {
  PipelineExtractDto,
  PipelineExtractReferenceTable,
} from './dto/pipeline-extract.dto';

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

type PipelineExtractAiResult = {
  timelines: TimelineInput[];
  characters: CharacterInput[];
  keyNodes: KeyNodeInput[];
  skeletonTopicItems: SkeletonTopicItemGroupInput[];
  explosions: ExplosionInput[];
};

type PipelineExtractPromptPreviewResponse = {
  promptPreview: string;
  usedModelKey: string;
  referenceTables: PipelineExtractReferenceTable[];
};

type PipelineExtractCommitResponse = {
  ok: true;
  summary: {
    timelines: number;
    characters: number;
    keyNodes: number;
    skeletonTopicItems: number;
    explosions: number;
  };
  warnings?: string[];
  details?: {
    enabledTopicCount: number;
    enabledTopicKeys: string[];
    normalizedCounts: {
      timelines: number;
      characters: number;
      keyNodes: number;
      skeletonTopicItems: number;
      explosions: number;
    };
    skeletonTopicItemsRequestedGroups: number;
    skeletonTopicItemsRequestedItems: number;
    skeletonTopicItemsInserted: number;
    skeletonTopicItemsDropped: number;
  };
};

type TimelineInsertRow = {
  id: number;
  timeNode: string;
  event: string;
};

type PipelineExtractDiagnostics = PipelineExtractCommitResponse['details'];

const DEFAULT_REFERENCE_TABLES: PipelineExtractReferenceTable[] = [
  'drama_novels',
  'drama_source_text',
  'novel_adaptation_strategy',
  'adaptation_modes',
  'set_core',
];

@Injectable()
export class PipelineExtractService {
  constructor(private readonly dataSource: DataSource) {}

  async previewPrompt(
    novelId: number,
    dto: PipelineExtractDto,
  ): Promise<PipelineExtractPromptPreviewResponse> {
    await this.assertNovelExists(novelId);
    const usedModelKey = await this.resolveModelKey(dto.modelKey);
    const referenceTables = this.resolveReferenceTables(dto.referenceTables);
    const promptPreview = await this.buildPrompt(
      novelId,
      referenceTables,
      dto.userInstruction,
    );

    return {
      promptPreview,
      usedModelKey,
      referenceTables,
    };
  }

  async extractAndGenerate(
    novelId: number,
    dto: PipelineExtractDto,
  ): Promise<PipelineExtractCommitResponse> {
    await this.assertNovelExists(novelId);
    const usedModelKey = await this.resolveModelKey(dto.modelKey);
    const referenceTables = this.resolveReferenceTables(dto.referenceTables);
    const promptPreview =
      dto.allowPromptEdit && dto.promptOverride?.trim()
        ? dto.promptOverride.trim()
        : await this.buildPrompt(novelId, referenceTables, dto.userInstruction);

    this.logExtractStage('request start', {
      novelId,
      modelKey: usedModelKey,
      referenceTables,
      promptLength: promptPreview.length,
    });

    const aiJson = await this.callLcAiApi(usedModelKey, promptPreview);
    const topicMap = await this.getEnabledSkeletonTopicMap(novelId);
    const diagnostics: PipelineExtractDiagnostics = {
      enabledTopicCount: topicMap.size,
      enabledTopicKeys: [...topicMap.keys()],
      normalizedCounts: {
        timelines: 0,
        characters: 0,
        keyNodes: 0,
        skeletonTopicItems: 0,
        explosions: 0,
      },
      skeletonTopicItemsRequestedGroups: 0,
      skeletonTopicItemsRequestedItems: 0,
      skeletonTopicItemsInserted: 0,
      skeletonTopicItemsDropped: 0,
    };

    this.logExtractStage('enabled skeleton topics loaded', {
      novelId,
      enabledTopicCount: diagnostics.enabledTopicCount,
      topicKeys: diagnostics.enabledTopicKeys,
    });

    const { normalized, warnings } = this.validateAndNormalizeAiResult(
      aiJson,
      topicMap,
      diagnostics,
    );
    this.logExtractStage('ai normalized counts', {
      novelId,
      ...diagnostics.normalizedCounts,
      skeletonTopicItemsRequestedGroups: diagnostics.skeletonTopicItemsRequestedGroups,
      skeletonTopicItemsRequestedItems: diagnostics.skeletonTopicItemsRequestedItems,
    });

    const summary = await this.persistGeneratedData(
      novelId,
      normalized,
      topicMap,
      warnings,
      diagnostics,
    );
    diagnostics.skeletonTopicItemsInserted = summary.skeletonTopicItems;
    diagnostics.skeletonTopicItemsDropped = Math.max(
      0,
      diagnostics.skeletonTopicItemsRequestedItems - summary.skeletonTopicItems,
    );

    if (
      diagnostics.skeletonTopicItemsRequestedGroups > 0 &&
      diagnostics.skeletonTopicItemsInserted === 0
    ) {
      warnings.push(
        `AI 返回了 ${diagnostics.skeletonTopicItemsRequestedGroups} 个 skeletonTopicItems 分组，但最终未写入任何 topic items。请检查 topicKey 是否与启用主题完全匹配。`,
      );
    }

    return {
      ok: true,
      summary,
      warnings: warnings.length ? warnings : undefined,
      details: diagnostics,
    };
  }

  private resolveReferenceTables(
    referenceTables?: PipelineExtractReferenceTable[],
  ): PipelineExtractReferenceTable[] {
    if (!referenceTables?.length) {
      return DEFAULT_REFERENCE_TABLES;
    }
    return referenceTables;
  }

  private async resolveModelKey(modelKey: string): Promise<string> {
    const normalized = this.normalizeText(modelKey);
    if (!normalized) {
      throw new BadRequestException('modelKey is required');
    }

    const rows = await this.dataSource.query(
      `
      SELECT model_key AS modelKey
      FROM ai_model_catalog
      WHERE is_active = 1 AND model_key = ?
      LIMIT 1
      `,
      [normalized],
    );

    if (!rows.length) {
      throw new BadRequestException(`AI model ${normalized} is not available`);
    }

    return normalized;
  }

  private async buildPrompt(
    novelId: number,
    referenceTables: PipelineExtractReferenceTable[],
    userInstruction?: string,
  ): Promise<string> {
    const referenceBlocks = await this.buildReferenceBlocks(novelId, referenceTables);
    const skeletonTopicsBlock = await this.buildSkeletonTopicDefinitionBlock(novelId);
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
      '  ]',
      '}',
    ].join('\n');

    const taskBlock = [
      '【任务目标】',
      '你现在要为当前短剧项目抽取并整理五类结果：时间线、人物、关键节点、骨架主题内容、爆点。',
      '这些结果会直接覆盖写入数据库，因此必须结构稳定、内容准确、尽量克制胡编。',
      '',
      '【强约束】',
      '1. 你必须输出严格 JSON，不要输出 markdown，不要输出解释。',
      '2. 顶层必须且只能包含：timelines、characters、keyNodes、skeletonTopicItems、explosions。',
      '3. 所有顶层字段都必须是数组，即使没有内容也必须返回空数组。',
      '4. 不允许返回数据库 id。',
      '5. 不允许新增 novel_skeleton_topics；你只能针对系统提供的 topicKey 产出 skeletonTopicItems。',
      '6. 若资料不足，请返回空数组或空内容，不要编造过强结论。',
      '',
      '【质量要求】',
      '1. 时间线要按历史发展顺序组织，突出阶段变化与关键事件。',
      '2. 人物要覆盖关键阵营与关键角色，至少给出角色身份与作用。',
      '3. 关键节点尽量覆盖战前博弈、战争进程、战后收尾；category 可使用这些语义。',
      '4. 爆点要偏短剧戏剧性、冲突性与可改编性，避免泛泛描述。',
      '5. 骨架主题 items 必须严格围绕每个 topic 的定义要求。',
      '',
      '【字段要求】',
      '- timelines[].timeNode / timelines[].event 必须非空。',
      '- characters[].name 必须非空。',
      '- keyNodes[].title 必须非空；category 尽量填写明确分类。',
      '- skeletonTopicItems[].topicKey 必须与给定 topicKey 完全一致；items 可以为空数组。',
      '- explosions[].explosionType / explosions[].title 必须非空。',
      '',
      '【禁止项】',
      '- 不要新增 schema 外字段。',
      '- 不要输出注释或解释。',
      '- 不要输出 topicKey 之外的骨架主题定义。',
    ].join('\n');

    return [
      '【System Prompt】',
      '你是短剧 Pipeline 数据抽取助手，负责把素材整理成稳定的结构化 JSON。',
      '',
      taskBlock,
      '',
      referenceBlocks || '【参考资料】\n无',
      '',
      skeletonTopicsBlock,
      '',
      userInstructionBlock,
      '',
      schemaBlock,
    ].join('\n');
  }

  private async buildReferenceBlocks(
    novelId: number,
    referenceTables: PipelineExtractReferenceTable[],
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
    const topics = await this.listEnabledSkeletonTopics(novelId);

    if (!topics.length) {
      return [
        '【系统预定义骨架主题】',
        '当前项目没有启用的 novel_skeleton_topics。',
        '因此 skeletonTopicItems 必须返回空数组。',
      ].join('\n');
    }

    return [
      '【系统预定义骨架主题】',
      '以下是系统已存在且启用的 topic 定义。你只能对这些 topicKey 产出 skeletonTopicItems，不允许新增 topic。',
      ...topics.map(
        (topic) =>
          `- topicKey=${topic.topic_key} | topicName=${topic.topic_name} | topicType=${topic.topic_type} | description=${topic.description ?? ''}`,
      ),
    ].join('\n');
  }

  private async persistGeneratedData(
    novelId: number,
    result: PipelineExtractAiResult,
    topicMap: Map<string, { id: number; topicKey: string }>,
    warnings: string[],
    diagnostics: PipelineExtractDiagnostics,
  ): Promise<PipelineExtractCommitResponse['summary']> {
    this.logExtractStage('transaction start', { novelId });

    try {
      const summary = await this.dataSource.transaction(async (manager) => {
        this.logExtractStage('delete existing start', { novelId });
        await this.deleteExistingData(novelId, manager);
        this.logExtractStage('delete existing done', { novelId });

        this.logExtractStage('insert timelines start', {
          novelId,
          count: result.timelines.length,
        });
        const insertedTimelines = await this.insertTimelines(
          novelId,
          result.timelines,
          manager,
        );
        this.logExtractStage('insert timelines done', {
          novelId,
          count: insertedTimelines.length,
        });

        const timelineLookup = this.buildTimelineLookup(insertedTimelines);

        this.logExtractStage('insert characters start', {
          novelId,
          count: result.characters.length,
        });
        const insertedCharacters = await this.insertCharacters(
          novelId,
          result.characters,
          manager,
        );
        this.logExtractStage('insert characters done', {
          novelId,
          count: insertedCharacters,
        });

        this.logExtractStage('insert keyNodes start', {
          novelId,
          count: result.keyNodes.length,
        });
        const insertedKeyNodes = await this.insertKeyNodes(
          novelId,
          result.keyNodes,
          timelineLookup,
          manager,
        );
        this.logExtractStage('insert keyNodes done', {
          novelId,
          count: insertedKeyNodes,
        });

        this.logExtractStage('insert skeletonTopicItems start', {
          novelId,
          groupCount: result.skeletonTopicItems.length,
          requestedItemCount: diagnostics?.skeletonTopicItemsRequestedItems ?? 0,
          enabledTopicKeys: [...topicMap.keys()],
        });
        const insertedSkeletonTopicItems = await this.insertSkeletonTopicItems(
          novelId,
          result.skeletonTopicItems,
          topicMap,
          manager,
          warnings,
        );
        this.logExtractStage('insert skeletonTopicItems done', {
          novelId,
          count: insertedSkeletonTopicItems,
        });

        this.logExtractStage('insert explosions start', {
          novelId,
          count: result.explosions.length,
        });
        const insertedExplosions = await this.insertExplosions(
          novelId,
          result.explosions,
          timelineLookup,
          manager,
          warnings,
        );
        this.logExtractStage('insert explosions done', {
          novelId,
          count: insertedExplosions,
        });

        return {
          timelines: insertedTimelines.length,
          characters: insertedCharacters,
          keyNodes: insertedKeyNodes,
          skeletonTopicItems: insertedSkeletonTopicItems,
          explosions: insertedExplosions,
        };
      });

      this.logExtractStage('transaction commit', {
        novelId,
        summary,
      });
      return summary;
    } catch (error) {
      this.logExtractStage(
        'transaction rollback',
        {
          novelId,
          errorMessage: this.getErrorMessage(error),
        },
        'error',
      );
      throw error;
    }
  }

  private async deleteExistingData(
    novelId: number,
    manager: EntityManager,
  ): Promise<void> {
    await manager.query(`DELETE FROM novel_key_nodes WHERE novel_id = ?`, [novelId]);
    await manager.query(`DELETE FROM novel_explosions WHERE novel_id = ?`, [novelId]);
    await manager.query(`DELETE FROM novel_skeleton_topic_items WHERE novel_id = ?`, [novelId]);
    await manager.query(`DELETE FROM novel_characters WHERE novel_id = ?`, [novelId]);
    await manager.query(`DELETE FROM novel_timelines WHERE novel_id = ?`, [novelId]);
  }

  private async insertTimelines(
    novelId: number,
    timelines: TimelineInput[],
    manager: EntityManager,
  ): Promise<TimelineInsertRow[]> {
    const inserted: TimelineInsertRow[] = [];

    for (const [index, item] of timelines.entries()) {
      this.assertMaxLength('novel_timelines', 'time_node', item.timeNode, 100, index, {
        timeNodePreview: this.previewText(item.timeNode),
        eventPreview: this.previewText(item.event),
      });

      try {
        const insertResult: any = await manager.query(
          `
          INSERT INTO novel_timelines (novel_id, time_node, event, sort_order)
          VALUES (?, ?, ?, ?)
          `,
          [novelId, item.timeNode, item.event, index],
        );

        inserted.push({
          id: Number(insertResult.insertId),
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
  ): Promise<number> {
    for (const [index, item] of characters.entries()) {
      this.assertMaxLength('novel_characters', 'name', item.name, 100, index, {
        namePreview: this.previewText(item.name),
      });
      this.assertMaxLength('novel_characters', 'faction', item.faction, 50, index, {
        namePreview: this.previewText(item.name),
        factionPreview: this.previewText(item.faction),
      });

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
            sort_order
          ) VALUES (?, ?, ?, ?, ?, ?, ?)
          `,
          [
            novelId,
            item.name,
            item.faction || null,
            item.description || null,
            item.personality || null,
            item.settingWords || null,
            index,
          ],
        );
      } catch (error) {
        const context = {
          namePreview: this.previewText(item.name),
          factionPreview: this.previewText(item.faction),
          nameLength: this.getStringLength(item.name),
          factionLength: this.getStringLength(item.faction),
          descriptionLength: this.getStringLength(item.description),
          personalityLength: this.getStringLength(item.personality),
          settingWordsLength: this.getStringLength(item.settingWords),
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
  ): Promise<number> {
    for (const [index, item] of keyNodes.entries()) {
      const category = item.category || '未分类';
      this.assertMaxLength('novel_key_nodes', 'category', category, 50, index, {
        titlePreview: this.previewText(item.title),
      });
      this.assertMaxLength('novel_key_nodes', 'title', item.title, 255, index, {
        titlePreview: this.previewText(item.title),
        categoryPreview: this.previewText(category),
      });

      try {
        await manager.query(
          `
          INSERT INTO novel_key_nodes (
            novel_id,
            timeline_id,
            category,
            title,
            description,
            sort_order
          ) VALUES (?, ?, ?, ?, ?, ?)
          `,
          [
            novelId,
            this.resolveTimelineId(item.timelineRef, timelineLookup),
            category,
            item.title,
            item.description || null,
            index,
          ],
        );
      } catch (error) {
        const context = {
          titlePreview: this.previewText(item.title),
          categoryPreview: this.previewText(category),
          titleLength: this.getStringLength(item.title),
          categoryLength: this.getStringLength(category),
          descriptionLength: this.getStringLength(item.description),
          timelineRefPreview: this.previewText(item.timelineRef),
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
  ): Promise<number> {
    let total = 0;

    for (const group of groups) {
      const topic = topicMap.get(group.topicKey);
      if (!topic) {
        const message = `Skipped skeletonTopicItems insert because topicKey is missing in topicMap: ${group.topicKey}`;
        warnings.push(message);
        this.logExtractStage(
          'skeleton topic insert miss',
          { topicKey: group.topicKey, enabledTopicKeys: [...topicMap.keys()] },
          'warn',
        );
        continue;
      }

      this.logExtractStage('skeleton topic insert hit', {
        topicKey: group.topicKey,
        topicId: topic.id,
        itemCount: group.items.length,
      });

      for (const [index, item] of group.items.entries()) {
        const itemTitle = this.truncateWithWarning(
          'novel_skeleton_topic_items',
          'item_title',
          item.itemTitle,
          255,
          index,
          warnings,
          {
            topicKey: group.topicKey,
            topicId: topic.id,
          },
        );
        const sourceRef = this.truncateWithWarning(
          'novel_skeleton_topic_items',
          'source_ref',
          item.sourceRef,
          255,
          index,
          warnings,
          {
            topicKey: group.topicKey,
            topicId: topic.id,
          },
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
              source_ref
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
            `,
            [
              novelId,
              topic.id,
              itemTitle || null,
              item.content || null,
              item.contentJson === null ? null : JSON.stringify(item.contentJson),
              index,
              sourceRef || null,
            ],
          );
          total += 1;
        } catch (error) {
          const context = {
            topicKey: group.topicKey,
            topicId: topic.id,
            itemTitlePreview: this.previewText(itemTitle),
            sourceRefPreview: this.previewText(sourceRef),
            itemTitleLength: this.getStringLength(itemTitle),
            sourceRefLength: this.getStringLength(sourceRef),
            contentLength: this.getStringLength(item.content),
            hasContentJson: item.contentJson !== null,
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
  ): Promise<number> {
    for (const [index, item] of explosions.entries()) {
      this.assertMaxLength('novel_explosions', 'explosion_type', item.explosionType, 50, index, {
        titlePreview: this.previewText(item.title),
      });
      this.assertMaxLength('novel_explosions', 'title', item.title, 255, index, {
        explosionTypePreview: this.previewText(item.explosionType),
        titlePreview: this.previewText(item.title),
      });
      const subtitle = this.truncateWithWarning(
        'novel_explosions',
        'subtitle',
        item.subtitle,
        255,
        index,
        warnings,
        {
          explosionTypePreview: this.previewText(item.explosionType),
          titlePreview: this.previewText(item.title),
        },
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
            sort_order
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
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
          ],
        );
      } catch (error) {
        const context = {
          explosionTypePreview: this.previewText(item.explosionType),
          titlePreview: this.previewText(item.title),
          subtitlePreview: this.previewText(subtitle),
          explosionTypeLength: this.getStringLength(item.explosionType),
          titleLength: this.getStringLength(item.title),
          subtitleLength: this.getStringLength(subtitle),
          sceneRestorationLength: this.getStringLength(item.sceneRestoration),
          dramaticQualityLength: this.getStringLength(item.dramaticQuality),
          adaptabilityLength: this.getStringLength(item.adaptability),
        };
        this.logRowFailure('novel_explosions', index, context, error);
        throw this.formatPersistError(error, 'novel_explosions', index, context);
      }
    }

    return explosions.length;
  }

  private buildTimelineLookup(rows: TimelineInsertRow[]): Map<string, number> {
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

  private validateAndNormalizeAiResult(
    aiJson: Record<string, unknown>,
    topicMap: Map<string, { id: number; topicKey: string }>,
    diagnostics: PipelineExtractDiagnostics,
  ): { normalized: PipelineExtractAiResult; warnings: string[] } {
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

    this.logExtractStage('ai raw array counts', {
      timelines: Array.isArray(aiJson.timelines) ? aiJson.timelines.length : -1,
      characters: Array.isArray(aiJson.characters) ? aiJson.characters.length : -1,
      keyNodes: Array.isArray(aiJson.keyNodes) ? aiJson.keyNodes.length : -1,
      skeletonTopicItems: Array.isArray(aiJson.skeletonTopicItems)
        ? aiJson.skeletonTopicItems.length
        : -1,
      explosions: Array.isArray(aiJson.explosions) ? aiJson.explosions.length : -1,
    });

    diagnostics.skeletonTopicItemsRequestedGroups = Array.isArray(aiJson.skeletonTopicItems)
      ? aiJson.skeletonTopicItems.length
      : 0;
    diagnostics.skeletonTopicItemsRequestedItems = Array.isArray(aiJson.skeletonTopicItems)
      ? (aiJson.skeletonTopicItems as unknown[]).reduce<number>((total, raw) => {
          if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
            return total;
          }
          const group = raw as RowRecord;
          return total + (Array.isArray(group.items) ? group.items.length : 0);
        }, 0)
      : 0;

    const timelines = this.normalizeTimelines(aiJson.timelines as unknown[], warnings);
    const characters = this.normalizeCharacters(aiJson.characters as unknown[], warnings);
    const keyNodes = this.normalizeKeyNodes(aiJson.keyNodes as unknown[], warnings);
    const skeletonTopicItems = this.normalizeSkeletonTopicItems(
      aiJson.skeletonTopicItems as unknown[],
      topicMap,
      warnings,
    );
    const explosions = this.normalizeExplosions(aiJson.explosions as unknown[], warnings);

    diagnostics.normalizedCounts = {
      timelines: timelines.length,
      characters: characters.length,
      keyNodes: keyNodes.length,
      skeletonTopicItems: skeletonTopicItems.length,
      explosions: explosions.length,
    };

    return {
      normalized: {
        timelines,
        characters,
        keyNodes,
        skeletonTopicItems,
        explosions,
      },
      warnings,
    };
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
      const topicKey = this.normalizeText(group.topicKey);
      const normalizedTopicKey = topicKey.toLowerCase();
      const requestedItems = Array.isArray(group.items) ? group.items.length : 0;
      this.logExtractStage('skeleton topic group received', {
        topicKey,
        normalizedTopicKey,
        itemCount: requestedItems,
        hit: Boolean(topicMap.has(normalizedTopicKey)),
      });
      if (!topicKey) {
        warnings.push('Dropped skeletonTopicItems group because topicKey is empty');
        continue;
      }
      if (!topicMap.has(normalizedTopicKey)) {
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

        const hasUsefulContent =
          Boolean(itemTitle) ||
          Boolean(content) ||
          sourceRef.length > 0 ||
          contentJson !== null;

        if (!hasUsefulContent) {
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

      result.push({
        topicKey: normalizedTopicKey,
        items: normalizedItems,
      });
      this.logExtractStage('skeleton topic group normalized', {
        topicKey,
        normalizedTopicKey,
        keptItems: normalizedItems.length,
        droppedItems: requestedItems - normalizedItems.length,
      });
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
    if (!text) {
      return '';
    }
    if (text.length <= maxLength) {
      return text;
    }
    return `${text.slice(0, maxLength)}...(truncated)`;
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

    const message = `写入 ${tableName} 失败：第 ${itemIndex + 1} 条记录的 ${fieldName} 长度为 ${length}，超过上限 ${max}`;
    this.logExtractStage(
      'max length validation failed',
      {
        tableName,
        fieldName,
        itemIndex,
        max,
        actualLength: length,
        context,
      },
      'error',
    );
    throw new BadRequestException(message);
  }

  private truncateWithWarning(
    tableName: string,
    fieldName: string,
    value: unknown,
    max: number,
    itemIndex: number,
    warnings: string[],
    context?: RowRecord,
  ): string {
    const text = this.safeTrim(value);
    if (!text) {
      return '';
    }

    const length = this.getStringLength(text);
    if (length <= max) {
      return text;
    }

    const message = `写入 ${tableName} 前已截断：第 ${itemIndex + 1} 条记录的 ${fieldName} 长度为 ${length}，已截断到 ${max}`;
    warnings.push(message);
    this.logExtractStage(
      'field truncated with warning',
      {
        tableName,
        fieldName,
        itemIndex,
        max,
        actualLength: length,
        context,
      },
      'warn',
    );
    return text.slice(0, max);
  }

  private logRowFailure(
    tableName: string,
    itemIndex: number,
    context: RowRecord,
    error: unknown,
  ): void {
    this.logExtractStage(
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
  ): HttpException {
    if (error instanceof HttpException) {
      return error;
    }

    const rawMessage = this.getErrorMessage(error);
    const itemPrefix =
      typeof itemIndex === 'number' ? `写入 ${tableName} 第 ${itemIndex + 1} 条记录失败：` : `写入 ${tableName} 失败：`;

    const tooLongMatch = rawMessage.match(/Data too long for column '([^']+)'/i);
    if (tooLongMatch) {
      return new BadRequestException(
        `${itemPrefix}字段 ${tooLongMatch[1]} 超过数据库长度限制。原始错误：${rawMessage}`,
      );
    }

    if (/Incorrect string value/i.test(rawMessage)) {
      return new BadRequestException(
        `${itemPrefix}存在数据库无法接受的字符内容。原始错误：${rawMessage}`,
      );
    }

    if (/Cannot add or update a child row/i.test(rawMessage)) {
      return new BadRequestException(
        `${itemPrefix}关联外键不存在，请检查 timeline_id 或 topic_id 映射。原始错误：${rawMessage}`,
      );
    }

    if (/Invalid JSON text/i.test(rawMessage)) {
      return new BadRequestException(
        `${itemPrefix}content_json 不是合法 JSON。原始错误：${rawMessage}`,
      );
    }

    if (error instanceof QueryFailedError) {
      return new BadRequestException(
        `${itemPrefix}${rawMessage}${context ? `；上下文：${JSON.stringify(context)}` : ''}`,
      );
    }

    return new InternalServerErrorException(
      `${itemPrefix}${rawMessage}${context ? `；上下文：${JSON.stringify(context)}` : ''}`,
    );
  }

  private getErrorMessage(error: unknown): string {
    if (error instanceof Error) {
      return error.message;
    }
    return String(error);
  }

  private logExtractStage(
    message: string,
    context?: Record<string, unknown>,
    level: 'log' | 'warn' | 'error' = 'log',
  ): void {
    const serialized = context ? ` ${this.safeJsonStringify(context)}` : '';
    console[level](`[pipeline:extract] ${message}${serialized}`);
  }

  private safeJsonStringify(value: unknown): string {
    try {
      return JSON.stringify(value);
    } catch {
      return '[unserializable-context]';
    }
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
      if (!text) {
        continue;
      }

      const remaining = 15000 - totalLength;
      if (remaining <= 0) {
        break;
      }

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
      SELECT
        title,
        core_text,
        protagonist_name,
        protagonist_identity,
        target_story,
        rewrite_goal,
        constraint_text
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
      if (!topicKey) {
        continue;
      }
      topicMap.set(topicKey, {
        id: Number(row.id),
        topicKey,
      });
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

    console.log(`[pipeline:extract] request endpoint=${endpoint} model=${modelKey}`);

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: modelKey,
        temperature: 0.4,
        messages: [
          {
            role: 'system',
            content:
              '你是短剧 Pipeline 数据抽取助手。你必须输出严格 JSON，不要输出 markdown，不要输出解释。',
          },
          {
            role: 'user',
            content: promptPreview,
          },
        ],
      }),
    });

    const contentType = response.headers.get('content-type') || '';
    const rawText = await response.text();
    console.log(
      `[pipeline:extract] response status=${response.status} contentType=${contentType}`,
    );

    if (this.isHtmlResponse(contentType, rawText)) {
      throw new BadRequestException(
        `Pipeline extract request reached an HTML page instead of JSON API. endpoint=${endpoint}, status=${response.status}, contentType=${contentType}, body=${this.summarizeBody(rawText)}`,
      );
    }

    if (!response.ok) {
      throw new BadRequestException(
        `Pipeline extract request failed. endpoint=${endpoint}, status=${response.status}, contentType=${contentType}, body=${this.summarizeBody(rawText)}`,
      );
    }

    let payload: any;
    try {
      payload = JSON.parse(rawText);
    } catch {
      throw new BadRequestException(
        `Pipeline extract response is not valid JSON. endpoint=${endpoint}, status=${response.status}, contentType=${contentType}, body=${this.summarizeBody(rawText)}`,
      );
    }

    const content = this.extractAiText(payload);
    if (!content) {
      throw new BadRequestException('Pipeline extract response does not contain usable text content');
    }

    return this.parseJsonObjectFromText(content);
  }

  private extractAiText(payload: any): string {
    if (typeof payload === 'string') {
      return payload;
    }

    const content = payload?.choices?.[0]?.message?.content;
    if (typeof content === 'string') {
      return content;
    }

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

    if (typeof payload?.output_text === 'string') {
      return payload.output_text;
    }

    if (typeof payload?.response === 'string') {
      return payload.response;
    }

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
    const candidates = [
      text,
      this.normalizeJsonLikeText(text),
    ];

    for (const candidate of candidates) {
      try {
        return JSON.parse(candidate);
      } catch {
        // Try next candidate.
      }
    }

    throw new BadRequestException(
      `Pipeline extract content is not valid JSON: ${text.slice(0, 500)}`,
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
    if (normalized.length <= maxLength) {
      return normalized;
    }
    return `${normalized.slice(0, maxLength)}...(truncated)`;
  }

  private trimBlock(value: unknown, maxLength: number): string {
    const text = this.normalizeText(value);
    if (!text) {
      return '';
    }
    if (text.length <= maxLength) {
      return text;
    }
    return `${text.slice(0, maxLength)}...(截断)`;
  }

  private normalizeText(value: unknown): string {
    if (typeof value !== 'string') {
      return '';
    }
    return value.trim();
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
