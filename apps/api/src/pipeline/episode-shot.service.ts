import { Injectable, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { CreateEpisodeShotDto, UpdateEpisodeShotDto } from './dto/episode-shot.dto';

type Row = Record<string, unknown>;

@Injectable()
export class EpisodeShotService {
  constructor(private readonly dataSource: DataSource) {}

  async listByScene(sceneId: number): Promise<Row[]> {
    await this.assertSceneExists(sceneId);
    const rows = await this.dataSource.query<Row[]>(
      `SELECT id, novel_id, script_version_id, scene_id, episode_number, shot_no, shot_type, visual_desc, narrator_text, dialogue_text, subtitle_text, duration_sec, camera_movement, emotion_tag, sort_order, created_at, updated_at
       FROM episode_shots
       WHERE scene_id = ?
       ORDER BY sort_order ASC, shot_no ASC, id ASC`,
      [sceneId],
    );
    return rows;
  }

  async getOne(id: number): Promise<Row> {
    const row = await this.findById(id);
    if (!row) {
      throw new NotFoundException(`Episode shot ${id} not found`);
    }
    return row;
  }

  async create(sceneId: number, dto: CreateEpisodeShotDto): Promise<Row> {
    const scene = await this.getSceneRow(sceneId);
    if (!scene) {
      throw new NotFoundException(`Episode scene ${sceneId} not found`);
    }
    const novelId = Number(scene.novel_id);
    const scriptVersionId = Number(scene.script_version_id);
    const episodeNumber = Number(scene.episode_number);
    const sortOrder = dto.sortOrder ?? dto.shotNo;
    await this.dataSource.query(
      `INSERT INTO episode_shots (
        novel_id, script_version_id, scene_id, episode_number, shot_no, shot_type, visual_desc, narrator_text, dialogue_text, subtitle_text, duration_sec, camera_movement, emotion_tag, sort_order
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        novelId,
        scriptVersionId,
        sceneId,
        episodeNumber,
        dto.shotNo,
        dto.shotType ?? null,
        dto.visualDesc,
        dto.narratorText ?? null,
        dto.dialogueText ?? null,
        dto.subtitleText ?? null,
        dto.durationSec ?? 3,
        dto.cameraMovement ?? null,
        dto.emotionTag ?? null,
        sortOrder,
      ],
    );
    const result = await this.dataSource.query(
      `SELECT id FROM episode_shots WHERE scene_id = ? ORDER BY id DESC LIMIT 1`,
      [sceneId],
    );
    return this.getOne(Number(result[0].id));
  }

  async update(id: number, dto: UpdateEpisodeShotDto): Promise<Row> {
    const existing = await this.findById(id);
    if (!existing) {
      throw new NotFoundException(`Episode shot ${id} not found`);
    }
    const updates: string[] = [];
    const values: unknown[] = [];
    if (dto.shotNo !== undefined) {
      updates.push('shot_no = ?');
      values.push(dto.shotNo);
    }
    if (dto.shotType !== undefined) {
      updates.push('shot_type = ?');
      values.push(dto.shotType);
    }
    if (dto.visualDesc !== undefined) {
      updates.push('visual_desc = ?');
      values.push(dto.visualDesc);
    }
    if (dto.narratorText !== undefined) {
      updates.push('narrator_text = ?');
      values.push(dto.narratorText);
    }
    if (dto.dialogueText !== undefined) {
      updates.push('dialogue_text = ?');
      values.push(dto.dialogueText);
    }
    if (dto.subtitleText !== undefined) {
      updates.push('subtitle_text = ?');
      values.push(dto.subtitleText);
    }
    if (dto.durationSec !== undefined) {
      updates.push('duration_sec = ?');
      values.push(dto.durationSec);
    }
    if (dto.cameraMovement !== undefined) {
      updates.push('camera_movement = ?');
      values.push(dto.cameraMovement);
    }
    if (dto.emotionTag !== undefined) {
      updates.push('emotion_tag = ?');
      values.push(dto.emotionTag);
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
      `UPDATE episode_shots SET ${updates.join(', ')} WHERE id = ?`,
      values,
    );
    return this.getOne(id);
  }

  async remove(id: number): Promise<{ ok: true }> {
    const existing = await this.findById(id);
    if (!existing) {
      throw new NotFoundException(`Episode shot ${id} not found`);
    }
    await this.dataSource.query(`DELETE FROM episode_shots WHERE id = ?`, [
      id,
    ]);
    return { ok: true };
  }

  private async findById(id: number): Promise<Row | null> {
    const rows = await this.dataSource.query<Row[]>(
      `SELECT id, novel_id, script_version_id, scene_id, episode_number, shot_no, shot_type, visual_desc, narrator_text, dialogue_text, subtitle_text, duration_sec, camera_movement, emotion_tag, sort_order, created_at, updated_at
       FROM episode_shots WHERE id = ? LIMIT 1`,
      [id],
    );
    return rows[0] ?? null;
  }

  private async assertSceneExists(sceneId: number): Promise<void> {
    const rows = await this.dataSource.query(
      `SELECT id FROM episode_scenes WHERE id = ? LIMIT 1`,
      [sceneId],
    );
    if (!rows.length) {
      throw new NotFoundException(`Episode scene ${sceneId} not found`);
    }
  }

  private async getSceneRow(sceneId: number): Promise<Row | null> {
    const rows = await this.dataSource.query<Row[]>(
      `SELECT id, novel_id, script_version_id, episode_number FROM episode_scenes WHERE id = ? LIMIT 1`,
      [sceneId],
    );
    return rows[0] ?? null;
  }
}
