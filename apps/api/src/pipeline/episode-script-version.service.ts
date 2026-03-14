import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import {
  CreateEpisodeScriptVersionDto,
  UpdateEpisodeScriptVersionDto,
} from './dto/episode-script-version.dto';

type Row = Record<string, unknown>;

@Injectable()
export class EpisodeScriptVersionService {
  constructor(private readonly dataSource: DataSource) {}

  async listByNovel(novelId: number): Promise<Row[]> {
    await this.assertNovelExists(novelId);
    const rows = await this.dataSource.query<Row[]>(
      `SELECT id, novel_id, episode_number, source_episode_id, version_no, script_type, title, summary, status, is_active, created_at, updated_at
       FROM episode_script_versions
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
      `SELECT id, novel_id, episode_number, source_episode_id, version_no, script_type, title, summary, status, is_active, created_at, updated_at
       FROM episode_script_versions
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
      `SELECT id, novel_id, episode_number, source_episode_id, version_no, script_type, title, summary, status, is_active, created_at, updated_at
       FROM episode_script_versions
       WHERE novel_id = ? AND episode_number = ? AND is_active = 1
       LIMIT 1`,
      [novelId, episodeNumber],
    );
    return rows[0] ?? null;
  }

  /**
   * List active script versions per episode with scene/shot/prompt counts for list page.
   */
  async listSummaryByNovel(novelId: number): Promise<Row[]> {
    await this.assertNovelExists(novelId);
    const rows = await this.dataSource.query<Row[]>(
      `SELECT v.id, v.novel_id, v.episode_number, v.version_no, v.script_type, v.title, v.is_active,
        (SELECT COUNT(*) FROM episode_scenes s WHERE s.script_version_id = v.id) AS scene_count,
        (SELECT COUNT(*) FROM episode_shots sh WHERE sh.script_version_id = v.id) AS shot_count,
        (SELECT COUNT(*) FROM episode_shot_prompts p INNER JOIN episode_shots sh ON p.shot_id = sh.id WHERE sh.script_version_id = v.id) AS prompt_count
       FROM episode_script_versions v
       WHERE v.novel_id = ? AND v.is_active = 1
       ORDER BY v.episode_number ASC`,
      [novelId],
    );
    return rows;
  }

  async getOne(id: number): Promise<Row> {
    const row = await this.findById(id);
    if (!row) {
      throw new NotFoundException(`Episode script version ${id} not found`);
    }
    return row;
  }

  async create(
    novelId: number,
    dto: CreateEpisodeScriptVersionDto,
  ): Promise<Row> {
    await this.assertNovelExists(novelId);
    const versionNo =
      dto.versionNo ??
      (await this.getNextVersionNo(novelId, dto.episodeNumber));
    const isActive = dto.isActive ?? 1;
    if (isActive === 1) {
      await this.deactivateOthersForEpisode(novelId, dto.episodeNumber);
    }
    const result = await this.dataSource.query(
      `INSERT INTO episode_script_versions (
        novel_id, episode_number, source_episode_id, version_no, script_type, title, summary, status, is_active
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        novelId,
        dto.episodeNumber,
        dto.sourceEpisodeId ?? null,
        versionNo,
        dto.scriptType,
        dto.title,
        dto.summary ?? null,
        dto.status ?? 'draft',
        isActive,
      ],
    );
    return this.getOne(Number(result.insertId));
  }

  async update(id: number, dto: UpdateEpisodeScriptVersionDto): Promise<Row> {
    const existing = await this.findById(id);
    if (!existing) {
      throw new NotFoundException(`Episode script version ${id} not found`);
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
    if (dto.scriptType !== undefined) {
      updates.push('script_type = ?');
      values.push(dto.scriptType);
    }
    if (dto.title !== undefined) {
      updates.push('title = ?');
      values.push(dto.title);
    }
    if (dto.summary !== undefined) {
      updates.push('summary = ?');
      values.push(dto.summary);
    }
    if (dto.status !== undefined) {
      updates.push('status = ?');
      values.push(dto.status);
    }
    if (dto.isActive !== undefined) {
      updates.push('is_active = ?');
      values.push(dto.isActive);
    }
    if (updates.length === 0) {
      return existing;
    }
    values.push(id);
    await this.dataSource.query(
      `UPDATE episode_script_versions SET ${updates.join(', ')} WHERE id = ?`,
      values,
    );
    return this.getOne(id);
  }

  async setActive(id: number): Promise<Row> {
    const existing = await this.findById(id);
    if (!existing) {
      throw new NotFoundException(`Episode script version ${id} not found`);
    }
    const novelId = Number(existing.novel_id);
    const episodeNumber = Number(existing.episode_number);
    await this.dataSource.transaction(async (manager) => {
      await manager.query(
        `UPDATE episode_script_versions SET is_active = 0 WHERE novel_id = ? AND episode_number = ?`,
        [novelId, episodeNumber],
      );
      await manager.query(
        `UPDATE episode_script_versions SET is_active = 1 WHERE id = ?`,
        [id],
      );
    });
    return this.getOne(id);
  }

  async remove(id: number): Promise<{ ok: true }> {
    const existing = await this.findById(id);
    if (!existing) {
      throw new NotFoundException(`Episode script version ${id} not found`);
    }
    await this.dataSource.query(
      `DELETE FROM episode_script_versions WHERE id = ?`,
      [id],
    );
    return { ok: true };
  }

  private async findById(id: number): Promise<Row | null> {
    const rows = await this.dataSource.query<Row[]>(
      `SELECT id, novel_id, episode_number, source_episode_id, version_no, script_type, title, summary, status, is_active, created_at, updated_at
       FROM episode_script_versions WHERE id = ? LIMIT 1`,
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
      `SELECT COALESCE(MAX(version_no), 0) + 1 AS next FROM episode_script_versions WHERE novel_id = ? AND episode_number = ?`,
      [novelId, episodeNumber],
    );
    return Number(rows[0]?.next ?? 1);
  }

  private async deactivateOthersForEpisode(
    novelId: number,
    episodeNumber: number,
  ): Promise<void> {
    await this.dataSource.query(
      `UPDATE episode_script_versions SET is_active = 0 WHERE novel_id = ? AND episode_number = ?`,
      [novelId, episodeNumber],
    );
  }
}
