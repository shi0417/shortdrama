import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import type {
  DramaticEvidencePack,
  EvidenceCharacter,
  EvidenceCore,
  EvidenceEpisode,
  EvidenceHookRhythm,
  EvidenceKeyNode,
  EvidenceOpponent,
  EvidencePayoffLine,
  EvidenceStoryPhase,
  EvidenceTimelineEvent,
} from './dto/material-sifting.dto';

@Injectable()
export class MaterialSiftingService {
  private readonly logger = new Logger(MaterialSiftingService.name);

  constructor(private readonly dataSource: DataSource) {}

  /**
   * 按集构建戏剧证据包：从多表查询并筛出本集相关的史料摘要、人物、对手、爽点线、阶段、钩子要求等。
   */
  async buildEvidencePack(
    novelId: number,
    episodeNumber: number,
  ): Promise<DramaticEvidencePack> {
    const [
      episodeRow,
      coreRows,
      characterRows,
      opponentRows,
      payoffRows,
      phaseRows,
      hookRows,
      keyNodeRows,
      timelineRows,
    ] = await Promise.all([
      this.getEpisode(novelId, episodeNumber),
      this.getCore(novelId),
      this.getCharacters(novelId),
      this.getOpponents(novelId),
      this.getPayoffLinesForEpisode(novelId, episodeNumber),
      this.getStoryPhasesForEpisode(novelId, episodeNumber),
      this.getHookRhythmForEpisode(novelId, episodeNumber),
      this.getKeyNodes(novelId),
      this.getTimelines(novelId),
    ]);

    const episode: EvidenceEpisode | null = episodeRow
      ? {
          episodeNumber: Number(episodeRow.episode_number),
          episodeTitle: episodeRow.episode_title as string | undefined,
          arc: episodeRow.arc as string | undefined,
          opening: episodeRow.opening as string | undefined,
          coreConflict: episodeRow.core_conflict as string | undefined,
          hooks: episodeRow.hooks as string | undefined,
          cliffhanger: episodeRow.cliffhanger as string | undefined,
          outlineContent: episodeRow.outline_content as string | undefined,
          historyOutline: episodeRow.history_outline as string | undefined,
          rewriteDiff: episodeRow.rewrite_diff as string | undefined,
        }
      : null;

    const core: EvidenceCore | null =
      coreRows && coreRows.length > 0
        ? {
            title: (coreRows[0] as Record<string, unknown>).title as string | undefined,
            coreText: (coreRows[0] as Record<string, unknown>).core_text as string | undefined,
            protagonistName: (coreRows[0] as Record<string, unknown>).protagonist_name as string | undefined,
            protagonistIdentity: (coreRows[0] as Record<string, unknown>).protagonist_identity as string | undefined,
            targetStory: (coreRows[0] as Record<string, unknown>).target_story as string | undefined,
            rewriteGoal: (coreRows[0] as Record<string, unknown>).rewrite_goal as string | undefined,
            constraintText: (coreRows[0] as Record<string, unknown>).constraint_text as string | undefined,
          }
        : null;

    const characters: EvidenceCharacter[] = (characterRows || []).map(
      (r: Record<string, unknown>) => ({
        name: String(r.name ?? ''),
        faction: r.faction as string | undefined,
        description: r.description as string | undefined,
        personality: r.personality as string | undefined,
      }),
    );

    const opponents: EvidenceOpponent[] = (opponentRows || []).map(
      (r: Record<string, unknown>) => ({
        levelName: r.level_name as string | undefined,
        opponentName: String(r.opponent_name ?? ''),
        threatType: r.threat_type as string | undefined,
        detailedDesc: r.detailed_desc as string | undefined,
        sortOrder: r.sort_order as number | undefined,
      }),
    );

    const payoffLines: EvidencePayoffLine[] = (payoffRows || []).map(
      (r: Record<string, unknown>) => ({
        lineKey: r.line_key as string | undefined,
        lineName: r.line_name as string | undefined,
        lineContent: r.line_content as string | undefined,
        startEp: r.start_ep as number | undefined,
        endEp: r.end_ep as number | undefined,
        stageText: r.stage_text as string | undefined,
        sortOrder: r.sort_order as number | undefined,
      }),
    );

    const storyPhases: EvidenceStoryPhase[] = (phaseRows || []).map(
      (r: Record<string, unknown>) => ({
        phaseName: r.phase_name as string | undefined,
        startEp: r.start_ep as number | undefined,
        endEp: r.end_ep as number | undefined,
        historicalPath: r.historical_path as string | undefined,
        rewritePath: r.rewrite_path as string | undefined,
        sortOrder: r.sort_order as number | undefined,
      }),
    );

    const hookRhythm: EvidenceHookRhythm | null =
      hookRows && hookRows.length > 0
        ? {
            episodeNumber: Number((hookRows[0] as Record<string, unknown>).episode_number),
            emotionLevel: (hookRows[0] as Record<string, unknown>).emotion_level as string | number | undefined,
            hookType: (hookRows[0] as Record<string, unknown>).hook_type as string | undefined,
            description: (hookRows[0] as Record<string, unknown>).description as string | undefined,
            cliffhanger: (hookRows[0] as Record<string, unknown>).cliffhanger as string | undefined,
          }
        : null;

    const keyNodes: EvidenceKeyNode[] = (keyNodeRows || []).map(
      (r: Record<string, unknown>) => ({
        category: r.category as string | undefined,
        title: r.title as string | undefined,
        description: r.description as string | undefined,
        timelineId: r.timeline_id as number | undefined,
        sortOrder: r.sort_order as number | undefined,
      }),
    );

    const timelineEvents: EvidenceTimelineEvent[] = (timelineRows || []).map(
      (r: Record<string, unknown>) => ({
        timeNode: r.time_node as string | undefined,
        event: r.event as string | undefined,
        sortOrder: r.sort_order as number | undefined,
      }),
    );

    const pack: DramaticEvidencePack = {
      novelId,
      episodeNumber,
      episode,
      core,
      characters,
      opponents,
      payoffLines,
      storyPhases,
      hookRhythm,
      keyNodes,
      timelineEvents,
    };

    this.logger.log(
      `[material-sifting] built pack novelId=${novelId} ep=${episodeNumber} characters=${characters.length} opponents=${opponents.length} payoffLines=${payoffLines.length} storyPhases=${storyPhases.length}`,
    );
    return pack;
  }

  private async getEpisode(
    novelId: number,
    episodeNumber: number,
  ): Promise<Record<string, unknown> | null> {
    const rows = await this.dataSource.query(
      `SELECT episode_number, episode_title, arc, opening, core_conflict, hooks, cliffhanger,
              outline_content, history_outline, rewrite_diff
       FROM novel_episodes
       WHERE novel_id = ? AND episode_number = ?
       LIMIT 1`,
      [novelId, episodeNumber],
    );
    const arr = Array.isArray(rows) ? rows : [rows];
    return (arr[0] as Record<string, unknown>) ?? null;
  }

  private async getCore(novelId: number): Promise<Record<string, unknown>[]> {
    const rows = await this.dataSource.query(
      `SELECT title, core_text, protagonist_name, protagonist_identity, target_story, rewrite_goal, constraint_text
       FROM set_core
       WHERE novel_id = ? AND is_active = 1
       ORDER BY version DESC, id DESC
       LIMIT 1`,
      [novelId],
    );
    return Array.isArray(rows) ? rows : [rows];
  }

  private async getCharacters(novelId: number): Promise<Record<string, unknown>[]> {
    const rows = await this.dataSource.query(
      `SELECT name, faction, description, personality
       FROM novel_characters
       WHERE novel_id = ?
       ORDER BY sort_order ASC, id ASC`,
      [novelId],
    );
    return Array.isArray(rows) ? rows : [];
  }

  private async getOpponents(novelId: number): Promise<Record<string, unknown>[]> {
    const rows = await this.dataSource.query(
      `SELECT level_name, opponent_name, threat_type, detailed_desc, sort_order
       FROM set_opponents
       WHERE novel_id = ?
       ORDER BY sort_order ASC, id ASC`,
      [novelId],
    );
    return Array.isArray(rows) ? rows : [];
  }

  private async getPayoffLinesForEpisode(
    novelId: number,
    episodeNumber: number,
  ): Promise<Record<string, unknown>[]> {
    const rows = await this.dataSource.query(
      `SELECT line_key, line_name, line_content, start_ep, end_ep, stage_text, sort_order
       FROM set_payoff_lines
       WHERE novel_id = ? AND start_ep <= ? AND end_ep >= ?
       ORDER BY sort_order ASC, id ASC`,
      [novelId, episodeNumber, episodeNumber],
    );
    return Array.isArray(rows) ? rows : [];
  }

  private async getStoryPhasesForEpisode(
    novelId: number,
    episodeNumber: number,
  ): Promise<Record<string, unknown>[]> {
    const rows = await this.dataSource.query(
      `SELECT phase_name, start_ep, end_ep, historical_path, rewrite_path, sort_order
       FROM set_story_phases
       WHERE novel_id = ? AND start_ep <= ? AND end_ep >= ?
       ORDER BY sort_order ASC, id ASC`,
      [novelId, episodeNumber, episodeNumber],
    );
    return Array.isArray(rows) ? rows : [];
  }

  private async getHookRhythmForEpisode(
    novelId: number,
    episodeNumber: number,
  ): Promise<Record<string, unknown>[]> {
    const rows = await this.dataSource.query(
      `SELECT episode_number, emotion_level, hook_type, description, cliffhanger
       FROM novel_hook_rhythm
       WHERE novel_id = ? AND episode_number = ?
       LIMIT 1`,
      [novelId, episodeNumber],
    );
    const arr = Array.isArray(rows) ? rows : [rows];
    return arr.filter(Boolean);
  }

  private async getKeyNodes(novelId: number): Promise<Record<string, unknown>[]> {
    const rows = await this.dataSource.query(
      `SELECT category, title, description, timeline_id, sort_order
       FROM novel_key_nodes
       WHERE novel_id = ?
       ORDER BY sort_order ASC, id ASC`,
      [novelId],
    );
    return Array.isArray(rows) ? rows : [];
  }

  private async getTimelines(novelId: number): Promise<Record<string, unknown>[]> {
    const rows = await this.dataSource.query(
      `SELECT time_node, event, sort_order
       FROM novel_timelines
       WHERE novel_id = ?
       ORDER BY sort_order ASC, id ASC`,
      [novelId],
    );
    return Array.isArray(rows) ? rows : [];
  }
}
