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
const SOURCE_SEGMENTS_MAX = 20;
const EPISODE_KEYWORDS_MAX = 20;
const KEY_NODES_OR_TIMELINES_TOP = 4;
const ACTIVE_OPPONENTS_MAX = 3;
const VISUAL_ANCHORS_MAX = 10;
/** 段落上下文扩展：命中段前后各拉取的段数 */
const SEGMENT_CONTEXT_EXPAND = 1;
/** 段落边界截断的最小保留字符数 */
const PARAGRAPH_BOUNDARY_MIN_CHARS = 500;

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

    // 4. plotline_context
    const plotlineContext = await this.fetchPlotlineContext(novelId, episodeNumber);

    const episodeRow = await this.getEpisode(novelId, episodeNumber);
    const evidenceEpisode: EvidenceEpisode | null = episodeRow
      ? this.mapEpisode(episodeRow)
      : null;

    // 5. source_material_context: 本集关键词 -> segments；无命中再 fallback
    const sourceMaterialContext = await this.fetchSourceMaterialContext(
      novelId,
      episodeNumber,
      episodeRow,
    );

    const coreRows = await this.getCore(novelId);
    const characterRows = await this.getCharacters(novelId);
    const opponentRows = await this.getActiveOpponents(novelId);
    const keyNodeRows = await this.getKeyNodes(novelId);
    const timelineRows = await this.getTimelines(novelId);

    const core = this.mapCore(coreRows);
    const characters = this.mapCharacters(characterRows);
    const allOpponents = this.mapOpponents(opponentRows);
    const payoffLines = plotlineContext.activePayoffLines;
    const storyPhaseRows = await this.getStoryPhasesForEpisode(novelId, episodeNumber);
    const storyPhases = storyPhaseRows.map((r) => this.mapStoryPhase(r));
    const hookRhythm = plotlineContext.requiredHookRhythm;

    const allKeyNodes = this.mapKeyNodes(keyNodeRows);
    const allTimelineEvents = this.mapTimelineEvents(timelineRows);
    const keyNodes = this.filterKeyNodesByEpisodeRelevance(
      allKeyNodes,
      evidenceEpisode,
      temporalContext.currentStoryPhase,
    );
    const timelineEvents = this.filterTimelineEventsByEpisodeRelevance(
      allTimelineEvents,
      evidenceEpisode,
      temporalContext.currentStoryPhase,
    );
    const opponents = this.filterOpponentsByEpisodeRelevance(
      allOpponents,
      evidenceEpisode,
      temporalContext.currentStoryPhase,
    );

    const characterContext = await this.fetchCharacterContext(
      novelId,
      episodeNumber,
      globalContext.protagonistName,
    );
    characterContext.activeOpponents = opponents;

    const episodeGoal = this.buildEpisodeGoal(evidenceEpisode, core);
    const visualAnchors = this.buildVisualAnchors(
      evidenceEpisode,
      keyNodes,
      timelineEvents,
      hookRhythm,
    );
    const forbiddenDirections = this.buildForbiddenDirections(
      globalContext,
      episodeNumber,
      core,
    );
    const continuity = this.buildContinuity(evidenceEpisode);

    const pack: DramaticEvidencePack = {
      novelId,
      episodeNumber,
      globalContext,
      temporalContext,
      characterContext,
      plotlineContext,
      sourceMaterialContext,
      episodeGoal,
      visualAnchors,
      forbiddenDirections,
      continuity,
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
        `episodeGoal=${!!episodeGoal} visualAnchors=${visualAnchors.length} forbidden=${forbiddenDirections.length} ` +
        `keyNodes=${keyNodes.length} timelineEvents=${timelineEvents.length} opponents=${opponents.length} ` +
        `sourceLen=${sourceMaterialContext.excerpt?.length ?? 0}`,
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

  /**
   * 5. source_material_context: 本集关键词 -> novel_source_segments 匹配；无命中时 fallback drama_source_text 截断。
   */
  private async fetchSourceMaterialContext(
    novelId: number,
    episodeNumber: number,
    episodeRow: Record<string, unknown> | null,
  ): Promise<SourceMaterialContext> {
    const keywords = this.extractEpisodeKeywords(episodeRow);
    const hasSegments = await this.dataSource
      .query(
        `SELECT 1 FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = 'novel_source_segments' LIMIT 1`,
      )
      .then((r) => Array.isArray(r) && r.length > 0);

    if (hasSegments && keywords.length > 0) {
      const excerptFromSegments = await this.fetchSourceExcerptByKeywords(
        novelId,
        keywords,
      );
      if (excerptFromSegments) return { excerpt: excerptFromSegments };
    }

    const hasDrama = await this.dataSource
      .query(
        `SELECT 1 FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = 'drama_source_text' LIMIT 1`,
      )
      .then((r) => Array.isArray(r) && r.length > 0);
    if (!hasDrama) return { excerpt: undefined };

    const rows = await this.dataSource.query(
      `SELECT source_text AS content FROM drama_source_text WHERE novels_id = ? ORDER BY id ASC LIMIT 1`,
      [novelId],
    );
    const r = Array.isArray(rows) ? rows[0] : rows;
    const content = r && typeof r === 'object' ? (r as Record<string, unknown>).content : null;
    const text = typeof content === 'string' ? content : '';
    let excerpt: string | undefined;
    if (text.length > SOURCE_EXCERPT_MAX_CHARS) {
      // 段落边界截断：在限制字符数附近找最近的段落结束符（句号/换行）
      excerpt = this.truncateAtParagraphBoundary(text, SOURCE_EXCERPT_MAX_CHARS);
      this.logger.log(
        `[material-sifting][fetchSourceMaterialContext] novelId=${novelId} ep=${episodeNumber} ` +
          `sourceTextLen=${text.length} truncatedTo=${excerpt.length} (paragraph-boundary)`,
      );
    } else {
      excerpt = text || undefined;
    }
    return { excerpt };
  }

  private extractEpisodeKeywords(episodeRow: Record<string, unknown> | null): string[] {
    if (!episodeRow) return [];
    const parts: string[] = [
      episodeRow.outline_content,
      episodeRow.core_conflict,
      episodeRow.hooks,
      episodeRow.cliffhanger,
    ]
      .filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
      .map((s) => s.trim());
    const combined = parts.join(' ');
    const tokens = combined.split(/[\s，。、；：！？\n]+/).filter((t) => t.length >= 2);
    const seen = new Set<string>();
    const out: string[] = [];
    for (const t of tokens) {
      if (seen.has(t) || out.length >= EPISODE_KEYWORDS_MAX) break;
      seen.add(t);
      out.push(t);
    }
    return out;
  }

  private async fetchSourceExcerptByKeywords(
    novelId: number,
    keywords: string[],
  ): Promise<string | undefined> {
    if (keywords.length === 0) return undefined;
    const conditions = keywords
      .slice(0, 10)
      .map(() => `(content_text LIKE ? OR keyword_text LIKE ?)`)
      .join(' OR ');
    const params: (number | string)[] = [novelId];
    keywords.slice(0, 10).forEach((k) => {
      params.push(`%${k}%`, `%${k}%`);
    });
    // 第一步：查询命中的段落及其 segment_index
    const hitRows = await this.dataSource.query(
      `SELECT content_text, segment_index FROM novel_source_segments
       WHERE novel_id = ? AND is_active = 1 AND (${conditions})
       ORDER BY segment_index ASC
       LIMIT ?`,
      [...params, SOURCE_SEGMENTS_MAX],
    );
    const hitArr = Array.isArray(hitRows) ? hitRows : [];
    if (hitArr.length === 0) return undefined;

    // 第二步：收集命中段的 segment_index，并扩展前后各 SEGMENT_CONTEXT_EXPAND 段
    const hitIndices = new Set<number>();
    const expandedIndices = new Set<number>();
    for (const row of hitArr) {
      const idx = Number((row as Record<string, unknown>).segment_index);
      if (!Number.isNaN(idx)) {
        hitIndices.add(idx);
        // 扩展前后段落以获取完整上下文
        for (let offset = -SEGMENT_CONTEXT_EXPAND; offset <= SEGMENT_CONTEXT_EXPAND; offset++) {
          const expandIdx = idx + offset;
          if (expandIdx >= 0) expandedIndices.add(expandIdx);
        }
      }
    }

    // 第三步：查询扩展后的所有段落
    const sortedIndices = Array.from(expandedIndices).sort((a, b) => a - b);
    if (sortedIndices.length === 0) return undefined;

    const placeholders = sortedIndices.map(() => '?').join(',');
    const expandedRows = await this.dataSource.query(
      `SELECT content_text, segment_index FROM novel_source_segments
       WHERE novel_id = ? AND is_active = 1 AND segment_index IN (${placeholders})
       ORDER BY segment_index ASC`,
      [novelId, ...sortedIndices],
    );
    const expandedArr = Array.isArray(expandedRows) ? expandedRows : [];

    // 第四步：按完整段落累加，超限时停止追加（不截断当前段落）
    let total = 0;
    const excerpts: string[] = [];
    let truncatedChars = 0;
    for (const row of expandedArr) {
      const text = (row as Record<string, unknown>).content_text as string | undefined;
      if (typeof text !== 'string') continue;
      // 若加入当前段落会超限，且已有内容，则停止追加
      if (total + text.length > SOURCE_EXCERPT_MAX_CHARS && excerpts.length > 0) {
        truncatedChars += text.length;
        continue; // 跳过后续段落，保持已有段落完整
      }
      excerpts.push(text);
      total += text.length;
      // 若单段已超限（极端情况），允许该段完整保留后停止
      if (total >= SOURCE_EXCERPT_MAX_CHARS) break;
    }

    if (truncatedChars > 0) {
      this.logger.log(
        `[material-sifting][fetchSourceExcerptByKeywords] novelId=${novelId} truncatedChars=${truncatedChars} (kept ${excerpts.length} complete paragraphs)`,
      );
    }

    return excerpts.length ? excerpts.join('\n\n') : undefined;
  }

  private filterKeyNodesByEpisodeRelevance(
    nodes: EvidenceKeyNode[],
    episode: EvidenceEpisode | null,
    currentPhase: EvidenceStoryPhase | null,
  ): EvidenceKeyNode[] {
    const needle = this.episodeRelevanceNeedle(episode, currentPhase);
    if (!needle) return nodes.slice(0, KEY_NODES_OR_TIMELINES_TOP);
    const scored = nodes.map((n) => {
      const text = [n.title, n.description, n.category].filter(Boolean).join(' ');
      const hit = needle.some((w) => text.includes(w));
      return { node: n, hit };
    });
    const withHit = scored.filter((s) => s.hit);
    if (withHit.length > 0) return withHit.map((s) => s.node).slice(0, KEY_NODES_OR_TIMELINES_TOP);
    return nodes.slice(0, KEY_NODES_OR_TIMELINES_TOP);
  }

  private filterTimelineEventsByEpisodeRelevance(
    events: EvidenceTimelineEvent[],
    episode: EvidenceEpisode | null,
    currentPhase: EvidenceStoryPhase | null,
  ): EvidenceTimelineEvent[] {
    const needle = this.episodeRelevanceNeedle(episode, currentPhase);
    if (!needle) return events.slice(0, KEY_NODES_OR_TIMELINES_TOP);
    const scored = events.map((e) => {
      const text = [e.timeNode, e.event].filter(Boolean).join(' ');
      const hit = needle.some((w) => text.includes(w));
      return { event: e, hit };
    });
    const withHit = scored.filter((s) => s.hit);
    if (withHit.length > 0) return withHit.map((s) => s.event).slice(0, KEY_NODES_OR_TIMELINES_TOP);
    return events.slice(0, KEY_NODES_OR_TIMELINES_TOP);
  }

  private episodeRelevanceNeedle(
    episode: EvidenceEpisode | null,
    currentPhase: EvidenceStoryPhase | null,
  ): string[] {
    const parts: string[] = [
      episode?.outlineContent,
      episode?.coreConflict,
      episode?.hooks,
      episode?.cliffhanger,
      currentPhase?.phaseName,
      currentPhase?.rewritePath,
    ].filter((x): x is string => typeof x === 'string' && x.trim().length > 0);
    const combined = parts.join(' ');
    return combined.split(/[\s，。、；：！？\n]+/).filter((t) => t.length >= 2);
  }

  private filterOpponentsByEpisodeRelevance(
    all: EvidenceOpponent[],
    episode: EvidenceEpisode | null,
    currentPhase: EvidenceStoryPhase | null,
  ): EvidenceOpponent[] {
    const needle = this.episodeRelevanceNeedle(episode, currentPhase);
    if (needle.length === 0) return all.slice(0, ACTIVE_OPPONENTS_MAX);
    const scored = all.map((o) => {
      const text = [o.opponentName, o.levelName, o.detailedDesc, o.threatType].filter(Boolean).join(' ');
      const hit = needle.some((w) => text.includes(w));
      return { opponent: o, hit };
    });
    const withHit = scored.filter((s) => s.hit);
    if (withHit.length > 0) return withHit.map((s) => s.opponent).slice(0, ACTIVE_OPPONENTS_MAX);
    return all.slice(0, ACTIVE_OPPONENTS_MAX);
  }

  private buildEpisodeGoal(
    episode: EvidenceEpisode | null,
    core: EvidenceCore | null,
  ): string | undefined {
    const raw = episode?.coreConflict ?? episode?.outlineContent;
    if (typeof raw === 'string' && raw.trim()) return raw.trim().slice(0, 500);
    return undefined;
  }

  private buildVisualAnchors(
    episode: EvidenceEpisode | null,
    keyNodes: EvidenceKeyNode[],
    timelineEvents: EvidenceTimelineEvent[],
    hookRhythm: EvidenceHookRhythm | null,
  ): string[] {
    const out: string[] = [];
    if (episode?.opening?.trim()) out.push(episode.opening.trim());
    if (episode?.hooks?.trim()) out.push(episode.hooks.trim());
    if (episode?.cliffhanger?.trim()) out.push(episode.cliffhanger.trim());
    if (hookRhythm?.description?.trim()) out.push(hookRhythm.description.trim());
    if (hookRhythm?.cliffhanger?.trim()) out.push(hookRhythm.cliffhanger.trim());
    for (const n of keyNodes) {
      if (n.title?.trim()) out.push(n.title.trim());
      if (n.description?.trim() && out.length < VISUAL_ANCHORS_MAX) out.push(n.description.trim());
    }
    for (const e of timelineEvents) {
      if (e.event?.trim()) out.push(e.event.trim());
    }
    return out.slice(0, VISUAL_ANCHORS_MAX);
  }

  private buildForbiddenDirections(
    global: GlobalContext,
    episodeNumber: number,
    core: EvidenceCore | null,
  ): string[] {
    const list: string[] = [];
    if (global.rewriteGoal) {
      list.push(`改写目标禁止违背：${global.rewriteGoal}。禁止出现：朱棣攻破南京、建文朝覆灭、建文帝失败、历史未被改写、燕军进京、朱棣登基。`);
    }
    if (global.coreConstraint) list.push(`核心约束：${global.coreConstraint}`);
    if (episodeNumber >= 59 && episodeNumber <= 61) {
      list.push('终局集(59-61)禁止：结尾不得使用普通大开环尾钩（如「还有更大阴谋」「下一场风暴」「真正的考验才刚开始」）；必须明确收束：守住南京、稳住朝局、叛党/内奸被清、建文帝权力稳固。');
    }
    return list;
  }

  private buildContinuity(episode: EvidenceEpisode | null): {
    continuityIn?: string;
    continuityOutHint?: string;
  } {
    return {
      continuityIn: episode?.opening?.trim() || undefined,
      continuityOutHint: episode?.cliffhanger?.trim() || episode?.hooks?.trim() || undefined,
    };
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

  /**
   * 在段落边界处截断文本，避免在句子或段落中间切断。
   * 优先在 maxChars 附近找换行符或句号，若找不到则硬截断。
   */
  private truncateAtParagraphBoundary(text: string, maxChars: number): string {
    if (text.length <= maxChars) return text;

    // 在 maxChars 位置向前搜索段落边界（换行、句号、问号、感叹号）
    const searchStart = Math.max(0, maxChars - PARAGRAPH_BOUNDARY_MIN_CHARS);
    const searchRegion = text.slice(searchStart, maxChars);

    // 优先找换行符（段落边界）
    const lastNewline = searchRegion.lastIndexOf('\n');
    if (lastNewline !== -1) {
      return text.slice(0, searchStart + lastNewline + 1).trimEnd() + '…';
    }

    // 其次找中文句号、问号、感叹号
    const sentenceEndMatch = searchRegion.match(/.*[。！？]/);
    if (sentenceEndMatch) {
      const endPos = searchStart + sentenceEndMatch[0].length;
      return text.slice(0, endPos) + '…';
    }

    // 找不到合适边界，硬截断
    return text.slice(0, maxChars) + '…';
  }
}
