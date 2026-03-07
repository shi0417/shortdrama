import {
  BadRequestException,
  InternalServerErrorException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { UpsertSetCoreDto } from './dto/upsert-set-core.dto';
import {
  AllowedReferenceTable,
  EnhanceSetCoreDto,
  EnhanceSetCoreCurrentFieldsDto,
} from './dto/enhance-set-core.dto';

export type SetCoreRow = {
  id: number;
  novelId: number;
  title: string | null;
  coreText: string | null;
  protagonistName: string | null;
  protagonistIdentity: string | null;
  targetStory: string | null;
  rewriteGoal: string | null;
  constraintText: string | null;
  version: number;
  isActive: number;
  createdAt: string;
  updatedAt: string;
};

export type SetCoreVersionRow = {
  id: number;
  novelId: number;
  title: string | null;
  version: number;
  isActive: number;
  createdAt: string;
  updatedAt: string;
};

type RowRecord = Record<string, any>;

export type EnhanceSetCorePreviewRow = {
  promptPreview: string;
  usedModelKey: string;
  referenceTables: AllowedReferenceTable[];
};

export type EnhanceSetCoreResultRow = {
  title: string;
  coreText: string;
  protagonistName: string;
  protagonistIdentity: string;
  targetStory: string;
  rewriteGoal: string;
  constraintText: string;
  usedModelKey: string;
  promptPreview: string;
};

const DEFAULT_REFERENCE_TABLES: AllowedReferenceTable[] = [
  'drama_source_text',
  'novel_characters',
  'novel_key_nodes',
  'novel_adaptation_strategy',
  'adaptation_modes',
];

@Injectable()
export class SetCoreService {
  constructor(private readonly dataSource: DataSource) {}

  async getActiveSetCore(novelId: number): Promise<SetCoreRow | null> {
    await this.assertNovelExists(novelId);
    return this.getActiveSetCoreByNovel(novelId);
  }

  async previewEnhancePrompt(
    novelId: number,
    dto: EnhanceSetCoreDto,
  ): Promise<EnhanceSetCorePreviewRow> {
    await this.assertNovelExists(novelId);

    const usedModelKey = await this.resolveModelKey(dto.modelKey);
    const referenceTables = this.resolveReferenceTables(dto.referenceTables);
    const promptPreview = await this.buildPrompt(
      novelId,
      dto.currentCoreText,
      dto.currentFields,
      dto.userInstruction,
      referenceTables,
    );

    return {
      promptPreview,
      usedModelKey,
      referenceTables,
    };
  }

  async enhanceSetCore(
    novelId: number,
    dto: EnhanceSetCoreDto,
  ): Promise<EnhanceSetCoreResultRow> {
    await this.assertNovelExists(novelId);

    const usedModelKey = await this.resolveModelKey(dto.modelKey);
    const referenceTables = this.resolveReferenceTables(dto.referenceTables);
    const promptPreview =
      dto.allowPromptEdit && dto.promptOverride?.trim()
        ? dto.promptOverride.trim()
        : await this.buildPrompt(
            novelId,
            dto.currentCoreText,
            dto.currentFields,
            dto.userInstruction,
            referenceTables,
          );

    const aiJson = await this.callLcAiApi(usedModelKey, promptPreview);

    const result: EnhanceSetCoreResultRow = {
      title: this.withFallback(aiJson.title, dto.currentFields?.title),
      coreText: this.normalizeText(aiJson.coreText),
      protagonistName: this.withFallback(
        aiJson.protagonistName,
        dto.currentFields?.protagonistName,
      ),
      protagonistIdentity: this.withFallback(
        aiJson.protagonistIdentity,
        dto.currentFields?.protagonistIdentity,
      ),
      targetStory: this.withFallback(
        aiJson.targetStory,
        dto.currentFields?.targetStory,
      ),
      rewriteGoal: this.withFallback(
        aiJson.rewriteGoal,
        dto.currentFields?.rewriteGoal,
      ),
      constraintText: this.withFallback(
        aiJson.constraintText,
        dto.currentFields?.constraintText,
      ),
      usedModelKey,
      promptPreview,
    };

    this.validateEnhanceResult(result, dto.currentCoreText);

    return result;
  }

  async listSetCoreVersions(novelId: number): Promise<SetCoreVersionRow[]> {
    await this.assertNovelExists(novelId);
    return this.dataSource.query(
      `
      SELECT
        id,
        novel_id AS novelId,
        title,
        version,
        is_active AS isActive,
        created_at AS createdAt,
        updated_at AS updatedAt
      FROM set_core
      WHERE novel_id = ?
      ORDER BY version DESC, id DESC
      `,
      [novelId],
    );
  }

  async activateVersion(id: number): Promise<SetCoreRow> {
    return this.dataSource.transaction(async (manager) => {
      const rows = await manager.query(
        `
        SELECT id, novel_id AS novelId
        FROM set_core
        WHERE id = ?
        LIMIT 1
        `,
        [id],
      );

      if (!rows.length) {
        throw new NotFoundException(`set_core ${id} not found`);
      }

      const novelId = Number(rows[0].novelId);

      await manager.query(
        `
        UPDATE set_core
        SET is_active = 0
        WHERE novel_id = ?
        `,
        [novelId],
      );

      await manager.query(
        `
        UPDATE set_core
        SET is_active = 1, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
        `,
        [id],
      );

      const activated = await this.getById(id, manager);
      if (!activated) {
        throw new NotFoundException(`set_core ${id} not found after activation`);
      }
      return activated;
    });
  }

  async deleteSetCore(id: number): Promise<{ ok: true }> {
    return this.dataSource.transaction(async (manager) => {
      const rows = await manager.query(
        `
        SELECT
          id,
          novel_id AS novelId,
          version,
          is_active AS isActive
        FROM set_core
        WHERE id = ?
        LIMIT 1
        `,
        [id],
      );

      if (!rows.length) {
        throw new NotFoundException(`set_core ${id} not found`);
      }

      const target = rows[0] as {
        id: number;
        novelId: number;
        version: number;
        isActive: number;
      };

      await manager.query(
        `
        DELETE FROM set_core
        WHERE id = ?
        `,
        [id],
      );

      if (Number(target.isActive) === 1) {
        const latestRows = await manager.query(
          `
          SELECT id
          FROM set_core
          WHERE novel_id = ?
          ORDER BY version DESC, id DESC
          LIMIT 1
          `,
          [target.novelId],
        );

        if (latestRows.length) {
          await manager.query(
            `
            UPDATE set_core
            SET is_active = 1, updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
            `,
            [latestRows[0].id],
          );
        }
      }

      return { ok: true };
    });
  }

  async upsertSetCore(
    novelId: number,
    dto: UpsertSetCoreDto,
  ): Promise<SetCoreRow> {
    if (Object.keys(dto).length === 0) {
      throw new BadRequestException('Request body cannot be empty');
    }

    const mode = dto.mode ?? 'update_active';

    return this.dataSource.transaction(async (manager) => {
      await this.assertNovelExists(novelId, manager);
      const active = await this.getActiveSetCoreByNovel(novelId, manager);

      if (mode === 'update_active') {
        if (active) {
          await manager.query(
            `
            UPDATE set_core
            SET
              title = ?,
              core_text = ?,
              protagonist_name = ?,
              protagonist_identity = ?,
              target_story = ?,
              rewrite_goal = ?,
              constraint_text = ?,
              updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
            `,
            [
              dto.title ?? active.title ?? '',
              dto.coreText ?? active.coreText ?? '',
              dto.protagonistName ?? active.protagonistName,
              dto.protagonistIdentity ?? active.protagonistIdentity,
              dto.targetStory ?? active.targetStory,
              dto.rewriteGoal ?? active.rewriteGoal,
              dto.constraintText ?? active.constraintText,
              active.id,
            ],
          );
          const row = await this.getById(active.id, manager);
          if (!row) {
            throw new NotFoundException('Active set_core record not found');
          }
          return row;
        }

        const insertResult: any = await manager.query(
          `
          INSERT INTO set_core (
            novel_id,
            title,
            core_text,
            protagonist_name,
            protagonist_identity,
            target_story,
            rewrite_goal,
            constraint_text,
            version,
            is_active
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
          `,
          [
            novelId,
            dto.title ?? '',
            dto.coreText ?? '',
            dto.protagonistName ?? null,
            dto.protagonistIdentity ?? null,
            dto.targetStory ?? null,
            dto.rewriteGoal ?? null,
            dto.constraintText ?? null,
            1,
          ],
        );

        const row = await this.getById(insertResult.insertId, manager);
        if (!row) {
          throw new NotFoundException('Inserted set_core record not found');
        }
        return row;
      }

      const [maxVersionRow] = await manager.query(
        `
        SELECT COALESCE(MAX(version), 0) AS maxVersion
        FROM set_core
        WHERE novel_id = ?
        `,
        [novelId],
      );
      const nextVersion = Number(maxVersionRow?.maxVersion || 0) + 1;

      await manager.query(
        `
        UPDATE set_core
        SET is_active = 0
        WHERE novel_id = ? AND is_active = 1
        `,
        [novelId],
      );

      const insertResult: any = await manager.query(
        `
        INSERT INTO set_core (
          novel_id,
          title,
          core_text,
          protagonist_name,
          protagonist_identity,
          target_story,
          rewrite_goal,
          constraint_text,
          version,
          is_active
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
        `,
        [
          novelId,
          dto.title ?? active?.title ?? '',
          dto.coreText ?? active?.coreText ?? '',
          dto.protagonistName ?? null,
          dto.protagonistIdentity ?? null,
          dto.targetStory ?? null,
          dto.rewriteGoal ?? null,
          dto.constraintText ?? null,
          nextVersion,
        ],
      );

      const row = await this.getById(insertResult.insertId, manager);
      if (!row) {
        throw new NotFoundException('Inserted set_core record not found');
      }
      return row;
    });
  }

  private resolveReferenceTables(
    referenceTables?: AllowedReferenceTable[],
  ): AllowedReferenceTable[] {
    if (!referenceTables?.length) {
      return DEFAULT_REFERENCE_TABLES;
    }
    return referenceTables;
  }

  private async resolveModelKey(modelKey?: string): Promise<string> {
    if (modelKey?.trim()) {
      return modelKey.trim();
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

    const fallback = rows[0]?.modelKey;
    if (!fallback) {
      throw new BadRequestException('No active AI model available in ai_model_catalog');
    }

    return String(fallback);
  }

  private normalizeText(value: unknown): string {
    if (typeof value !== 'string') {
      return '';
    }
    return value.trim();
  }

  private withFallback(value: unknown, fallback?: string): string {
    const normalized = this.normalizeText(value);
    if (normalized) {
      return normalized;
    }
    return this.normalizeText(fallback);
  }

  private async buildPrompt(
    novelId: number,
    currentCoreText?: string,
    currentFields?: EnhanceSetCoreCurrentFieldsDto,
    userInstruction?: string,
    referenceTables: AllowedReferenceTable[] = DEFAULT_REFERENCE_TABLES,
  ): Promise<string> {
    const currentSection = [
      '【当前待强化的 set_core 草稿】',
      `title: ${currentFields?.title ?? '(待补全)'}`,
      `coreText: ${currentCoreText?.trim() || '(当前 coreText 为空，需要结合资料主动补全)'}`,
      `protagonistName: ${currentFields?.protagonistName ?? '(待补全)'}`,
      `protagonistIdentity: ${currentFields?.protagonistIdentity ?? '(待补全)'}`,
      `targetStory: ${currentFields?.targetStory ?? '(待补全)'}`,
      `rewriteGoal: ${currentFields?.rewriteGoal ?? '(待补全)'}`,
      `constraintText: ${currentFields?.constraintText ?? '(待补全)'}`,
    ].join('\n');

    const userInstructionSection = [
      '【用户附加要求】',
      userInstruction?.trim() || '无',
    ].join('\n');

    const referenceBlocks = await this.buildReferenceBlocks(novelId, referenceTables);

    const taskGoalSection = [
      '【任务目标】',
      '你不是在补齐数据库表单，而是在强化一条短剧核心设定。',
      '你要基于当前 set_core 草稿与参考资料，产出更完整、更具体、更有戏剧驱动力的强化版设定。',
      '',
      '【必须做到】',
      '1. coreText 必须在现有内容基础上做深度细化与增强，不能只做轻微改写、同义替换或摘要复述。',
      '2. 必须补强完整链路：主角是谁 -> 主角身份与处境 -> 主角知道什么 -> 主角要改写什么 -> 为什么不能直接做 -> 必须如何借力布局 -> 为什么会形成爽点与张力。',
      '3. 必须突出冲突、限制、目标、改写路径、权谋/博弈以及爽点张力。',
      '4. 如果现有字段不完整，要结合参考资料主动补全，不要输出空字段。',
      '5. 若参考资料存在多条信息，优先提炼与主角身份、关键冲突、改写目标直接相关的内容，不要机械摘要原文。',
      '',
      '【字段要求】',
      '- title：一句能概括强化版设定的标题。',
      '- coreText：完整强化版核心设定正文，必须比输入更具体、更完整、更有戏剧驱动力，建议不少于 120 字。',
      '- protagonistName：只输出最主要的主角名，不要混入多人名字。',
      '- protagonistIdentity：一句清晰的主角身份/处境描述。',
      '- targetStory：简洁明确地写出要改写的历史故事/关键进程。',
      '- rewriteGoal：明确主角想改写什么，以及改写后的目标结果。',
      '- constraintText：明确主角当前最核心的限制、代价或无法直接行动的原因。',
      '',
      '【禁止项】',
      '- 不要只复述原文。',
      '- 不要输出空字段。',
      '- 不要输出解释、markdown、注释或额外字段。',
      '- 必须输出严格 JSON。',
    ].join('\n');

    const outputFormat = [
      '【输出格式要求】',
      '你必须输出严格 JSON，不要输出 markdown，不要输出解释。',
      '{',
      '  "title": "",',
      '  "coreText": "",',
      '  "protagonistName": "",',
      '  "protagonistIdentity": "",',
      '  "targetStory": "",',
      '  "rewriteGoal": "",',
      '  "constraintText": ""',
      '}',
    ].join('\n');

    return [
      '【System Prompt】',
      '你是短剧核心设定强化助手。',
      '请把当前材料整理成一条更强、更完整、更有戏剧驱动力的短剧核心设定。',
      '',
      taskGoalSection,
      '',
      currentSection,
      '',
      userInstructionSection,
      '',
      referenceBlocks || '【参考资料】\n无',
      '',
      outputFormat,
    ].join('\n');
  }

  private async buildReferenceBlocks(
    novelId: number,
    referenceTables: AllowedReferenceTable[],
  ): Promise<string> {
    const blocks: string[] = [];

    if (referenceTables.includes('drama_source_text')) {
      const text = await this.getLatestSourceTextBlock(novelId);
      if (text) {
        blocks.push(text);
      }
    }

    if (referenceTables.includes('novel_timelines')) {
      const rows = await this.selectByNovel('novel_timelines', 't', novelId, 't.sort_order');
      if (rows.length) {
        blocks.push(
          [
            '【时间线】',
            '以下为与故事主线相关的关键时间节点，请优先提炼能支撑主角改写路径的事件：',
            ...rows.map(
              (row) => `- [${row.time_node ?? ''}] ${this.trimBlock(row.event, 300)}`,
            ),
          ].join('\n'),
        );
      }
    }

    if (referenceTables.includes('novel_characters')) {
      const rows = await this.selectByNovel('novel_characters', 'c', novelId, 'c.sort_order');
      if (rows.length) {
        blocks.push(
          [
            '【人物信息】',
            '以下为主要人物信息，请重点识别主角身份、可借力对象、主要对手与制约关系：',
            ...rows.slice(0, 12).map(
              (row) =>
                `- ${row.name ?? ''}｜${row.faction ?? ''}｜${this.trimBlock(
                  row.description,
                  160,
                )}｜${this.trimBlock(row.personality, 100)}｜${this.trimBlock(
                  row.setting_words,
                  100,
                )}`,
            ),
          ].join('\n'),
        );
      }
    }

    if (referenceTables.includes('novel_key_nodes')) {
      const rows = await this.selectByNovel('novel_key_nodes', 'k', novelId, 'k.sort_order');
      if (rows.length) {
        blocks.push(
          [
            '【关键节点】',
            '以下为对剧情推进影响最大的历史节点，请提炼主角介入和改写的突破口：',
            ...rows.slice(0, 15).map(
              (row) =>
                `- ${row.category ?? ''}｜${row.title ?? ''}｜${this.trimBlock(
                  row.description,
                  240,
                )}`,
            ),
          ].join('\n'),
        );
      }
    }

    if (referenceTables.includes('novel_skeleton_topics')) {
      const rows = await this.selectByNovel(
        'novel_skeleton_topics',
        'st',
        novelId,
        'st.sort_order',
      );
      if (rows.length) {
        blocks.push(
          [
            '【骨架主题】',
            ...rows.slice(0, 12).map(
              (row) =>
                `- ${row.topic_name ?? ''}｜${row.topic_key ?? ''}｜${row.topic_type ?? ''}｜${row.description ?? ''}`,
            ),
          ].join('\n'),
        );
      }
    }

    if (referenceTables.includes('novel_skeleton_topic_items')) {
      const topicRows = await this.selectByNovel(
        'novel_skeleton_topics',
        'st',
        novelId,
        'st.sort_order',
      );
      const itemRows = await this.selectByNovel(
        'novel_skeleton_topic_items',
        'si',
        novelId,
        'si.sort_order',
      );
      if (itemRows.length) {
        const topicMap = new Map<number, string>();
        topicRows.forEach((row) => topicMap.set(Number(row.id), row.topic_name ?? `Topic#${row.id}`));
        const groups = new Map<number, RowRecord[]>();
        itemRows.slice(0, 20).forEach((row) => {
          const topicId = Number(row.topic_id);
          if (!groups.has(topicId)) {
            groups.set(topicId, []);
          }
          groups.get(topicId)!.push(row);
        });
        const lines: string[] = ['【骨架主题详情】'];
        groups.forEach((rows, topicId) => {
          lines.push(`主题：${topicMap.get(topicId) ?? `Topic#${topicId}`}`);
          rows.forEach((row) => {
            lines.push(
              `- ${row.item_title ?? ''}：${this.trimBlock(row.content, 180)}${
                row.source_ref ? `（来源：${row.source_ref}）` : ''
              }`,
            );
          });
        });
        blocks.push(lines.join('\n'));
      }
    }

    if (referenceTables.includes('novel_explosions')) {
      const rows = await this.selectByNovel('novel_explosions', 'e', novelId, 'e.sort_order');
      if (rows.length) {
        blocks.push(
          [
            '【爆点设计】',
            ...rows.slice(0, 12).map(
              (row) =>
                `- ${row.explosion_type ?? ''}｜${row.title ?? ''}｜${row.subtitle ?? ''}｜${this.trimBlock(
                  row.scene_restoration,
                  120,
                )}｜${this.trimBlock(row.dramatic_quality, 120)}｜${this.trimBlock(
                  row.adaptability,
                  120,
                )}`,
            ),
          ].join('\n'),
        );
      }
    }

    const latestStrategy = referenceTables.includes('novel_adaptation_strategy')
      ? await this.getLatestAdaptationStrategy(novelId)
      : null;

    if (latestStrategy) {
      blocks.push(
        [
          '【改编策略】',
          `- 版本：v${latestStrategy.version}`,
          `- 标题：${latestStrategy.strategyTitle ?? ''}`,
          `- 说明：${this.trimBlock(latestStrategy.strategyDescription, 300)}`,
          `- Prompt 模板：${this.trimBlock(latestStrategy.aiPromptTemplate, 1000)}`,
        ].join('\n'),
      );
    }

    if (referenceTables.includes('adaptation_modes') && latestStrategy?.modeId) {
      const mode = await this.getAdaptationModeById(Number(latestStrategy.modeId));
      if (mode) {
        blocks.push(
          [
            '【改编模式】',
            `- mode_key：${mode.mode_key ?? ''}`,
            `- mode_name：${mode.mode_name ?? ''}`,
            `- description：${this.trimBlock(mode.description, 300)}`,
          ].join('\n'),
        );
      }
    }

    return blocks.join('\n\n');
  }

  private async getLatestSourceTextBlock(novelId: number): Promise<string> {
    if (!(await this.hasTable('drama_source_text'))) {
      return '';
    }

    const rows = await this.dataSource.query(
      `
      SELECT source_text AS sourceText
      FROM drama_source_text
      WHERE novels_id = ?
      ORDER BY update_time DESC, id DESC
      LIMIT 1
      `,
      [novelId],
    );

    if (!rows.length || !rows[0].sourceText) {
      return '';
    }

    return [
      '【背景原始资料】',
      '以下为原始素材节选，请重点提炼与主角身份、冲突、改写目标、限制条件直接相关的信息，不要机械复述：',
      this.trimBlock(rows[0].sourceText, 5000),
    ].join('\n');
  }

  private trimBlock(value: unknown, maxLength: number): string {
    if (value === null || value === undefined) {
      return '';
    }

    const text =
      typeof value === 'string' ? value.trim() : JSON.stringify(value, null, 0).trim();
    if (!text) {
      return '';
    }
    if (text.length <= maxLength) {
      return text;
    }
    return `${text.slice(0, maxLength)}...(截断)`;
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

  private async selectByNovel(
    tableName: string,
    alias: string,
    novelId: number,
    orderBy?: string,
  ): Promise<RowRecord[]> {
    if (!(await this.hasTable(tableName))) {
      return [];
    }

    const qb = this.dataSource
      .createQueryBuilder()
      .select(`${alias}.*`)
      .from(tableName, alias)
      .where(`${alias}.novel_id = :novelId`, { novelId });

    if (orderBy) {
      qb.orderBy(orderBy, 'ASC');
    }

    return qb.getRawMany();
  }

  private async getLatestAdaptationStrategy(novelId: number): Promise<RowRecord | null> {
    if (!(await this.hasTable('novel_adaptation_strategy'))) {
      return null;
    }

    const rows = await this.dataSource.query(
      `
      SELECT
        id,
        mode_id AS modeId,
        strategy_title AS strategyTitle,
        strategy_description AS strategyDescription,
        ai_prompt_template AS aiPromptTemplate,
        version
      FROM novel_adaptation_strategy
      WHERE novel_id = ?
      ORDER BY version DESC, updated_at DESC, id DESC
      LIMIT 1
      `,
      [novelId],
    );

    return rows[0] ?? null;
  }

  private async getAdaptationModeById(modeId: number): Promise<RowRecord | null> {
    if (!(await this.hasTable('adaptation_modes'))) {
      return null;
    }

    const rows = await this.dataSource.query(
      `
      SELECT id, mode_key, mode_name, description
      FROM adaptation_modes
      WHERE id = ?
      LIMIT 1
      `,
      [modeId],
    );

    return rows[0] ?? null;
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

    console.log(
      `[set-core:enhance] request endpoint=${endpoint} model=${modelKey}`,
    );

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: modelKey,
        temperature: 0.7,
        messages: [
          {
            role: 'system',
            content:
              '你是短剧核心设定完善助手。你必须输出严格 JSON，不要输出 markdown，不要输出解释。',
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
      `[set-core:enhance] response status=${response.status} contentType=${contentType}`,
    );

    if (this.isHtmlResponse(contentType, rawText)) {
      throw new BadRequestException(
        `AI enhance request reached an HTML page instead of JSON API. endpoint=${endpoint}, status=${response.status}, contentType=${contentType}, body=${this.summarizeBody(rawText)}`,
      );
    }

    if (!response.ok) {
      throw new BadRequestException(
        `AI enhance request failed. endpoint=${endpoint}, status=${response.status}, contentType=${contentType}, body=${this.summarizeBody(rawText)}`,
      );
    }

    let payload: any;
    try {
      payload = JSON.parse(rawText);
    } catch {
      throw new BadRequestException(
        `AI enhance response is not valid JSON. endpoint=${endpoint}, status=${response.status}, contentType=${contentType}, body=${this.summarizeBody(rawText)}`,
      );
    }

    const content = this.extractAiText(payload);
    if (!content) {
      throw new BadRequestException('AI enhance response does not contain usable text content');
    }

    const parsed = this.parseJsonObjectFromText(content);
    return parsed;
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
    const trimmed = text.trim();

    try {
      return JSON.parse(trimmed);
    } catch {
      const start = trimmed.indexOf('{');
      const end = trimmed.lastIndexOf('}');
      if (start >= 0 && end > start) {
        const candidate = trimmed.slice(start, end + 1);
        try {
          return JSON.parse(candidate);
        } catch {
          throw new BadRequestException(`AI enhance content is not valid JSON: ${candidate.slice(0, 500)}`);
        }
      }
    }

    throw new BadRequestException(`AI enhance content is not valid JSON: ${trimmed.slice(0, 500)}`);
  }

  private validateEnhanceResult(
    result: EnhanceSetCoreResultRow,
    originalCoreText?: string,
  ): void {
    const normalizedCore = this.normalizeComparableText(result.coreText);
    if (!normalizedCore) {
      throw new BadRequestException('AI enhance result coreText is empty');
    }

    if (result.coreText.trim().length < 100) {
      throw new BadRequestException('AI enhance result coreText is too short');
    }

    const normalizedOriginal = this.normalizeComparableText(originalCoreText);
    if (!normalizedOriginal) {
      return;
    }

    if (normalizedCore === normalizedOriginal) {
      throw new BadRequestException(
        'AI enhance result is too similar to the original coreText',
      );
    }

    const similarity = this.calculateDiceSimilarity(normalizedCore, normalizedOriginal);
    if (similarity >= 0.9) {
      throw new BadRequestException(
        `AI enhance result is too similar to the original coreText (similarity=${similarity.toFixed(2)})`,
      );
    }
  }

  private normalizeComparableText(value?: string): string {
    return this.normalizeText(value).toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '');
  }

  private calculateDiceSimilarity(a: string, b: string): number {
    if (!a || !b) {
      return 0;
    }
    if (a === b) {
      return 1;
    }
    if (a.length < 2 || b.length < 2) {
      return 0;
    }

    const createBigrams = (text: string) => {
      const counts = new Map<string, number>();
      for (let i = 0; i < text.length - 1; i += 1) {
        const bigram = text.slice(i, i + 2);
        counts.set(bigram, (counts.get(bigram) ?? 0) + 1);
      }
      return counts;
    };

    const aBigrams = createBigrams(a);
    const bBigrams = createBigrams(b);
    let overlap = 0;

    aBigrams.forEach((count, bigram) => {
      overlap += Math.min(count, bBigrams.get(bigram) ?? 0);
    });

    return (2 * overlap) / ((a.length - 1) + (b.length - 1));
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

  private async getById(
    id: number,
    manager: EntityManager = this.dataSource.manager,
  ): Promise<SetCoreRow | null> {
    const rows = await manager.query(
      `
      SELECT
        id,
        novel_id AS novelId,
        title,
        core_text AS coreText,
        protagonist_name AS protagonistName,
        protagonist_identity AS protagonistIdentity,
        target_story AS targetStory,
        rewrite_goal AS rewriteGoal,
        constraint_text AS constraintText,
        version,
        is_active AS isActive,
        created_at AS createdAt,
        updated_at AS updatedAt
      FROM set_core
      WHERE id = ?
      LIMIT 1
      `,
      [id],
    );
    return rows[0] ?? null;
  }

  private async getActiveSetCoreByNovel(
    novelId: number,
    manager: EntityManager = this.dataSource.manager,
  ): Promise<SetCoreRow | null> {
    const rows = await manager.query(
      `
      SELECT
        id,
        novel_id AS novelId,
        title,
        core_text AS coreText,
        protagonist_name AS protagonistName,
        protagonist_identity AS protagonistIdentity,
        target_story AS targetStory,
        rewrite_goal AS rewriteGoal,
        constraint_text AS constraintText,
        version,
        is_active AS isActive,
        created_at AS createdAt,
        updated_at AS updatedAt
      FROM set_core
      WHERE novel_id = ? AND is_active = 1
      ORDER BY version DESC, id DESC
      LIMIT 1
      `,
      [novelId],
    );
    return rows[0] ?? null;
  }

  private async assertNovelExists(
    novelId: number,
    manager: EntityManager = this.dataSource.manager,
  ): Promise<void> {
    const rows = await manager.query(
      `SELECT id FROM drama_novels WHERE id = ? LIMIT 1`,
      [novelId],
    );
    if (!rows.length) {
      throw new NotFoundException(`Novel ${novelId} not found`);
    }
  }
}
