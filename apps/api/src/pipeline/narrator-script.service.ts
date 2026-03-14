import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
import {
  NarratorScriptDraftPayload,
  NarratorScriptGenerateDraftDto,
  NarratorScriptPersistDto,
  NarratorScriptSceneDraft,
  NarratorScriptShotDraft,
  NarratorScriptShotPromptDraft,
  NarratorScriptVersionDraft,
} from './dto/narrator-script.dto';
import {
  NARRATOR_DEFAULT_EXTENSION,
  PipelineReferenceContextService,
} from './pipeline-reference-context.service';

const DRAFT_CACHE_TTL_MS = 30 * 60 * 1000;
const MAX_CACHED_DRAFTS = 50;
const DEFAULT_SCENES_PER_EPISODE = 3;
const DEFAULT_SHOTS_PER_SCENE = 3;
const WORLDVIEW_CHAR_BUDGET = 25000;
const NARRATOR_MODEL_FALLBACK = 'claude-3-5-sonnet-20241022';
const DEFAULT_BATCH_SIZE = 5;

interface CachedNarratorScriptDraft {
  novelId: number;
  draft: NarratorScriptDraftPayload;
  createdAt: number;
}

type RowRecord = Record<string, unknown>;

@Injectable()
export class NarratorScriptService {
  private readonly logger = new Logger(NarratorScriptService.name);
  private readonly draftCache = new Map<string, CachedNarratorScriptDraft>();

  constructor(
    private readonly dataSource: DataSource,
    private readonly refContext: PipelineReferenceContextService,
  ) {}

  async generateDraft(
    novelId: number,
    dto: NarratorScriptGenerateDraftDto,
  ): Promise<{ draftId: string; draft: NarratorScriptDraftPayload }> {
    await this.assertNovelExists(novelId);

    const initialContext = await this.refContext.getContext(novelId, {
      startEpisode: dto.startEpisode ?? undefined,
      endEpisode: dto.endEpisode ?? undefined,
      requestedTables: [],
    });
    let episodeNumbers = [...initialContext.meta.episodeNumbers];
    const limit = dto.targetEpisodeCount ?? episodeNumbers.length;
    episodeNumbers = episodeNumbers.slice(0, limit);
    const batchSize = Math.max(1, dto.batchSize ?? DEFAULT_BATCH_SIZE);
    const modelKey = dto.modelKey || this.getNarratorDefaultModel();

    const batches: number[][] = [];
    for (let i = 0; i < episodeNumbers.length; i += batchSize) {
      batches.push(episodeNumbers.slice(i, i + batchSize));
    }

    this.logger.log(
      `[narrator-script][generateDraft] novelId=${novelId} episodeRange=1-${episodeNumbers.length} batches=${batches.length} model=${modelKey} requestedTables=${NARRATOR_DEFAULT_EXTENSION.join(',')} existingTables=${initialContext.meta.existingTables.join(',')} missingTables=${initialContext.meta.missingTables.join(',')}`,
    );

    const allScripts: NarratorScriptVersionDraft[] = [];
    for (let b = 0; b < batches.length; b++) {
      const batch = batches[b];
      const rangeStr = `${batch[0]}-${batch[batch.length - 1]}`;
      this.logger.log(`[narrator-script][batch] ${b + 1}/${batches.length} episodes ${rangeStr}`);
      const batchContext = await this.refContext.getContext(novelId, {
        episodeNumbers: batch,
        requestedTables: NARRATOR_DEFAULT_EXTENSION,
        optionalTablesCharBudget: WORLDVIEW_CHAR_BUDGET,
      });
      const episodeMap = new Map<number, RowRecord>();
      for (const row of batchContext.episodes as RowRecord[]) {
        const key = Number(row.episode_number);
        if (!episodeMap.has(key)) episodeMap.set(key, row);
      }
      const structureMap = new Map<number, RowRecord>();
      for (const row of batchContext.structureTemplates as RowRecord[]) {
        const key = Number(row.chapter_id);
        if (!structureMap.has(key)) structureMap.set(key, row);
      }
      const hookMap = new Map<number, RowRecord>();
      for (const row of batchContext.hookRhythms as RowRecord[]) {
        const key = Number(row.episode_number);
        if (!hookMap.has(key)) hookMap.set(key, row);
      }
      const worldviewBlock = this.refContext.buildNarratorPromptContext(batchContext, {
        charBudget: WORLDVIEW_CHAR_BUDGET,
      });
      try {
        const batchScripts = await this.generateNarratorScriptsWithLlm(
          novelId,
          batch,
          episodeMap,
          structureMap,
          hookMap,
          worldviewBlock,
          modelKey,
        );
        allScripts.push(...batchScripts);
      } catch (err: any) {
        this.logger.error(`[narrator-script][batch] episodes ${rangeStr} failed: ${err?.message}`);
        throw new BadRequestException(
          `Narrator script batch failed (episodes ${rangeStr}): ${err?.message}`,
        );
      }
    }
    allScripts.sort((a, b) => a.episodeNumber - b.episodeNumber);

    const draft: NarratorScriptDraftPayload = {
      scripts: allScripts,
      meta: { batchCount: batches.length },
    };
    const draftId = randomUUID();
    this.cleanExpiredDrafts();
    this.enforceDraftCacheLimit();
    this.draftCache.set(draftId, {
      novelId,
      draft,
      createdAt: Date.now(),
    });
    this.logger.log(
      `[narrator-script][generateDraft] novelId=${novelId} draftId=${draftId} scriptCount=${allScripts.length} batchCount=${batches.length}`,
    );
    return { draftId, draft };
  }

  private getNarratorDefaultModel(): string {
    const env = process.env.NARRATOR_DEFAULT_MODEL?.trim();
    return env || NARRATOR_MODEL_FALLBACK;
  }

  private async generateNarratorScriptsWithLlm(
    novelId: number,
    episodeNumbers: number[],
    episodeMap: Map<number, RowRecord>,
    structureMap: Map<number, RowRecord>,
    hookMap: Map<number, RowRecord>,
    worldviewBlock: string,
    modelKey: string,
  ): Promise<NarratorScriptVersionDraft[]> {
    const episodeLines: string[] = [];
    for (const epNum of episodeNumbers) {
      const ep = episodeMap.get(epNum) || {};
      const st = structureMap.get(epNum) || {};
      const hook = hookMap.get(epNum) || {};
      episodeLines.push(
        `第${epNum}集: title=${ep.episode_title || ''} arc=${ep.arc || ''} opening=${this.trimStr(String(ep.opening || ''), 300)} core_conflict=${this.trimStr(String(ep.core_conflict || ''), 400)} outline=${this.trimStr(String(ep.outline_content || ''), 500)} structure=${st.structure_name || ''} cliffhanger=${hook.cliffhanger || ''}`,
      );
    }

    const systemPrompt = `你是旁白主导短剧脚本生成助手。你必须只输出严格 JSON，不要 markdown 和解释。输出格式必须为：{"scripts":[{"episodeNumber":1,"title":"...","summary":"...","scriptType":"narrator_video","scenes":[...]}]}`;

    const userPrompt = [
      '【任务】',
      '根据以下分集信息与世界观设定，为每一集生成旁白主导的竖屏短剧脚本。请为下面列出的每一集分别生成一个完整的 script 对象，按 episodeNumber 顺序放入 scripts 数组。',
      '主风格：古装架空权谋爽剧。叙述方式：旁白推进剧情，人物对白点睛。',
      '每集默认 3 个场景（可 3~5 个），每个场景默认 3 个镜头（可 2~4 个）。总镜头适合 60 秒竖屏快节奏。',
      '要求：',
      '- 每个 shot 必须有可拍画面(visualDesc)、旁白(narratorText)、屏幕字幕(subtitleText)、时长(durationSec)、情绪(emotionTag)。',
      '- 对白(dialogueText)可空，但关键镜头应有 1~3 句对白。',
      '- 每个 shot 的 prompts 数组至少包含 promptType 为 video_cn 和 video_en 的项，promptText 偏影视化、可直接用于 AI 视频生成。',
      '- 不要长篇议论，不要空泛抽象；旁白要短、狠、能带剧情。',
      '',
      '【分集与节奏】',
      episodeLines.join('\n'),
      '',
      worldviewBlock ? '【世界观设定】\n' + worldviewBlock : '',
      '',
      '【输出 JSON 契约】',
      JSON.stringify({
        scripts: [
          {
            episodeNumber: 1,
            title: '第1集标题',
            summary: '本集概述',
            scriptType: 'narrator_video',
            scenes: [
              {
                sceneNo: 1,
                sceneTitle: '场景标题',
                locationName: '地点',
                sceneSummary: '本场概述',
                mainConflict: '冲突',
                narratorText: '场旁白',
                screenSubtitle: '屏幕大字',
                estimatedSeconds: 18,
                shots: [
                  {
                    shotNo: 1,
                    shotType: 'close',
                    visualDesc: '画面描述',
                    narratorText: '旁白',
                    dialogueText: '对白或空',
                    subtitleText: '字幕',
                    durationSec: 3.5,
                    cameraMovement: 'push',
                    emotionTag: '压迫',
                    prompts: [
                      { promptType: 'video_cn', promptText: '中文提示词', negativePrompt: '', modelName: 'generic', stylePreset: '古装权谋' },
                      { promptType: 'video_en', promptText: 'English prompt', negativePrompt: '', modelName: 'generic', stylePreset: 'ancient palace intrigue' },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      }, null, 2),
    ].filter(Boolean).join('\n');

    const endpoint = this.getLcApiEndpoint();
    const apiKey = this.getLcApiKey();
    const body = JSON.stringify({
      model: modelKey,
      temperature: 0.4,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
    });

    this.logger.log(`[narrator-script][llm] novelId=${novelId} episodes=${episodeNumbers.length} promptChars=${userPrompt.length}`);

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body,
    });

    const rawText = await response.text();
    if (!response.ok) {
      this.logger.error(`[narrator-script][llm] status=${response.status} body=${rawText.slice(0, 500)}`);
      throw new BadRequestException(`Narrator script LLM request failed: status=${response.status}`);
    }

    const payload = this.parseOuterResponse(rawText);
    const text = this.extractAiText(payload);
    if (!text) {
      this.logger.error('[narrator-script][llm] No text in response');
      throw new BadRequestException('Narrator script LLM response has no text content');
    }

    const parsed = this.parseNarratorJson(text);
    return this.normalizeScripts(parsed, episodeNumbers);
  }

  private trimStr(s: string, max: number): string {
    if (s.length <= max) return s;
    return s.slice(0, max) + '...';
  }

  private parseOuterResponse(rawText: string): Record<string, unknown> {
    try {
      return JSON.parse(rawText);
    } catch {
      throw new BadRequestException('Narrator script LLM response is not valid JSON');
    }
  }

  private extractAiText(payload: Record<string, unknown>): string {
    if (typeof payload === 'string') return payload;
    const content = (payload as any)?.choices?.[0]?.message?.content;
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) {
      return content.map((item: any) => (typeof item === 'string' ? item : item?.text ?? item?.content ?? '')).join('\n');
    }
    if (typeof (payload as any)?.output_text === 'string') return (payload as any).output_text;
    if (typeof (payload as any)?.response === 'string') return (payload as any).response;
    return '';
  }

  private parseNarratorJson(text: string): Record<string, unknown> {
    const trimmed = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
    try {
      return JSON.parse(trimmed);
    } catch {
      const start = trimmed.indexOf('{');
      const end = trimmed.lastIndexOf('}');
      if (start >= 0 && end > start) {
        try {
          return JSON.parse(trimmed.slice(start, end + 1));
        } catch {
          // fall through
        }
      }
      throw new BadRequestException('Narrator script LLM output is not valid JSON. Please ensure the model returns only JSON.');
    }
  }

  private normalizeScripts(
    parsed: Record<string, unknown>,
    episodeNumbers: number[],
  ): NarratorScriptVersionDraft[] {
    const rawScripts = parsed.scripts ?? parsed;
    const arr = Array.isArray(rawScripts) ? rawScripts : [rawScripts];
    const scripts: NarratorScriptVersionDraft[] = [];

    for (let i = 0; i < episodeNumbers.length; i++) {
      const epNum = episodeNumbers[i];
      const raw = arr[i] ?? arr.find((s: any) => Number(s?.episodeNumber) === epNum);
      const script = this.normalizeOneScript(raw, epNum);
      scripts.push(script);
    }

    return scripts;
  }

  private normalizeOneScript(raw: unknown, episodeNumber: number): NarratorScriptVersionDraft {
    const r = (raw && typeof raw === 'object' && !Array.isArray(raw)) ? (raw as RowRecord) : {};
    const scenesRaw = r.scenes;
    const scenesArr = Array.isArray(scenesRaw) ? scenesRaw : [];
    const scenes: NarratorScriptSceneDraft[] = scenesArr.slice(0, 6).map((s: any, idx: number) => this.normalizeScene(s, idx + 1));
    if (scenes.length === 0) {
      scenes.push(this.fallbackScene(episodeNumber));
    }
    return {
      episodeNumber,
      title: String(r.title ?? `第${episodeNumber}集`).slice(0, 255),
      summary: String(r.summary ?? '').slice(0, 2000),
      scriptType: String(r.scriptType ?? 'narrator_video'),
      scenes,
    };
  }

  private normalizeScene(raw: any, sceneNo: number): NarratorScriptSceneDraft {
    const shotsRaw = raw?.shots;
    const shotsArr = Array.isArray(shotsRaw) ? shotsRaw : [];
    const shots: NarratorScriptShotDraft[] = shotsArr.slice(0, 6).map((s: any, idx: number) => this.normalizeShot(s, idx + 1));
    if (shots.length === 0) {
      shots.push(this.fallbackShot());
    }
    return {
      sceneNo,
      sceneTitle: String(raw?.sceneTitle ?? `场景${sceneNo}`).slice(0, 255),
      locationName: raw?.locationName != null ? String(raw.locationName).slice(0, 255) : undefined,
      sceneSummary: raw?.sceneSummary != null ? String(raw.sceneSummary).slice(0, 2000) : undefined,
      mainConflict: raw?.mainConflict != null ? String(raw.mainConflict).slice(0, 2000) : undefined,
      narratorText: raw?.narratorText != null ? String(raw.narratorText).slice(0, 5000) : undefined,
      screenSubtitle: raw?.screenSubtitle != null ? String(raw.screenSubtitle).slice(0, 500) : undefined,
      estimatedSeconds: typeof raw?.estimatedSeconds === 'number' ? Math.max(1, raw.estimatedSeconds) : 18,
      shots,
    };
  }

  private normalizeShot(raw: any, shotNo: number): NarratorScriptShotDraft {
    const promptsRaw = raw?.prompts;
    const promptsArr = Array.isArray(promptsRaw) ? promptsRaw : [];
    const prompts: NarratorScriptShotPromptDraft[] = promptsArr.slice(0, 8).map((p: any) => ({
      promptType: String(p?.promptType ?? 'video_cn').slice(0, 50),
      promptText: String(p?.promptText ?? '').slice(0, 8000),
      negativePrompt: p?.negativePrompt != null ? String(p.negativePrompt).slice(0, 2000) : undefined,
      modelName: p?.modelName != null ? String(p.modelName).slice(0, 100) : undefined,
      stylePreset: p?.stylePreset != null ? String(p.stylePreset).slice(0, 100) : undefined,
    }));
    if (prompts.length === 0) {
      prompts.push({ promptType: 'video_cn', promptText: String(raw?.visualDesc ?? '').slice(0, 1000) });
      prompts.push({ promptType: 'video_en', promptText: String(raw?.visualDesc ?? '').slice(0, 1000) });
    }
    return {
      shotNo,
      shotType: raw?.shotType != null ? String(raw.shotType).slice(0, 50) : undefined,
      visualDesc: String(raw?.visualDesc ?? '画面说明').slice(0, 8000),
      narratorText: raw?.narratorText != null ? String(raw.narratorText).slice(0, 5000) : undefined,
      dialogueText: raw?.dialogueText != null ? String(raw.dialogueText).slice(0, 2000) : undefined,
      subtitleText: raw?.subtitleText != null ? String(raw.subtitleText).slice(0, 500) : undefined,
      durationSec: typeof raw?.durationSec === 'number' ? Math.max(0.5, Math.min(30, raw.durationSec)) : 3,
      cameraMovement: raw?.cameraMovement != null ? String(raw.cameraMovement).slice(0, 100) : undefined,
      emotionTag: raw?.emotionTag != null ? String(raw.emotionTag).slice(0, 50) : undefined,
      prompts,
    };
  }

  private fallbackScene(episodeNumber: number): NarratorScriptSceneDraft {
    return {
      sceneNo: 1,
      sceneTitle: `第${episodeNumber}集主场景`,
      estimatedSeconds: 20,
      shots: [this.fallbackShot()],
    };
  }

  private fallbackShot(): NarratorScriptShotDraft {
    return {
      shotNo: 1,
      shotType: 'medium',
      visualDesc: '镜头画面说明',
      narratorText: '旁白',
      durationSec: 3,
      prompts: [
        { promptType: 'video_cn', promptText: '镜头画面说明' },
        { promptType: 'video_en', promptText: 'Scene description' },
      ],
    };
  }

  private getLcApiEndpoint(): string {
    const raw = process.env.lc_api_url?.trim();
    if (!raw) {
      throw new InternalServerErrorException('lc_api_url is not configured for narrator script generation');
    }
    const normalized = raw.replace(/\/+$/, '');
    if (normalized.endsWith('/v1/chat/completions') || normalized.endsWith('/chat/completions')) {
      return normalized;
    }
    return `${normalized}/v1/chat/completions`;
  }

  private getLcApiKey(): string {
    const key = process.env.lc_api_key?.trim();
    if (!key) {
      throw new InternalServerErrorException('lc_api_key is not configured for narrator script generation');
    }
    return key;
  }

  async persistDraft(
    novelId: number,
    dto: NarratorScriptPersistDto,
  ): Promise<{
    ok: true;
    summary: {
      scriptVersions: number;
      scenes: number;
      shots: number;
      prompts: number;
      episodeCoverage: number;
    };
  }> {
    let resolved: NarratorScriptDraftPayload;
    let usedDraftId: string | undefined;

    if (dto.draftId) {
      const cached = this.getCachedDraft(dto.draftId);
      if (cached) {
        if (cached.novelId !== novelId) {
          throw new BadRequestException({
            message: 'draftId 对应的 novelId 与当前请求不匹配',
            code: 'NARRATOR_SCRIPT_DRAFT_ID_NOVEL_MISMATCH',
          });
        }
        resolved = cached.draft;
        usedDraftId = dto.draftId;
      } else if (dto.draft) {
        resolved = dto.draft;
      } else {
        throw new BadRequestException({
          message: 'draftId 已过期或不存在，且未提供 draft，请重新生成草稿',
          code: 'NARRATOR_SCRIPT_DRAFT_CACHE_MISS',
        });
      }
    } else if (dto.draft) {
      resolved = dto.draft;
    } else {
      throw new BadRequestException({
        message: '请提供 draftId 或 draft',
        code: 'NARRATOR_SCRIPT_DRAFT_REQUIRED',
      });
    }

    if (!resolved.scripts?.length) {
      throw new BadRequestException('draft.scripts 不能为空');
    }

    let scriptVersions = 0;
    let scenes = 0;
    let shots = 0;
    let prompts = 0;
    const episodeSet = new Set<number>();

    await this.dataSource.transaction(async (manager) => {
      for (const script of resolved.scripts) {
        episodeSet.add(script.episodeNumber);
        const episodeQuery: any = await manager.query(
          `SELECT id FROM novel_episodes WHERE novel_id = ? AND episode_number = ? LIMIT 1`,
          [novelId, script.episodeNumber],
        );
        const episodeRow = Array.isArray(episodeQuery) ? episodeQuery[0] : episodeQuery;
        const sourceEpisodeId = episodeRow?.id ?? null;
        const versionNoQuery: any = await manager.query(
          `SELECT COALESCE(MAX(version_no), 0) + 1 AS v FROM episode_script_versions WHERE novel_id = ? AND episode_number = ?`,
          [novelId, script.episodeNumber],
        );
        const versionNoRow = Array.isArray(versionNoQuery) ? versionNoQuery[0] : versionNoQuery;
        const versionNo = Number((versionNoRow as any)?.v ?? 1);
        await manager.query(
          `UPDATE episode_script_versions SET is_active = 0 WHERE novel_id = ? AND episode_number = ?`,
          [novelId, script.episodeNumber],
        );
        const versionIns: any = await manager.query(
          `INSERT INTO episode_script_versions (novel_id, episode_number, source_episode_id, version_no, script_type, title, summary, status, is_active)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'draft', 1)`,
          [
            novelId,
            script.episodeNumber,
            sourceEpisodeId,
            versionNo,
            script.scriptType,
            script.title,
            script.summary || '',
          ],
        );
        const scriptVersionId = Number(Array.isArray(versionIns) ? versionIns[0]?.insertId : versionIns?.insertId) || 0;
        if (!scriptVersionId) {
          throw new BadRequestException('INSERT episode_script_versions did not return insertId');
        }
        scriptVersions++;

        for (const scene of script.scenes || []) {
          const sceneIns: any = await manager.query(
            `INSERT INTO episode_scenes (novel_id, script_version_id, episode_number, scene_no, scene_title, location_name, scene_summary, main_conflict, narrator_text, screen_subtitle, estimated_seconds, sort_order)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              novelId,
              scriptVersionId,
              script.episodeNumber,
              scene.sceneNo,
              scene.sceneTitle,
              scene.locationName ?? null,
              scene.sceneSummary ?? null,
              scene.mainConflict ?? null,
              scene.narratorText ?? null,
              scene.screenSubtitle ?? null,
              scene.estimatedSeconds ?? 10,
              scene.sceneNo,
            ],
          );
          const sceneId = Number(Array.isArray(sceneIns) ? sceneIns[0]?.insertId : sceneIns?.insertId) || 0;
          if (!sceneId) {
            throw new BadRequestException('INSERT episode_scenes did not return insertId');
          }
          scenes++;

          for (const shot of scene.shots || []) {
            const shotIns: any = await manager.query(
              `INSERT INTO episode_shots (novel_id, script_version_id, scene_id, episode_number, shot_no, shot_type, visual_desc, narrator_text, dialogue_text, subtitle_text, duration_sec, camera_movement, emotion_tag, sort_order)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              [
                novelId,
                scriptVersionId,
                sceneId,
                script.episodeNumber,
                shot.shotNo,
                shot.shotType ?? null,
                shot.visualDesc || '',
                shot.narratorText ?? null,
                shot.dialogueText ?? null,
                shot.subtitleText ?? null,
                shot.durationSec ?? 3,
                shot.cameraMovement ?? null,
                shot.emotionTag ?? null,
                shot.shotNo,
              ],
            );
            const shotId = Number(Array.isArray(shotIns) ? shotIns[0]?.insertId : shotIns?.insertId) || 0;
            if (!shotId) {
              throw new BadRequestException('INSERT episode_shots did not return insertId');
            }
            shots++;

            for (const prompt of shot.prompts || []) {
              await manager.query(
                `INSERT INTO episode_shot_prompts (novel_id, shot_id, prompt_type, prompt_text, negative_prompt, model_name, style_preset)
                 VALUES (?, ?, ?, ?, ?, ?, ?)`,
                [
                  novelId,
                  shotId,
                  prompt.promptType,
                  prompt.promptText || '',
                  prompt.negativePrompt ?? null,
                  prompt.modelName ?? null,
                  prompt.stylePreset ?? null,
                ],
              );
              prompts++;
            }
          }
        }
      }
    });

    if (usedDraftId) {
      this.draftCache.delete(usedDraftId);
    }
    const episodeList = [...episodeSet].sort((a, b) => a - b);
    this.logger.log(
      `[narrator-script][persist] novelId=${novelId} scriptVersions=${scriptVersions} scenes=${scenes} shots=${shots} prompts=${prompts} episodeCoverage=${episodeSet.size} episodes=[${episodeList.join(',')}] batchCount=${resolved.meta?.batchCount ?? 'n/a'}`,
    );
    return {
      ok: true,
      summary: {
        scriptVersions,
        scenes,
        shots,
        prompts,
        episodeCoverage: episodeSet.size,
        batchCount: resolved.meta?.batchCount,
      },
    };
  }

  private getCachedDraft(
    draftId: string,
  ): CachedNarratorScriptDraft | null {
    const entry = this.draftCache.get(draftId);
    if (!entry) return null;
    if (Date.now() - entry.createdAt > DRAFT_CACHE_TTL_MS) {
      this.draftCache.delete(draftId);
      return null;
    }
    return entry;
  }

  private cleanExpiredDrafts(): void {
    const now = Date.now();
    for (const [key, entry] of this.draftCache) {
      if (now - entry.createdAt > DRAFT_CACHE_TTL_MS) {
        this.draftCache.delete(key);
      }
    }
  }

  private enforceDraftCacheLimit(): void {
    if (this.draftCache.size < MAX_CACHED_DRAFTS) return;
    let oldestKey: string | null = null;
    let oldestTime = Infinity;
    for (const [key, entry] of this.draftCache) {
      if (entry.createdAt < oldestTime) {
        oldestTime = entry.createdAt;
        oldestKey = key;
      }
    }
    if (oldestKey) this.draftCache.delete(oldestKey);
  }

  private async assertNovelExists(novelId: number): Promise<void> {
    const rows = await this.dataSource.query(
      `SELECT id FROM drama_novels WHERE id = ? LIMIT 1`,
      [novelId],
    );
    if (!rows?.length) {
      throw new NotFoundException(`Novel ${novelId} not found`);
    }
  }
}
