import { Injectable, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import {
  CreateEpisodeShotPromptDto,
  UpdateEpisodeShotPromptDto,
} from './dto/episode-shot-prompt.dto';

type Row = Record<string, unknown>;

@Injectable()
export class EpisodeShotPromptService {
  constructor(private readonly dataSource: DataSource) {}

  async listByShot(shotId: number): Promise<Row[]> {
    await this.assertShotExists(shotId);
    const rows = await this.dataSource.query<Row[]>(
      `SELECT id, novel_id, shot_id, prompt_type, prompt_text, negative_prompt, model_name, style_preset, created_at, updated_at
       FROM episode_shot_prompts
       WHERE shot_id = ?
       ORDER BY prompt_type ASC, id ASC`,
      [shotId],
    );
    return rows;
  }

  async getOne(id: number): Promise<Row> {
    const row = await this.findById(id);
    if (!row) {
      throw new NotFoundException(`Episode shot prompt ${id} not found`);
    }
    return row;
  }

  async create(
    shotId: number,
    dto: CreateEpisodeShotPromptDto,
  ): Promise<Row> {
    const shot = await this.getShotRow(shotId);
    if (!shot) {
      throw new NotFoundException(`Episode shot ${shotId} not found`);
    }
    const novelId = Number(shot.novel_id);
    await this.dataSource.query(
      `INSERT INTO episode_shot_prompts (
        novel_id, shot_id, prompt_type, prompt_text, negative_prompt, model_name, style_preset
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        novelId,
        shotId,
        dto.promptType,
        dto.promptText,
        dto.negativePrompt ?? null,
        dto.modelName ?? null,
        dto.stylePreset ?? null,
      ],
    );
    const result = await this.dataSource.query(
      `SELECT id FROM episode_shot_prompts WHERE shot_id = ? ORDER BY id DESC LIMIT 1`,
      [shotId],
    );
    return this.getOne(Number(result[0].id));
  }

  async update(id: number, dto: UpdateEpisodeShotPromptDto): Promise<Row> {
    const existing = await this.findById(id);
    if (!existing) {
      throw new NotFoundException(`Episode shot prompt ${id} not found`);
    }
    const updates: string[] = [];
    const values: unknown[] = [];
    if (dto.promptType !== undefined) {
      updates.push('prompt_type = ?');
      values.push(dto.promptType);
    }
    if (dto.promptText !== undefined) {
      updates.push('prompt_text = ?');
      values.push(dto.promptText);
    }
    if (dto.negativePrompt !== undefined) {
      updates.push('negative_prompt = ?');
      values.push(dto.negativePrompt);
    }
    if (dto.modelName !== undefined) {
      updates.push('model_name = ?');
      values.push(dto.modelName);
    }
    if (dto.stylePreset !== undefined) {
      updates.push('style_preset = ?');
      values.push(dto.stylePreset);
    }
    if (updates.length === 0) {
      return existing;
    }
    values.push(id);
    await this.dataSource.query(
      `UPDATE episode_shot_prompts SET ${updates.join(', ')} WHERE id = ?`,
      values,
    );
    return this.getOne(id);
  }

  async remove(id: number): Promise<{ ok: true }> {
    const existing = await this.findById(id);
    if (!existing) {
      throw new NotFoundException(`Episode shot prompt ${id} not found`);
    }
    await this.dataSource.query(
      `DELETE FROM episode_shot_prompts WHERE id = ?`,
      [id],
    );
    return { ok: true };
  }

  private async findById(id: number): Promise<Row | null> {
    const rows = await this.dataSource.query<Row[]>(
      `SELECT id, novel_id, shot_id, prompt_type, prompt_text, negative_prompt, model_name, style_preset, created_at, updated_at
       FROM episode_shot_prompts WHERE id = ? LIMIT 1`,
      [id],
    );
    return rows[0] ?? null;
  }

  private async assertShotExists(shotId: number): Promise<void> {
    const rows = await this.dataSource.query(
      `SELECT id FROM episode_shots WHERE id = ? LIMIT 1`,
      [shotId],
    );
    if (!rows.length) {
      throw new NotFoundException(`Episode shot ${shotId} not found`);
    }
  }

  private async getShotRow(shotId: number): Promise<Row | null> {
    const rows = await this.dataSource.query<Row[]>(
      `SELECT id, novel_id FROM episode_shots WHERE id = ? LIMIT 1`,
      [shotId],
    );
    return rows[0] ?? null;
  }
}
