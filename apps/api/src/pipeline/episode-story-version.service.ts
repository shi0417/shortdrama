import { Injectable, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import {
  CreateEpisodeStoryVersionDto,
  UpdateEpisodeStoryVersionDto,
} from './dto/episode-story-version.dto';

type Row = Record<string, unknown>;

@Injectable()
export class EpisodeStoryVersionService {
  constructor(private readonly dataSource: DataSource) {}

  async listByNovel(novelId: number): Promise<Row[]> {
    await this.assertNovelExists(novelId);
    const rows = await this.dataSource.query<Row[]>(
      `SELECT id, novel_id, episode_number, source_episode_id, version_no, story_type, title, summary,
        story_text, story_beat_json, word_count, status, is_active, generation_source, notes, created_at, updated_at
       FROM episode_story_versions
       WHERE novel_id = ?
       ORDER BY episode_number ASC, version_no ASC, id ASC`,
      [novelId],
    );
    return rows;
  }

  async getByNovelAndEpisode(
    novelId: number,
    episodeNumber: number,
  ): Promise<Row[]> {
    await this.assertNovelExists(novelId);
    const rows = await this.dataSource.query<Row[]>(
      `SELECT id, novel_id, episode_number, source_episode_id, version_no, story_type, title, summary,
        story_text, story_beat_json, word_count, status, is_active, generation_source, notes, created_at, updated_at
       FROM episode_story_versions
       WHERE novel_id = ? AND episode_number = ?
       ORDER BY version_no ASC, id ASC`,
      [novelId, episodeNumber],
    );
    return rows;
  }

  async getActiveByNovelAndEpisode(
    novelId: number,
    episodeNumber: number,
  ): Promise<Row | null> {
    await this.assertNovelExists(novelId);
    const rows = await this.dataSource.query<Row[]>(
      `SELECT id, novel_id, episode_number, source_episode_id, version_no, story_type, title, summary,
        story_text, story_beat_json, word_count, status, is_active, generation_source, notes, created_at, updated_at
       FROM episode_story_versions
       WHERE novel_id = ? AND episode_number = ? AND is_active = 1
       LIMIT 1`,
      [novelId, episodeNumber],
    );
    return rows[0] ?? null;
  }

  async getOne(id: number): Promise<Row> {
    const row = await this.findById(id);
    if (!row) {
      throw new NotFoundException(`Episode story version ${id} not found`);
    }
    return row;
  }

  async create(
    novelId: number,
    dto: CreateEpisodeStoryVersionDto,
  ): Promise<Row> {
    await this.assertNovelExists(novelId);
    const versionNo =
      dto.versionNo ??
      (await this.getNextVersionNo(novelId, dto.episodeNumber));
    const isActive = dto.isActive ?? 1;
    if (isActive === 1) {
      await this.deactivateOthersForEpisode(novelId, dto.episodeNumber);
    }
    const wordCount =
      dto.wordCount != null ? dto.wordCount : (dto.storyText?.length ?? 0);
    const result = await this.dataSource.query(
      `INSERT INTO episode_story_versions (
        novel_id, episode_number, source_episode_id, version_no, story_type, title, summary,
        story_text, story_beat_json, word_count, status, is_active, generation_source, notes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        novelId,
        dto.episodeNumber,
        dto.sourceEpisodeId ?? null,
        versionNo,
        dto.storyType,
        dto.title,
        dto.summary ?? null,
        dto.storyText,
        dto.storyBeatJson != null ? JSON.stringify(dto.storyBeatJson) : null,
        wordCount,
        dto.status ?? 'draft',
        isActive,
        dto.generationSource ?? 'ai',
        dto.notes ?? null,
      ],
    );
    return this.getOne(Number(result.insertId));
  }

  async update(id: number, dto: UpdateEpisodeStoryVersionDto): Promise<Row> {
    const existing = await this.findById(id);
    if (!existing) {
      throw new NotFoundException(`Episode story version ${id} not found`);
    }
    const novelId = Number(existing.novel_id);
    const episodeNumber = Number(existing.episode_number);
    if (dto.isActive === 1) {
      await this.deactivateOthersForEpisode(novelId, episodeNumber);
    }
    const updates: string[] = [];
    const values: unknown[] = [];
    if (dto.sourceEpisodeId !== undefined) {
      updates.push('source_episode_id = ?');
      values.push(dto.sourceEpisodeId);
    }
    if (dto.versionNo !== undefined) {
      updates.push('version_no = ?');
      values.push(dto.versionNo);
    }
    if (dto.storyType !== undefined) {
      updates.push('story_type = ?');
      values.push(dto.storyType);
    }
    if (dto.title !== undefined) {
      updates.push('title = ?');
      values.push(dto.title);
    }
    if (dto.summary !== undefined) {
      updates.push('summary = ?');
      values.push(dto.summary);
    }
    if (dto.storyText !== undefined) {
      updates.push('story_text = ?');
      values.push(dto.storyText);
    }
    if (dto.storyBeatJson !== undefined) {
      updates.push('story_beat_json = ?');
      values.push(
        typeof dto.storyBeatJson === 'string'
          ? dto.storyBeatJson
          : JSON.stringify(dto.storyBeatJson),
      );
    }
    if (dto.wordCount !== undefined) {
      updates.push('word_count = ?');
      values.push(dto.wordCount);
    }
    if (dto.status !== undefined) {
      updates.push('status = ?');
      values.push(dto.status);
    }
    if (dto.isActive !== undefined) {
      updates.push('is_active = ?');
      values.push(dto.isActive);
    }
    if (dto.generationSource !== undefined) {
      updates.push('generation_source = ?');
      values.push(dto.generationSource);
    }
    if (dto.notes !== undefined) {
      updates.push('notes = ?');
      values.push(dto.notes);
    }
    if (updates.length === 0) {
      return existing;
    }
    values.push(id);
    await this.dataSource.query(
      `UPDATE episode_story_versions SET ${updates.join(', ')} WHERE id = ?`,
      values,
    );
    return this.getOne(id);
  }

  async setActive(id: number): Promise<Row> {
    const existing = await this.findById(id);
    if (!existing) {
      throw new NotFoundException(`Episode story version ${id} not found`);
    }
    const novelId = Number(existing.novel_id);
    const episodeNumber = Number(existing.episode_number);
    await this.dataSource.transaction(async (manager) => {
      await manager.query(
        `UPDATE episode_story_versions SET is_active = 0 WHERE novel_id = ? AND episode_number = ?`,
        [novelId, episodeNumber],
      );
      await manager.query(
        `UPDATE episode_story_versions SET is_active = 1 WHERE id = ?`,
        [id],
      );
    });
    return this.getOne(id);
  }

  async remove(id: number): Promise<{ ok: true }> {
    const existing = await this.findById(id);
    if (!existing) {
      throw new NotFoundException(`Episode story version ${id} not found`);
    }
    await this.dataSource.query(
      `DELETE FROM episode_story_versions WHERE id = ?`,
      [id],
    );
    return { ok: true };
  }

  private async findById(id: number): Promise<Row | null> {
    const rows = await this.dataSource.query<Row[]>(
      `SELECT id, novel_id, episode_number, source_episode_id, version_no, story_type, title, summary,
        story_text, story_beat_json, word_count, status, is_active, generation_source, notes, created_at, updated_at
       FROM episode_story_versions WHERE id = ? LIMIT 1`,
      [id],
    );
    return rows[0] ?? null;
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

  private async getNextVersionNo(
    novelId: number,
    episodeNumber: number,
  ): Promise<number> {
    const rows = await this.dataSource.query<Row[]>(
      `SELECT COALESCE(MAX(version_no), 0) + 1 AS next FROM episode_story_versions WHERE novel_id = ? AND episode_number = ?`,
      [novelId, episodeNumber],
    );
    return Number(rows[0]?.next ?? 1);
  }

  private async deactivateOthersForEpisode(
    novelId: number,
    episodeNumber: number,
  ): Promise<void> {
    await this.dataSource.query(
      `UPDATE episode_story_versions SET is_active = 0 WHERE novel_id = ? AND episode_number = ?`,
      [novelId, episodeNumber],
    );
  }
}
