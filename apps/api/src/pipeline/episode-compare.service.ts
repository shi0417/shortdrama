import { Injectable, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { EpisodeCompareResponseDto, EpisodeCompareRowDto } from './dto/episode-compare.dto';

@Injectable()
export class EpisodeCompareService {
  constructor(private readonly dataSource: DataSource) {}

  async getByNovel(novelId: number): Promise<EpisodeCompareResponseDto> {
    await this.assertNovelExists(novelId);

    const [episodes, structureTemplates, hookRhythm] = await Promise.all([
      this.dataSource.query(
        `SELECT id, novel_id, episode_number, episode_title, arc, opening, core_conflict, hooks, cliffhanger,
                full_content, outline_content, history_outline, rewrite_diff, structure_template_id, sort_order, created_at
         FROM novel_episodes
         WHERE novel_id = ?
         ORDER BY episode_number ASC, id ASC`,
        [novelId],
      ),
      this.dataSource.query(
        `SELECT id, novels_id, chapter_id, power_level, is_power_up_chapter, power_up_content, theme_type,
                structure_name, identity_gap, pressure_source, first_reverse, continuous_upgrade, suspense_hook,
                typical_opening, suitable_theme, hot_level, remarks, create_time
         FROM drama_structure_template
         WHERE novels_id = ?
         ORDER BY chapter_id ASC, id ASC`,
        [novelId],
      ),
      this.queryHookRhythmIfExists(novelId),
    ]);

    const episodeMap = new Map<number, Record<string, unknown>>();
    for (const row of episodes as Array<Record<string, unknown>>) {
      const key = Number(row.episode_number);
      if (!episodeMap.has(key)) episodeMap.set(key, row);
    }

    const structureMap = new Map<number, Record<string, unknown>>();
    for (const row of structureTemplates as Array<Record<string, unknown>>) {
      const key = Number(row.chapter_id);
      if (!structureMap.has(key)) structureMap.set(key, row);
    }

    const hookMap = new Map<number, Record<string, unknown>>();
    for (const row of hookRhythm as Array<Record<string, unknown>>) {
      const key = Number(row.episode_number);
      if (!hookMap.has(key)) hookMap.set(key, row);
    }

    const allKeys = new Set<number>([
      ...episodeMap.keys(),
      ...structureMap.keys(),
      ...hookMap.keys(),
    ]);
    const sortedKeys = [...allKeys].sort((a, b) => a - b);

    const rows: EpisodeCompareRowDto[] = sortedKeys.map((episodeKey) => ({
      episodeKey,
      episode: episodeMap.get(episodeKey) || null,
      structureTemplate: structureMap.get(episodeKey) || null,
      hookRhythm: hookMap.get(episodeKey) || null,
    }));

    return { novelId, rows };
  }

  private async queryHookRhythmIfExists(
    novelId: number,
  ): Promise<Array<Record<string, unknown>>> {
    const tableRows = await this.dataSource.query(
      `SELECT COUNT(*) AS cnt
       FROM information_schema.tables
       WHERE table_schema = DATABASE() AND table_name = 'novel_hook_rhythm'`,
      [],
    );
    const exists = Number(tableRows?.[0]?.cnt || 0) > 0;
    if (!exists) return [];

    return this.dataSource.query(
      `SELECT id, novel_id, episode_number, emotion_level, hook_type, description, cliffhanger, created_at
       FROM novel_hook_rhythm
       WHERE novel_id = ?
       ORDER BY episode_number ASC, id ASC`,
      [novelId],
    );
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
}
