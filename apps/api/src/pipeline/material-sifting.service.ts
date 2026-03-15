import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import type {
  CharacterContext,
  DramaticEvidencePack,
  EvidenceCharacter,
  EvidenceCore,
  EvidenceEpisode,
  EvidenceHookRhythm,
  EvidenceKeyNode,
  EvidenceOpponent,
  EvidencePayoffLine,
  EvidencePowerLevel,
  EvidenceStoryPhase,
  EvidenceTimelineEvent,
  GlobalContext,
  PlotlineContext,
  SourceMaterialContext,
  TemporalContext,
} from './dto/material-sifting.dto';

const SOURCE_EXCERPT_MAX_CHARS = 10000;

@Injectable()
export class MaterialSiftingService {
  private readonly logger = new Logger(MaterialSiftingService.name);

  constructor(private readonly dataSource: DataSource) {}

  /**
   * 按集构建戏剧证据包：分步查询 global_context、temporal_context、character_context、
   * plotline_context、source_material_context，并组装成 DramaticEvidencePack。
   */
  async buildEvidencePack(
    novelId: number,
    episodeNumber: number,
  ): Promise<DramaticEvidencePack> {
    // 1. global_context: set_core -> rewrite_goal, protagonist_name, core_constraint (constraint_text)
    const globalContext = await this.fetchGlobalContext(novelId);

    // 2. temporal_context: current_story_phase, current_power_level, current_timeline_events
    const temporalContext = await this.fetchTemporalContext(novelId, episodeNumber);

    // 3. character_context: protagonist_status (characters + outline_content -> immediate_goal), active_opponents
    const characterContext = await this.fetchCharacterContext(
      novelId,
      episodeNumber,
      globalContext.protagonistName,
    );

    // 4. plotline_context: active_payoff_lines, required_hook_rhythm
    const plotlineContext = await this.fetchPlotlineContext(novelId, episodeNumber);

    // 5. source_material_context: 初期简化版 — drama_source_text 前 10000 字
    const sourceMaterialContext = await this.fetchSourceMaterialContext(novelId);

    // 兼容用：本集 episode、core、characters、opponents、keyNodes、timelineEvents（从已有查询结果拼）
    const episode = await this.getEpisode(novelId, episodeNumber);
    const coreRows = await this.getCore(novelId);
    const characterRows = await this.getCharacters(novelId);
    const opponentRows = await this.getActiveOpponents(novelId);
    const keyNodeRows = await this.getKeyNodes(novelId);
    const timelineRows = await this.getTimelines(novelId);

    const evidenceEpisode: EvidenceEpisode | null = episode
      ? this.mapEpisode(episode)
      : null;
    const core = this.mapCore(coreRows);
    const characters = this.mapCharacters(characterRows);
    const opponents = this.mapOpponents(opponentRows);
    const payoffLines = plotlineContext.activePayoffLines;
    const storyPhaseRows = await this.getStoryPhasesForEpisode(novelId, episodeNumber);
    const storyPhases = storyPhaseRows.map((r) => this.mapStoryPhase(r));
    const hookRhythm = plotlineContext.requiredHookRhythm;
    const keyNodes = this.mapKeyNodes(keyNodeRows);
    const timelineEvents = this.mapTimelineEvents(timelineRows);

    const pack: DramaticEvidencePack = {
      novelId,
      episodeNumber,
      globalContext,
      temporalContext,
      characterContext,
      plotlineContext,
      sourceMaterialContext,
      episode: evidenceEpisode,
      core,
      characters,
      opponents,
      payoffLines,
      storyPhases,
      hookRhythm,
      keyNodes,
      timelineEvents,
      sourceSummary: sourceMaterialContext.excerpt,
    };

    this.logger.log(
      `[material-sifting] built pack novelId=${novelId} ep=${episodeNumber} ` +
        `globalContext=${!!globalContext.rewriteGoal} temporalPhase=${!!temporalContext.currentStoryPhase} ` +
        `protagonist=${!!characterContext.protagonistStatus} activeOpponents=${characterContext.activeOpponents.length} ` +
        `payoffLines=${plotlineContext.activePayoffLines.length} sourceLen=${sourceMaterialContext.excerpt?.length ?? 0}`,
    );
    return pack;
  }

  /** 1. global_context: set_core -> rewrite_goal, protagonist_name, core_constraint (constraint_text) */
  private async fetchGlobalContext(novelId: number): Promise<GlobalContext> {
    const rows = await this.dataSource.query(
      `SELECT rewrite_goal, protagonist_name, constraint_text
       FROM set_core
       WHERE novel_id = ? AND is_active = 1
       ORDER BY version DESC, id DESC
       LIMIT 1`,
      [novelId],
    );
    const r = Array.isArray(rows) ? rows[0] : rows;
    if (!r || typeof r !== 'object') {
      return { rewriteGoal: undefined, protagonistName: undefined, coreConstraint: undefined };
    }
    const row = r as Record<string, unknown>;
    return {
      rewriteGoal: row.rewrite_goal as string | undefined,
      protagonistName: row.protagonist_name as string | undefined,
      coreConstraint: row.constraint_text as string | undefined,
    };
  }

  /** 2. temporal_context: current_story_phase, current_power_level, current_timeline_events */
  private async fetchTemporalContext(
    novelId: number,
    episodeNumber: number,
  ): Promise<TemporalContext> {
    const [phaseRows, powerRows, timelineRows] = await Promise.all([
      this.dataSource.query(
        `SELECT phase_name, start_ep, end_ep, historical_path, rewrite_path, sort_order
         FROM set_story_phases
         WHERE novel_id = ? AND ? BETWEEN start_ep AND end_ep
         ORDER BY sort_order ASC, id ASC
         LIMIT 1`,
        [novelId, episodeNumber],
      ),
      this.dataSource.query(
        `SELECT level_no, level_title, identity_desc, ability_boundary, start_ep, end_ep, sort_order
         FROM set_power_ladder
         WHERE novel_id = ? AND ? BETWEEN start_ep AND end_ep
         ORDER BY sort_order ASC, id ASC
         LIMIT 1`,
        [novelId, episodeNumber],
      ),
      this.getTimelines(novelId),
    ]);

    const currentStoryPhase =
      Array.isArray(phaseRows) && phaseRows.length > 0
        ? this.mapStoryPhase(phaseRows[0] as Record<string, unknown>)
        : null;

    const currentPowerLevel: EvidencePowerLevel | null =
      Array.isArray(powerRows) && powerRows.length > 0
        ? this.mapPowerLevel(powerRows[0] as Record<string, unknown>)
        : null;

    const currentTimelineEvents = this.mapTimelineEvents(timelineRows);
    return {
      currentStoryPhase,
      currentPowerLevel,
      currentTimelineEvents,
    };
  }

  /** 3. character_context: protagonist_status (characters + outline -> immediate_goal), active_opponents */
  private async fetchCharacterContext(
    novelId: number,
    episodeNumber: number,
    protagonistName?: string,
  ): Promise<CharacterContext> {
    const [characterRows, episodeRow, opponentRows] = await Promise.all([
      this.getCharacters(novelId),
      this.getEpisode(novelId, episodeNumber),
      this.getActiveOpponents(novelId),
    ]);

    const characters = this.mapCharacters(characterRows);
    const outlineContent = episodeRow
      ? (episodeRow.outline_content as string | undefined)
      : undefined;
    const immediateGoal =
      typeof outlineContent === 'string' && outlineContent.trim()
        ? outlineContent.trim().slice(0, 2000)
        : undefined;

    const protagonistStatus = (() => {
      if (!protagonistName || !characters.length) return null;
      const name = String(protagonistName).trim();
      const found = characters.find(
        (c) => c.name === name || c.name?.includes(name) || name.includes(c.name ?? ''),
      );
      if (!found) return null;
      return { ...found, immediateGoal };
    })();

    const activeOpponents = this.mapOpponents(opponentRows);
    return {
      protagonistStatus,
      activeOpponents,
    };
  }

  /** 4. plotline_context: active_payoff_lines (BETWEEN), required_hook_rhythm */
  private async fetchPlotlineContext(
    novelId: number,
    episodeNumber: number,
  ): Promise<PlotlineContext> {
    const [payoffRows, hookRows] = await Promise.all([
      this.dataSource.query(
        `SELECT line_key, line_name, line_content, start_ep, end_ep, stage_text, sort_order
         FROM set_payoff_lines
         WHERE novel_id = ? AND ? BETWEEN start_ep AND end_ep
         ORDER BY sort_order ASC, id ASC`,
        [novelId, episodeNumber],
      ),
      this.dataSource.query(
        `SELECT episode_number, emotion_level, hook_type, description, cliffhanger
         FROM novel_hook_rhythm
         WHERE novel_id = ? AND episode_number = ?
         LIMIT 1`,
        [novelId, episodeNumber],
      ),
    ]);

    const activePayoffLines = (Array.isArray(payoffRows) ? payoffRows : []).map(
      (r) => this.mapPayoffLine(r as Record<string, unknown>),
    );
    const requiredHookRhythm: EvidenceHookRhythm | null =
      Array.isArray(hookRows) && hookRows.length > 0
        ? this.mapHookRhythm(hookRows[0] as Record<string, unknown>)
        : null;

    return {
      activePayoffLines,
      requiredHookRhythm,
    };
  }

  /** 5. source_material_context: 初期简化 — drama_source_text 前 10000 字（表用 novels_id，列用 source_text） */
  private async fetchSourceMaterialContext(
    novelId: number,
  ): Promise<SourceMaterialContext> {
    const hasTable = await this.dataSource
      .query(
        `SELECT 1 FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = 'drama_source_text' LIMIT 1`,
      )
      .then((r) => Array.isArray(r) && r.length > 0);
    if (!hasTable) return { excerpt: undefined };

    const rows = await this.dataSource.query(
      `SELECT source_text AS content FROM drama_source_text WHERE novels_id = ? ORDER BY id ASC LIMIT 1`,
      [novelId],
    );
    const r = Array.isArray(rows) ? rows[0] : rows;
    const content = r && typeof r === 'object' ? (r as Record<string, unknown>).content : null;
    const text = typeof content === 'string' ? content : '';
    const excerpt =
      text.length > SOURCE_EXCERPT_MAX_CHARS
        ? text.slice(0, SOURCE_EXCERPT_MAX_CHARS) + '…'
        : text || undefined;
    return { excerpt };
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

  /** active_opponents: set_opponents WHERE opponent_matrix_id = (SELECT id FROM set_opponent_matrix WHERE novel_id = ? AND is_active = 1 LIMIT 1) */
  private async getActiveOpponents(novelId: number): Promise<Record<string, unknown>[]> {
    const hasMatrix = await this.dataSource
      .query(
        `SELECT 1 FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = 'set_opponent_matrix' LIMIT 1`,
      )
      .then((r) => Array.isArray(r) && r.length > 0);
    if (!hasMatrix) {
      const rows = await this.dataSource.query(
        `SELECT level_name, opponent_name, threat_type, detailed_desc, sort_order
         FROM set_opponents
         WHERE novel_id = ?
         ORDER BY sort_order ASC, id ASC`,
        [novelId],
      );
      return Array.isArray(rows) ? rows : [];
    }
    const rows = await this.dataSource.query(
      `SELECT o.level_name, o.opponent_name, o.threat_type, o.detailed_desc, o.sort_order
       FROM set_opponents o
       WHERE o.novel_id = ?
         AND o.opponent_matrix_id = (
           SELECT id FROM set_opponent_matrix
           WHERE novel_id = ? AND is_active = 1
           ORDER BY version DESC, id DESC
           LIMIT 1
         )
       ORDER BY o.sort_order ASC, o.id ASC`,
      [novelId, novelId],
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

  private mapEpisode(r: Record<string, unknown>): EvidenceEpisode {
    return {
      episodeNumber: Number(r.episode_number),
      episodeTitle: r.episode_title as string | undefined,
      arc: r.arc as string | undefined,
      opening: r.opening as string | undefined,
      coreConflict: r.core_conflict as string | undefined,
      hooks: r.hooks as string | undefined,
      cliffhanger: r.cliffhanger as string | undefined,
      outlineContent: r.outline_content as string | undefined,
      historyOutline: r.history_outline as string | undefined,
      rewriteDiff: r.rewrite_diff as string | undefined,
    };
  }

  private mapCore(rows: Record<string, unknown>[]): EvidenceCore | null {
    if (!rows?.length) return null;
    const r = rows[0];
    return {
      title: r.title as string | undefined,
      coreText: r.core_text as string | undefined,
      protagonistName: r.protagonist_name as string | undefined,
      protagonistIdentity: r.protagonist_identity as string | undefined,
      targetStory: r.target_story as string | undefined,
      rewriteGoal: r.rewrite_goal as string | undefined,
      constraintText: r.constraint_text as string | undefined,
    };
  }

  private mapCharacters(rows: Record<string, unknown>[]): EvidenceCharacter[] {
    return (rows || []).map((r) => ({
      name: String(r.name ?? ''),
      faction: r.faction as string | undefined,
      description: r.description as string | undefined,
      personality: r.personality as string | undefined,
    }));
  }

  private mapOpponents(rows: Record<string, unknown>[]): EvidenceOpponent[] {
    return (rows || []).map((r) => ({
      levelName: r.level_name as string | undefined,
      opponentName: String(r.opponent_name ?? ''),
      threatType: r.threat_type as string | undefined,
      detailedDesc: r.detailed_desc as string | undefined,
      sortOrder: r.sort_order as number | undefined,
    }));
  }

  private mapPayoffLine(r: Record<string, unknown>): EvidencePayoffLine {
    return {
      lineKey: r.line_key as string | undefined,
      lineName: r.line_name as string | undefined,
      lineContent: r.line_content as string | undefined,
      startEp: r.start_ep as number | undefined,
      endEp: r.end_ep as number | undefined,
      stageText: r.stage_text as string | undefined,
      sortOrder: r.sort_order as number | undefined,
    };
  }

  private mapStoryPhase(r: Record<string, unknown>): EvidenceStoryPhase {
    return {
      phaseName: r.phase_name as string | undefined,
      startEp: r.start_ep as number | undefined,
      endEp: r.end_ep as number | undefined,
      historicalPath: r.historical_path as string | undefined,
      rewritePath: r.rewrite_path as string | undefined,
      sortOrder: r.sort_order as number | undefined,
    };
  }

  private mapPowerLevel(r: Record<string, unknown>): EvidencePowerLevel {
    return {
      levelNo: r.level_no as number | undefined,
      levelTitle: r.level_title as string | undefined,
      identityDesc: r.identity_desc as string | undefined,
      abilityBoundary: r.ability_boundary as string | undefined,
      startEp: r.start_ep as number | undefined,
      endEp: r.end_ep as number | undefined,
      sortOrder: r.sort_order as number | undefined,
    };
  }

  private mapHookRhythm(r: Record<string, unknown>): EvidenceHookRhythm {
    return {
      episodeNumber: Number(r.episode_number),
      emotionLevel: r.emotion_level as string | number | undefined,
      hookType: r.hook_type as string | undefined,
      description: r.description as string | undefined,
      cliffhanger: r.cliffhanger as string | undefined,
    };
  }

  private mapKeyNodes(rows: Record<string, unknown>[]): EvidenceKeyNode[] {
    return (rows || []).map((r) => ({
      category: r.category as string | undefined,
      title: r.title as string | undefined,
      description: r.description as string | undefined,
      timelineId: r.timeline_id as number | undefined,
      sortOrder: r.sort_order as number | undefined,
    }));
  }

  private mapTimelineEvents(
    rows: Record<string, unknown>[] | unknown,
  ): EvidenceTimelineEvent[] {
    const arr = Array.isArray(rows) ? rows : [];
    return arr.map((r) => ({
      timeNode: (r as Record<string, unknown>).time_node as string | undefined,
      event: (r as Record<string, unknown>).event as string | undefined,
      sortOrder: (r as Record<string, unknown>).sort_order as number | undefined,
    }));
  }
}
