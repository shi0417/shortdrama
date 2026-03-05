import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import { CreateAdaptationStrategyDto } from './dto/create-adaptation-strategy.dto';
import { UpdateAdaptationStrategyDto } from './dto/update-adaptation-strategy.dto';

type AdaptationModeRow = {
  id: number;
  modeKey: string;
  modeName: string;
  description: string | null;
  isActive: number;
  sortOrder: number;
  createdAt: string;
};

type AdaptationStrategyRow = {
  id: number;
  novelId: number;
  modeId: number;
  modeKey: string;
  modeName: string;
  strategyTitle: string | null;
  strategyDescription: string | null;
  aiPromptTemplate: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
};

@Injectable()
export class AdaptationService {
  constructor(private readonly dataSource: DataSource) {}

  async listModes(onlyActive = true): Promise<AdaptationModeRow[]> {
    if (onlyActive) {
      return this.dataSource.query(
        `
        SELECT
          id,
          mode_key AS modeKey,
          mode_name AS modeName,
          description,
          is_active AS isActive,
          sort_order AS sortOrder,
          created_at AS createdAt
        FROM adaptation_modes
        WHERE is_active = 1
        ORDER BY sort_order ASC, id ASC
        `,
      );
    }

    return this.dataSource.query(
      `
      SELECT
        id,
        mode_key AS modeKey,
        mode_name AS modeName,
        description,
        is_active AS isActive,
        sort_order AS sortOrder,
        created_at AS createdAt
      FROM adaptation_modes
      ORDER BY sort_order ASC, id ASC
      `,
    );
  }

  async listNovelStrategies(novelId: number): Promise<AdaptationStrategyRow[]> {
    await this.assertNovelExists(novelId);
    return this.queryStrategiesByNovel(novelId);
  }

  async createNovelStrategy(
    novelId: number,
    dto: CreateAdaptationStrategyDto,
  ): Promise<AdaptationStrategyRow> {
    await this.assertNovelExists(novelId);
    await this.assertModeExists(dto.modeId);

    const [versionRow] = await this.dataSource.query(
      `
      SELECT IFNULL(MAX(version), 0) + 1 AS nextVersion
      FROM novel_adaptation_strategy
      WHERE novel_id = ?
      `,
      [novelId],
    );
    const nextVersion = Number(versionRow?.nextVersion || 1);

    const insertResult: any = await this.dataSource.query(
      `
      INSERT INTO novel_adaptation_strategy (
        novel_id,
        mode_id,
        strategy_title,
        strategy_description,
        ai_prompt_template,
        version
      ) VALUES (?, ?, ?, ?, ?, ?)
      `,
      [
        novelId,
        dto.modeId,
        dto.strategyTitle ?? null,
        dto.strategyDescription ?? null,
        dto.aiPromptTemplate ?? null,
        nextVersion,
      ],
    );

    return this.getStrategyById(insertResult.insertId);
  }

  async updateStrategy(
    id: number,
    dto: UpdateAdaptationStrategyDto,
  ): Promise<AdaptationStrategyRow> {
    await this.getStrategyById(id);

    if (Object.keys(dto).length === 0) {
      throw new BadRequestException('At least one field must be provided');
    }

    if (dto.modeId !== undefined) {
      await this.assertModeExists(dto.modeId);
    }

    const sets: string[] = [];
    const params: any[] = [];

    if (dto.modeId !== undefined) {
      sets.push('mode_id = ?');
      params.push(dto.modeId);
    }
    if (dto.strategyTitle !== undefined) {
      sets.push('strategy_title = ?');
      params.push(dto.strategyTitle);
    }
    if (dto.strategyDescription !== undefined) {
      sets.push('strategy_description = ?');
      params.push(dto.strategyDescription);
    }
    if (dto.aiPromptTemplate !== undefined) {
      sets.push('ai_prompt_template = ?');
      params.push(dto.aiPromptTemplate);
    }

    params.push(id);

    await this.dataSource.query(
      `
      UPDATE novel_adaptation_strategy
      SET ${sets.join(', ')}
      WHERE id = ?
      `,
      params,
    );

    return this.getStrategyById(id);
  }

  async deleteStrategy(id: number): Promise<{ ok: true }> {
    await this.getStrategyById(id);
    await this.dataSource.query(
      `DELETE FROM novel_adaptation_strategy WHERE id = ?`,
      [id],
    );
    return { ok: true };
  }

  private async queryStrategiesByNovel(
    novelId: number,
  ): Promise<AdaptationStrategyRow[]> {
    return this.dataSource.query(
      `
      SELECT
        s.id,
        s.novel_id AS novelId,
        s.mode_id AS modeId,
        m.mode_key AS modeKey,
        m.mode_name AS modeName,
        s.strategy_title AS strategyTitle,
        s.strategy_description AS strategyDescription,
        s.ai_prompt_template AS aiPromptTemplate,
        s.version,
        s.created_at AS createdAt,
        s.updated_at AS updatedAt
      FROM novel_adaptation_strategy s
      JOIN adaptation_modes m ON m.id = s.mode_id
      WHERE s.novel_id = ?
      ORDER BY s.version DESC, s.updated_at DESC, s.id DESC
      `,
      [novelId],
    );
  }

  private async getStrategyById(id: number): Promise<AdaptationStrategyRow> {
    const rows = await this.dataSource.query(
      `
      SELECT
        s.id,
        s.novel_id AS novelId,
        s.mode_id AS modeId,
        m.mode_key AS modeKey,
        m.mode_name AS modeName,
        s.strategy_title AS strategyTitle,
        s.strategy_description AS strategyDescription,
        s.ai_prompt_template AS aiPromptTemplate,
        s.version,
        s.created_at AS createdAt,
        s.updated_at AS updatedAt
      FROM novel_adaptation_strategy s
      JOIN adaptation_modes m ON m.id = s.mode_id
      WHERE s.id = ?
      LIMIT 1
      `,
      [id],
    );

    if (!rows.length) {
      throw new NotFoundException(`Adaptation strategy ${id} not found`);
    }

    return rows[0];
  }

  private async assertNovelExists(novelId: number): Promise<void> {
    const rows = await this.dataSource.query(
      `SELECT id FROM drama_novels WHERE id = ? LIMIT 1`,
      [novelId],
    );
    if (!rows.length) {
      throw new NotFoundException(`Novel ${novelId} not found`);
    }
  }

  private async assertModeExists(modeId: number): Promise<void> {
    const rows = await this.dataSource.query(
      `SELECT id FROM adaptation_modes WHERE id = ? LIMIT 1`,
      [modeId],
    );
    if (!rows.length) {
      throw new BadRequestException(`Adaptation mode ${modeId} not found`);
    }
  }
}
