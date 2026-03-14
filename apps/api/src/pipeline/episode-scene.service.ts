import { Injectable, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import {
  CreateEpisodeSceneDto,
  UpdateEpisodeSceneDto,
} from './dto/episode-scene.dto';

type Row = Record<string, unknown>;

@Injectable()
export class EpisodeSceneService {
  constructor(private readonly dataSource: DataSource) {}

  async listByScriptVersion(scriptVersionId: number): Promise<Row[]> {
    await this.assertScriptVersionExists(scriptVersionId);
    const rows = await this.dataSource.query<Row[]>(
      `SELECT id, novel_id, script_version_id, episode_number, scene_no, scene_title, location_name, scene_summary, main_conflict, narrator_text, screen_subtitle, estimated_seconds, sort_order, created_at, updated_at
       FROM episode_scenes
       WHERE script_version_id = ?
       ORDER BY sort_order ASC, scene_no ASC, id ASC`,
      [scriptVersionId],
    );
    return rows;
  }

  async getOne(id: number): Promise<Row> {
    const row = await this.findById(id);
    if (!row) {
      throw new NotFoundException(`Episode scene ${id} not found`);
    }
    return row;
  }

  async create(
    scriptVersionId: number,
    dto: CreateEpisodeSceneDto,
  ): Promise<Row> {
    const version = await this.getScriptVersionRow(scriptVersionId);
    if (!version) {
      throw new NotFoundException(
        `Episode script version ${scriptVersionId} not found`,
      );
    }
    const novelId = Number(version.novel_id);
    const episodeNumber = Number(version.episode_number);
    const sortOrder = dto.sortOrder ?? dto.sceneNo;
    await this.dataSource.query(
      `INSERT INTO episode_scenes (
        novel_id, script_version_id, episode_number, scene_no, scene_title, location_name, scene_summary, main_conflict, narrator_text, screen_subtitle, estimated_seconds, sort_order
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        novelId,
        scriptVersionId,
        episodeNumber,
        dto.sceneNo,
        dto.sceneTitle,
        dto.locationName ?? null,
        dto.sceneSummary ?? null,
        dto.mainConflict ?? null,
        dto.narratorText ?? null,
        dto.screenSubtitle ?? null,
        dto.estimatedSeconds ?? 10,
        sortOrder,
      ],
    );
    const result = await this.dataSource.query(
      `SELECT id FROM episode_scenes WHERE script_version_id = ? ORDER BY id DESC LIMIT 1`,
      [scriptVersionId],
    );
    return this.getOne(Number(result[0].id));
  }

  async update(id: number, dto: UpdateEpisodeSceneDto): Promise<Row> {
    const existing = await this.findById(id);
    if (!existing) {
      throw new NotFoundException(`Episode scene ${id} not found`);
    }
    const updates: string[] = [];
    const values: unknown[] = [];
    if (dto.sceneNo !== undefined) {
      updates.push('scene_no = ?');
      values.push(dto.sceneNo);
    }
    if (dto.sceneTitle !== undefined) {
      updates.push('scene_title = ?');
      values.push(dto.sceneTitle);
    }
    if (dto.locationName !== undefined) {
      updates.push('location_name = ?');
      values.push(dto.locationName);
    }
    if (dto.sceneSummary !== undefined) {
      updates.push('scene_summary = ?');
      values.push(dto.sceneSummary);
    }
    if (dto.mainConflict !== undefined) {
      updates.push('main_conflict = ?');
      values.push(dto.mainConflict);
    }
    if (dto.narratorText !== undefined) {
      updates.push('narrator_text = ?');
      values.push(dto.narratorText);
    }
    if (dto.screenSubtitle !== undefined) {
      updates.push('screen_subtitle = ?');
      values.push(dto.screenSubtitle);
    }
    if (dto.estimatedSeconds !== undefined) {
      updates.push('estimated_seconds = ?');
      values.push(dto.estimatedSeconds);
    }
    if (dto.sortOrder !== undefined) {
      updates.push('sort_order = ?');
      values.push(dto.sortOrder);
    }
    if (updates.length === 0) {
      return existing;
    }
    values.push(id);
    await this.dataSource.query(
      `UPDATE episode_scenes SET ${updates.join(', ')} WHERE id = ?`,
      values,
    );
    return this.getOne(id);
  }

  async remove(id: number): Promise<{ ok: true }> {
    const existing = await this.findById(id);
    if (!existing) {
      throw new NotFoundException(`Episode scene ${id} not found`);
    }
    await this.dataSource.query(`DELETE FROM episode_scenes WHERE id = ?`, [
      id,
    ]);
    return { ok: true };
  }

  private async findById(id: number): Promise<Row | null> {
    const rows = await this.dataSource.query<Row[]>(
      `SELECT id, novel_id, script_version_id, episode_number, scene_no, scene_title, location_name, scene_summary, main_conflict, narrator_text, screen_subtitle, estimated_seconds, sort_order, created_at, updated_at
       FROM episode_scenes WHERE id = ? LIMIT 1`,
      [id],
    );
    return rows[0] ?? null;
  }

  private async assertScriptVersionExists(
    scriptVersionId: number,
  ): Promise<void> {
    const rows = await this.dataSource.query(
      `SELECT id FROM episode_script_versions WHERE id = ? LIMIT 1`,
      [scriptVersionId],
    );
    if (!rows.length) {
      throw new NotFoundException(
        `Episode script version ${scriptVersionId} not found`,
      );
    }
  }

  private async getScriptVersionRow(
    scriptVersionId: number,
  ): Promise<Row | null> {
    const rows = await this.dataSource.query<Row[]>(
      `SELECT id, novel_id, episode_number FROM episode_script_versions WHERE id = ? LIMIT 1`,
      [scriptVersionId],
    );
    return rows[0] ?? null;
  }
}
