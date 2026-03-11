import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import {
  PipelineWorldviewGenerateDraftDto,
  PipelineWorldviewPersistDto,
  PipelineWorldviewPreviewDto,
  PipelineWorldviewReferenceTable,
} from './dto/pipeline-worldview.dto';
import { SourceRetrievalService } from '../source-texts/source-retrieval.service';
import {
  WorldviewDraftShape,
  WorldviewQualityWarning,
  WorldviewQualityChecker,
} from './worldview-quality-checker';
import {
  StoryPhaseIntervalInferenceSummary,
  StoryPhaseInferenceWarning,
  WorldviewStoryPhaseInference,
} from './story-phase-interval-inference';
import {
  PayoffInferenceWarning,
  PayoffIntervalInferenceSummary,
  WorldviewPayoffIntervalInference,
} from './payoff-interval-inference';
import {
  PowerInferenceWarning,
  PowerIntervalInferenceSummary,
  WorldviewPowerIntervalInference,
} from './power-interval-inference';
import {
  TraitorStageInferenceWarning,
  TraitorStageIntervalInferenceSummary,
  WorldviewTraitorStageIntervalInference,
} from './traitor-stage-interval-inference';
import {
  WorldviewAlignmentSummary,
  WorldviewAlignmentWarning,
  WorldviewCrossTableAlignmentChecker,
} from './worldview-cross-table-alignment-checker';
import {
  WorldviewClosureResult,
  WorldviewClosureStatus,
  WorldviewRepairPlan,
  WorldviewRepairSummary,
  WorldviewValidationReport,
} from './worldview-closure.types';
import { WorldviewValidationOrchestrator } from './worldview-validation-orchestrator';
import { WorldviewRepairPlanner } from './worldview-repair-planner';
import { WorldviewModuleRepairService } from './worldview-module-repair.service';

type RowRecord = Record<string, any>;

type ReferenceSummaryItem = {
  table: PipelineWorldviewReferenceTable;
  label: string;
  rowCount: number;
  fields: string[];
  usedChars?: number;
  originalChars?: number;
  note?: string;
  segmentCount?: number;
  chapterCount?: number;
  usedFallback?: boolean;
  moduleEvidenceCount?: Record<string, number>;
};

type WorldviewEvidenceSummary = {
  evidenceSegments: number;
  coverageChapters: number;
  evidenceChars: number;
  fallbackUsed: boolean;
  moduleEvidenceCount: Record<string, number>;
};

type WorldviewInferenceSummary = {
  storyPhase: StoryPhaseIntervalInferenceSummary;
  payoff: PayoffIntervalInferenceSummary;
  power: PowerIntervalInferenceSummary;
  traitorStage: TraitorStageIntervalInferenceSummary;
};

type SourceTextBlockResult = {
  block: string;
  rowCount: number;
  usedChars: number;
  originalChars: number;
  warnings: string[];
};

type WorldviewModelRow = {
  modelKey: string;
  provider: string;
  family: string;
  modality: string;
};

type WorldviewDraft = {
  setPayoffArch: {
    name: string;
    notes: string;
    lines: Array<{
      line_key: string;
      line_name: string;
      line_content: string;
      start_ep: number | null;
      end_ep: number | null;
      stage_text: string | null;
      sort_order: number;
    }>;
  };
  setOpponentMatrix: {
    name: string;
    description: string;
    opponents: Array<{
      level_name: string;
      opponent_name: string;
      threat_type: string | null;
      detailed_desc: string | null;
      sort_order: number;
    }>;
  };
  setPowerLadder: Array<{
    level_no: number;
    level_title: string;
    identity_desc: string;
    ability_boundary: string;
    start_ep: number | null;
    end_ep: number | null;
    sort_order: number;
  }>;
  setTraitorSystem: {
    name: string;
    description: string;
    traitors: Array<{
      name: string;
      public_identity: string | null;
      real_identity: string | null;
      mission: string | null;
      threat_desc: string | null;
      sort_order: number;
    }>;
    stages: Array<{
      stage_title: string;
      stage_desc: string;
      start_ep: number | null;
      end_ep: number | null;
      sort_order: number;
    }>;
  };
  setStoryPhases: Array<{
    phase_name: string;
    start_ep: number | null;
    end_ep: number | null;
    historical_path: string | null;
    rewrite_path: string | null;
    sort_order: number;
  }>;
};

type WorldviewPersistSummary = {
  payoffArch: number;
  payoffLines: number;
  opponentMatrix: number;
  opponents: number;
  powerLadder: number;
  traitorSystem: number;
  traitors: number;
  traitorStages: number;
  storyPhases: number;
};

const DEFAULT_REFERENCE_TABLES: PipelineWorldviewReferenceTable[] = [
  'drama_novels',
  'novel_adaptation_strategy',
  'adaptation_modes',
  'set_core',
  'novel_timelines',
  'novel_characters',
  'novel_key_nodes',
  'novel_skeleton_topics',
  'novel_skeleton_topic_items',
  'novel_explosions',
];

const DEFAULT_SOURCE_TEXT_CHAR_BUDGET = 15000;
const MAX_SOURCE_TEXT_PER_ROW = 5000;
const WORLDVIEW_DEFAULT_MODEL_CANDIDATES = [
  'claude-3-7-sonnet-20250219',
  'claude-3-5-sonnet-20241022',
  'claude-3-5-sonnet-20240620',
  'chatgpt-4o-latest',
];

@Injectable()
export class PipelineWorldviewService {
  private readonly qualityChecker = new WorldviewQualityChecker();
  private readonly storyPhaseInference = new WorldviewStoryPhaseInference();
  private readonly payoffInference = new WorldviewPayoffIntervalInference();
  private readonly powerInference = new WorldviewPowerIntervalInference();
  private readonly traitorStageInference = new WorldviewTraitorStageIntervalInference();
  private readonly crossTableAlignmentChecker = new WorldviewCrossTableAlignmentChecker();
  private readonly validationOrchestrator = new WorldviewValidationOrchestrator();
  private readonly repairPlanner = new WorldviewRepairPlanner();
  private readonly moduleRepairService = new WorldviewModuleRepairService();

  constructor(
    private readonly dataSource: DataSource,
    private readonly sourceRetrievalService: SourceRetrievalService,
  ) {}

  async previewPrompt(novelId: number, dto: PipelineWorldviewPreviewDto) {
    await this.assertNovelExists(novelId);
    const referenceTables = this.resolveReferenceTables(dto.referenceTables);
    const usedModelKey = await this.resolveOptionalModelKey(dto.modelKey);
    const warnings: string[] = [];
    const { promptPreview, referenceSummary } = await this.buildPrompt(
      novelId,
      referenceTables,
      dto.userInstruction,
      dto.sourceTextCharBudget,
      warnings,
    );
    const evidenceSummary = this.buildEvidenceSummary(referenceSummary);
    const persistedDraft = await this.loadPersistedWorldviewDraft(novelId);
    const totalChapters = await this.getNovelTotalChapters(novelId);
    const optimizedPersistedDraft = this.applyCurrentSchemaOptimization(
      persistedDraft,
      totalChapters,
    );
    const { qualitySummary, qualityWarnings } = this.qualityChecker.evaluate(
      optimizedPersistedDraft.draft,
      {
        totalChapters,
      },
    );
    const mergedWarnings = this.mergeOptimizationWarnings(
      qualityWarnings,
      optimizedPersistedDraft.inferenceWarnings,
      optimizedPersistedDraft.alignmentWarnings,
    );
    const validationReportPreview = this.validationOrchestrator.evaluate({
      draft: optimizedPersistedDraft.draft,
      promptPreview,
      qualitySummary,
      qualityWarnings: mergedWarnings,
      alignmentWarnings: optimizedPersistedDraft.alignmentWarnings,
      evidenceSummary,
    });

    return {
      promptPreview,
      usedModelKey,
      referenceTables,
      referenceSummary,
      evidenceSummary,
      qualitySummary,
      qualityWarnings: mergedWarnings,
      inferenceSummary: optimizedPersistedDraft.inferenceSummary,
      alignmentSummary: optimizedPersistedDraft.alignmentSummary,
      alignmentWarnings: optimizedPersistedDraft.alignmentWarnings,
      validationReportPreview,
      warnings: warnings.length ? warnings : undefined,
    };
  }

  async generateDraft(novelId: number, dto: PipelineWorldviewGenerateDraftDto) {
    await this.assertNovelExists(novelId);
    const referenceTables = this.resolveReferenceTables(dto.referenceTables);
    const usedModelKey = await this.resolveOptionalModelKey(dto.modelKey);
    const warnings: string[] = [];
    const { promptPreview, referenceSummary } = await this.buildPrompt(
      novelId,
      referenceTables,
      dto.userInstruction,
      dto.sourceTextCharBudget,
      warnings,
    );
    const evidenceSummary = this.buildEvidenceSummary(referenceSummary);
    const finalPrompt =
      dto.allowPromptEdit && this.normalizeText(dto.promptOverride)
        ? dto.promptOverride!.trim()
        : promptPreview;

    const aiJson = await this.callLcAiApi(usedModelKey, finalPrompt);
    const normalizationWarnings: string[] = [];
    const validationWarnings: string[] = [];
    const draft = await this.validateAndNormalizeWorldviewDraft(
      novelId,
      aiJson,
      normalizationWarnings,
      validationWarnings,
    );
    const totalChapters = await this.getNovelTotalChapters(novelId);
    let optimizedDraft = this.applyCurrentSchemaOptimization(draft, totalChapters);
    let { qualitySummary, qualityWarnings } = this.qualityChecker.evaluate(optimizedDraft.draft, {
      totalChapters,
    });
    let mergedWarnings = this.mergeOptimizationWarnings(
      qualityWarnings,
      optimizedDraft.inferenceWarnings,
      optimizedDraft.alignmentWarnings,
    );
    const initialValidationReport = this.validationOrchestrator.evaluate({
      draft: optimizedDraft.draft,
      promptPreview: finalPrompt,
      qualitySummary,
      qualityWarnings: mergedWarnings,
      alignmentWarnings: optimizedDraft.alignmentWarnings,
      evidenceSummary,
    });
    const repairPlan = this.repairPlanner.buildPlan(initialValidationReport);
    let repairApplied = false;
    let evidenceReselected = false;
    let finalValidationReport = initialValidationReport;
    let closureStatus: WorldviewClosureStatus = 'accepted';
    let repairSummary: WorldviewRepairSummary = {
      actionType: repairPlan.actionType,
      targetModules: repairPlan.targetModules,
      issueCountBefore: initialValidationReport.issues.length,
      issueCountAfter: initialValidationReport.issues.length,
      scoreBefore: initialValidationReport.score,
      scoreAfter: initialValidationReport.score,
    };

    if (repairPlan.actionType !== 'accept') {
      repairApplied = true;
      let repairPrompt = finalPrompt;
      if (repairPlan.needsEvidenceReselect) {
        const filtered = this.filterWeakRelevanceEvidence(repairPrompt);
        repairPrompt = filtered.prompt;
        evidenceReselected = filtered.removedCount > 0;
        if (filtered.removedCount > 0) {
          warnings.push(`Evidence reselection applied, removed ${filtered.removedCount} weak-relevance lines`);
        }
      }
      const repairedDraftRaw = await this.moduleRepairService.apply({
        draft: optimizedDraft.draft as Record<string, unknown>,
        plan: repairPlan as WorldviewRepairPlan,
        issues: initialValidationReport.issues,
        usedModelKey,
        promptPreview: repairPrompt,
        evidenceBlock: this.extractEvidenceBlock(repairPrompt),
        aiGenerateJson: (modelKey, prompt) => this.callLcAiApi(modelKey, prompt),
      });
      const postRepairNormalizationWarnings: string[] = [];
      const postRepairValidationWarnings: string[] = [];
      const repairedDraft = await this.validateAndNormalizeWorldviewDraft(
        novelId,
        repairedDraftRaw,
        postRepairNormalizationWarnings,
        postRepairValidationWarnings,
      );
      normalizationWarnings.push(...postRepairNormalizationWarnings);
      validationWarnings.push(...postRepairValidationWarnings);
      optimizedDraft = this.applyCurrentSchemaOptimization(repairedDraft, totalChapters);
      ({ qualitySummary, qualityWarnings } = this.qualityChecker.evaluate(optimizedDraft.draft, {
        totalChapters,
      }));
      mergedWarnings = this.mergeOptimizationWarnings(
        qualityWarnings,
        optimizedDraft.inferenceWarnings,
        optimizedDraft.alignmentWarnings,
      );
      finalValidationReport = this.validationOrchestrator.evaluate({
        draft: optimizedDraft.draft,
        promptPreview: repairPrompt,
        qualitySummary,
        qualityWarnings: mergedWarnings,
        alignmentWarnings: optimizedDraft.alignmentWarnings,
        evidenceSummary,
      });
      repairSummary = {
        actionType: repairPlan.actionType,
        targetModules: repairPlan.targetModules,
        issueCountBefore: initialValidationReport.issues.length,
        issueCountAfter: finalValidationReport.issues.length,
        scoreBefore: initialValidationReport.score,
        scoreAfter: finalValidationReport.score,
      };
    }

    closureStatus = this.resolveClosureStatus(finalValidationReport, repairApplied);
    const closureResult: WorldviewClosureResult = {
      closureStatus,
      repairApplied,
      evidenceReselected,
      repairSummary,
      initialValidationReport,
      finalValidationReport,
    };

    return {
      usedModelKey,
      promptPreview: finalPrompt,
      referenceTables,
      referenceSummary,
      evidenceSummary,
      draft: optimizedDraft.draft,
      qualitySummary,
      qualityWarnings: mergedWarnings,
      inferenceSummary: optimizedDraft.inferenceSummary,
      alignmentSummary: optimizedDraft.alignmentSummary,
      alignmentWarnings: optimizedDraft.alignmentWarnings,
      validationReport: finalValidationReport,
      initialValidationReport: closureResult.initialValidationReport,
      finalValidationReport: closureResult.finalValidationReport,
      repairSummary: closureResult.repairSummary,
      closureStatus: closureResult.closureStatus,
      repairApplied: closureResult.repairApplied,
      evidenceReselected: closureResult.evidenceReselected,
      warnings: warnings.length ? warnings : undefined,
      normalizationWarnings: normalizationWarnings.length
        ? normalizationWarnings
        : undefined,
      validationWarnings: validationWarnings.length ? validationWarnings : undefined,
    };
  }

  async persistDraft(novelId: number, dto: PipelineWorldviewPersistDto) {
    await this.assertNovelExists(novelId);
    await this.assertOutputTablesExist();

    const normalizationWarnings: string[] = [];
    const validationWarnings: string[] = [];
    const draft = await this.validateAndNormalizeWorldviewDraft(
      novelId,
      dto.draft,
      normalizationWarnings,
      validationWarnings,
    );
    const totalChapters = await this.getNovelTotalChapters(novelId);
    const optimizedDraft = this.applyCurrentSchemaOptimization(draft, totalChapters);
    const { qualitySummary, qualityWarnings } = this.qualityChecker.evaluate(
      optimizedDraft.draft,
      {
        totalChapters,
      },
    );
    const mergedWarnings = this.mergeOptimizationWarnings(
      qualityWarnings,
      optimizedDraft.inferenceWarnings,
      optimizedDraft.alignmentWarnings,
    );
    const validationReport = this.validationOrchestrator.evaluate({
      draft: optimizedDraft.draft,
      promptPreview: '',
      qualitySummary,
      qualityWarnings: mergedWarnings,
      alignmentWarnings: optimizedDraft.alignmentWarnings,
      evidenceSummary: null,
    });
    const closureStatus = this.resolveClosureStatus(validationReport, false);
    if (validationReport.fatalCount > 0) {
      validationWarnings.push(
        `Fatal validation issues detected before persist: ${validationReport.fatalCount}. Persist continues with low confidence.`,
      );
    }

    const summary = await this.dataSource.transaction(async (manager) => {
      await this.deleteExistingWorldviewData(novelId, manager);
      return this.insertWorldviewDraft(novelId, optimizedDraft.draft, manager);
    });

    return {
      ok: true,
      summary,
      qualitySummary,
      qualityWarnings: mergedWarnings,
      inferenceSummary: optimizedDraft.inferenceSummary,
      alignmentSummary: optimizedDraft.alignmentSummary,
      alignmentWarnings: optimizedDraft.alignmentWarnings,
      validationReport,
      closureStatus,
      repairApplied: false,
      evidenceReselected: false,
      normalizationWarnings: normalizationWarnings.length
        ? normalizationWarnings
        : undefined,
      validationWarnings: validationWarnings.length ? validationWarnings : undefined,
    };
  }

  private resolveReferenceTables(
    referenceTables?: PipelineWorldviewReferenceTable[],
  ): PipelineWorldviewReferenceTable[] {
    if (!referenceTables?.length) {
      return DEFAULT_REFERENCE_TABLES;
    }
    return [...new Set(referenceTables)];
  }

  private async resolveOptionalModelKey(modelKey?: string): Promise<string> {
    const normalized = this.normalizeText(modelKey);
    if (normalized) {
      return this.resolveModelKey(normalized);
    }

    const rows = (await this.dataSource.query(
      `
      SELECT
        model_key AS modelKey,
        COALESCE(provider, '') AS provider,
        COALESCE(family, '') AS family,
        COALESCE(modality, '') AS modality
      FROM ai_model_catalog
      WHERE is_active = 1
      ORDER BY sort_order ASC, display_name ASC, model_key ASC
      `,
    )) as WorldviewModelRow[];
    const safeRows = rows.filter((row) => this.isSafeWorldviewModel(row));
    if (!safeRows.length) {
      throw new BadRequestException(
        'No safe AI model is available for worldview JSON generation',
      );
    }

    for (const candidate of WORLDVIEW_DEFAULT_MODEL_CANDIDATES) {
      const matched = safeRows.find((row) => row.modelKey === candidate);
      if (matched) {
        return matched.modelKey;
      }
    }
    return safeRows[0].modelKey;
  }

  private async resolveModelKey(modelKey: string): Promise<string> {
    const rows = (await this.dataSource.query(
      `
      SELECT
        model_key AS modelKey,
        COALESCE(provider, '') AS provider,
        COALESCE(family, '') AS family,
        COALESCE(modality, '') AS modality
      FROM ai_model_catalog
      WHERE is_active = 1 AND model_key = ?
      LIMIT 1
      `,
      [modelKey],
    )) as WorldviewModelRow[];
    if (!rows.length) {
      throw new BadRequestException(`AI model ${modelKey} is not available`);
    }
    if (!this.isSafeWorldviewModel(rows[0])) {
      throw new BadRequestException(
        `AI model ${modelKey} is not safe for worldview JSON generation`,
      );
    }
    return modelKey;
  }

  private isSafeWorldviewModel(row: WorldviewModelRow): boolean {
    const key = this.normalizeText(row.modelKey).toLowerCase();
    const provider = this.normalizeText(row.provider).toLowerCase();
    const family = this.normalizeText(row.family).toLowerCase();
    const modality = this.normalizeText(row.modality).toLowerCase();

    if (key.includes('imagine') || key.includes('midjourney')) return false;
    if (provider.includes('midjourney')) return false;
    if (modality && modality !== 'text') return false;

    return (
      key.includes('claude') ||
      key.includes('gpt') ||
      key.includes('deepseek') ||
      family.includes('claude') ||
      family.includes('gpt') ||
      family.includes('deepseek')
    );
  }

  private async buildPrompt(
    novelId: number,
    referenceTables: PipelineWorldviewReferenceTable[],
    userInstruction: string | undefined,
    sourceTextCharBudget: number | undefined,
    warnings: string[],
  ): Promise<{
    promptPreview: string;
    referenceSummary: ReferenceSummaryItem[];
  }> {
    const { blocks, summary } = await this.buildReferenceBlocks(
      novelId,
      referenceTables,
      sourceTextCharBudget,
      warnings,
    );
    const userInstructionBlock = [
      '【用户附加要求】',
      this.normalizeText(userInstruction) || '无',
    ].join('\n');

    const taskBlock = [
      '【任务目标】',
      '你要为当前短剧项目提炼“短剧世界观结构化草稿”，不是写散文总结。',
      '你必须基于系统提供的项目资料、改编策略、核心设定、时间线、人物、关键节点、骨架主题与爆点，提炼可直接写入数据库的结构化世界观。',
      '',
      '【输出目标】',
      '1. setPayoffArch：核心爽点架构总表',
      '2. setPayoffArch.lines：爽点线明细',
      '3. setOpponentMatrix：对手矩阵总表',
      '4. setOpponentMatrix.opponents：对手矩阵明细',
      '5. setPowerLadder：权力升级阶梯',
      '6. setTraitorSystem：内鬼系统总表',
      '7. setTraitorSystem.traitors：内鬼角色',
      '8. setTraitorSystem.stages：内鬼阶段推进',
      '9. setStoryPhases：故事发展阶段设计',
      '',
      '【强约束】',
      '1. 你必须输出严格 JSON，不要输出 markdown、解释、注释或代码块。',
      '2. 顶层必须且只能包含：setPayoffArch、setOpponentMatrix、setPowerLadder、setTraitorSystem、setStoryPhases。',
      '3. 所有数组字段都必须存在，即使为空也返回空数组。',
      '4. 不要输出数据库主键、外键、created_at、updated_at、version、is_active。',
      '5. 若资料不足，可返回空数组或空字符串，但不要编造明显无依据的设定。',
      '6. set_core 仅作为输入参考，不要在输出中生成 set_core。',
      '',
      '【质量要求】',
      '1. 爽点架构要体现爽点线的推进逻辑，而不是简单列标题。',
      '2. setPayoffArch.lines[].line_content 必须写清该爽点线如何推进、如何升级、如何形成观众持续期待，不能只给标题。',
      '3. setOpponentMatrix.opponents[].detailed_desc 应尽量具体写出威胁来源、对抗方式与局势影响，不要只写人名。',
      '4. setPowerLadder[].identity_desc 不是等级名，必须写主角在该阶段的身份位置、被谁看见、在权力结构中的位置。',
      '5. setPowerLadder[].ability_boundary 必须写该阶段能动用的资源、可影响对象、不能触碰的边界与限制。',
      '6. setStoryPhases[].historical_path 必须写“历史原本会如何走”，要有阶段性事件，不要抽象空话。',
      '7. setStoryPhases[].rewrite_path 必须写“沈昭如何改写”并说明改写动作与改写结果。',
      '8. setTraitorSystem.description 写的是整体内鬼机制（为何存在、如何运作、对主线造成什么风险），不是单个人简介。',
      '9. setTraitorSystem.traitors[].public_identity 必须写“角色对外呈现的表面身份”（如朝廷主将/重臣/近臣/王府幕僚/表面忠臣），不可与 real_identity 完全相同。',
      '10. setTraitorSystem.traitors[].real_identity 必须写“真实立场或隐藏身份”（如燕王内应/潜在叛徒/双面人/暗中通敌者/被策反者）。',
      '11. setTraitorSystem.traitors[].mission 必须写具体任务或破坏目标，不能留空。',
      '12. setTraitorSystem.traitors[].threat_desc 必须写该角色如何构成威胁、如何影响战局。',
      '13. setTraitorSystem.stages[].stage_desc 必须写从可疑/潜伏/布局到暴露/反制的阶段推进，不要只写“阶段1/阶段2”。',
      '14. 对手矩阵要体现不同层级或不同威胁方向，不要把所有对手写成一类。',
      '15. setOpponentMatrix.opponents[].level_name 不能写“层级1/层级2”，要写威胁层级或类别（如军事威胁/情报威胁/内鬼风险层/政治威胁层）。',
      '16. setOpponentMatrix.opponents[].opponent_name 不能写“对手1/对手2”，必须写具体人物或势力名称。',
      '17. setOpponentMatrix.opponents[].threat_type 不允许为空，必须写威胁方式（如军事碾压/情报泄露/决策干扰/身份暴露风险）。',
      '18. 权力升级阶梯要体现主角身份、能力边界和阶段变化。',
      '19. 内鬼系统要体现角色伪装、真实身份、使命与阶段推进；即使是“非典型内鬼”也需写清被纳入内鬼系统的理由。',
      '20. 故事发展阶段要体现历史走向与改写走向的对照，historical_path 与 rewrite_path 不能复读。',
      '21. 如证据不足，也要优先结合已有证据补全关键逻辑，不要轻易留空。',
    ].join('\n');

    const outputBlock = [
      '【输出格式要求】',
      '{',
      '  "setPayoffArch": { "name": "字符串", "notes": "字符串", "lines": [] },',
      '  "setOpponentMatrix": { "name": "字符串", "description": "字符串", "opponents": [] },',
      '  "setPowerLadder": [],',
      '  "setTraitorSystem": { "name": "字符串", "description": "字符串", "traitors": [], "stages": [] },',
      '  "setStoryPhases": []',
      '}',
    ].join('\n');

    return {
      promptPreview: [
        '【System Prompt】',
        '你是短剧世界观结构化提炼助手。你必须输出严格 JSON，不要输出 markdown，不要输出解释。',
        '',
        taskBlock,
        '',
        blocks.join('\n\n') || '【参考资料】\n无',
        '',
        userInstructionBlock,
        '',
        outputBlock,
      ].join('\n'),
      referenceSummary: summary,
    };
  }

  private async buildReferenceBlocks(
    novelId: number,
    referenceTables: PipelineWorldviewReferenceTable[],
    sourceTextCharBudget: number | undefined,
    warnings: string[],
  ): Promise<{ blocks: string[]; summary: ReferenceSummaryItem[] }> {
    const blocks: string[] = [];
    const summary: ReferenceSummaryItem[] = [];

    if (referenceTables.includes('drama_novels')) {
      const row = await this.getNovelBaseInfo(novelId);
      if (row) {
        blocks.push(
          [
            '【项目基础信息】',
            `项目名：${row.novels_name ?? ''}`,
            `简介：${this.trimBlock(row.description, 1000)}`,
            `总章节：${row.total_chapters ?? ''}`,
            `升级节奏：${row.power_up_interval ?? ''}`,
            `作者：${row.author ?? ''}`,
          ].join('\n'),
        );
        summary.push({
          table: 'drama_novels',
          label: '项目基础信息',
          rowCount: 1,
          fields: [
            'novels_name',
            'description',
            'total_chapters',
            'power_up_interval',
            'author',
          ],
        });
      }
    }

    if (referenceTables.includes('drama_source_text')) {
      const sourceText = await this.sourceRetrievalService.buildWorldviewEvidence(
        novelId,
        sourceTextCharBudget,
      );
      warnings.push(...sourceText.warnings);
      if (sourceText.block) {
        blocks.push(sourceText.block);
      }
      summary.push({
        table: 'drama_source_text',
        label: sourceText.usedSegments ? '原文证据片段' : '原始素材节选',
        rowCount: sourceText.segmentCount,
        fields: sourceText.usedSegments
          ? ['chapter_label', 'title_hint', 'content_text', 'keyword_text']
          : ['source_text'],
        usedChars: sourceText.evidenceChars,
        note: sourceText.usedSegments
          ? `segments evidence=${sourceText.segmentCount} 段，覆盖章节=${sourceText.chapterCount}，raw fallback=${sourceText.usedFallback ? 'yes' : 'no'}`
          : sourceText.usedFallback
            ? 'segments 不可用，已使用小段 raw fallback'
            : '未找到可用原始素材',
        segmentCount: sourceText.segmentCount,
        chapterCount: sourceText.chapterCount,
        usedFallback: sourceText.usedFallback,
        moduleEvidenceCount: sourceText.moduleEvidenceCount,
      });
    }

    const latestStrategy = referenceTables.includes('novel_adaptation_strategy')
      ? await this.getLatestAdaptationStrategy(novelId)
      : null;

    if (latestStrategy) {
      blocks.push(
        [
          '【改编策略】',
          `版本：v${latestStrategy.version ?? ''}`,
          `标题：${latestStrategy.strategyTitle ?? ''}`,
          `说明：${this.trimBlock(latestStrategy.strategyDescription, 1000)}`,
          `Prompt 模板：${this.trimBlock(latestStrategy.aiPromptTemplate, 1200)}`,
        ].join('\n'),
      );
      summary.push({
        table: 'novel_adaptation_strategy',
        label: '改编策略',
        rowCount: 1,
        fields: ['strategy_title', 'strategy_description', 'ai_prompt_template'],
      });
    }

    if (referenceTables.includes('adaptation_modes') && latestStrategy?.modeId) {
      const mode = await this.getAdaptationModeById(Number(latestStrategy.modeId));
      if (mode) {
        blocks.push(
          [
            '【改编模式】',
            `mode_key：${mode.mode_key ?? ''}`,
            `mode_name：${mode.mode_name ?? ''}`,
            `description：${this.trimBlock(mode.description, 600)}`,
          ].join('\n'),
        );
        summary.push({
          table: 'adaptation_modes',
          label: '改编模式',
          rowCount: 1,
          fields: ['mode_key', 'mode_name', 'description'],
        });
      }
    }

    if (referenceTables.includes('set_core')) {
      const activeSetCore = await this.getActiveSetCore(novelId);
      if (activeSetCore) {
        blocks.push(
          [
            '【当前核心设定】',
            `title：${activeSetCore.title ?? ''}`,
            `core_text：${this.trimBlock(activeSetCore.core_text, 2400)}`,
            `protagonist_name：${activeSetCore.protagonist_name ?? ''}`,
            `protagonist_identity：${activeSetCore.protagonist_identity ?? ''}`,
            `target_story：${activeSetCore.target_story ?? ''}`,
            `rewrite_goal：${activeSetCore.rewrite_goal ?? ''}`,
            `constraint_text：${activeSetCore.constraint_text ?? ''}`,
          ].join('\n'),
        );
        summary.push({
          table: 'set_core',
          label: '当前核心设定',
          rowCount: 1,
          fields: [
            'title',
            'core_text',
            'protagonist_name',
            'protagonist_identity',
            'target_story',
            'rewrite_goal',
            'constraint_text',
          ],
        });
      }
    }

    const timelineRows = referenceTables.includes('novel_timelines')
      ? await this.selectByNovel('novel_timelines', 't', novelId, 't.sort_order')
      : [];
    if (referenceTables.includes('novel_timelines')) {
      if (timelineRows.length) {
        blocks.push(
          [
            '【时间线】',
            ...timelineRows
              .slice(0, 24)
              .map((row) => `- [${row.time_node ?? ''}] ${this.trimBlock(row.event, 260)}`),
          ].join('\n'),
        );
      }
      summary.push({
        table: 'novel_timelines',
        label: '时间线',
        rowCount: timelineRows.length,
        fields: ['time_node', 'event'],
      });
    }

    const characterRows = referenceTables.includes('novel_characters')
      ? await this.selectByNovel('novel_characters', 'c', novelId, 'c.sort_order')
      : [];
    if (referenceTables.includes('novel_characters')) {
      if (characterRows.length) {
        blocks.push(
          [
            '【人物信息】',
            ...characterRows.slice(0, 18).map(
              (row) =>
                `- ${row.name ?? ''}｜${row.faction ?? ''}｜${this.trimBlock(
                  row.description,
                  180,
                )}｜${this.trimBlock(row.personality, 100)}｜${this.trimBlock(
                  row.setting_words,
                  100,
                )}`,
            ),
          ].join('\n'),
        );
      }
      summary.push({
        table: 'novel_characters',
        label: '人物信息',
        rowCount: characterRows.length,
        fields: ['name', 'faction', 'description', 'personality', 'setting_words'],
      });
    }

    const keyNodeRows = referenceTables.includes('novel_key_nodes')
      ? await this.selectByNovel('novel_key_nodes', 'k', novelId, 'k.sort_order')
      : [];
    if (referenceTables.includes('novel_key_nodes')) {
      if (keyNodeRows.length) {
        blocks.push(
          [
            '【关键节点】',
            ...keyNodeRows.slice(0, 18).map(
              (row) =>
                `- ${row.category ?? ''}｜${row.title ?? ''}｜${this.trimBlock(
                  row.description,
                  240,
                )}`,
            ),
          ].join('\n'),
        );
      }
      summary.push({
        table: 'novel_key_nodes',
        label: '关键节点',
        rowCount: keyNodeRows.length,
        fields: ['category', 'title', 'description'],
      });
    }

    const topicRows = referenceTables.includes('novel_skeleton_topics')
      ? await this.selectByNovel('novel_skeleton_topics', 'st', novelId, 'st.sort_order')
      : [];
    if (referenceTables.includes('novel_skeleton_topics')) {
      if (topicRows.length) {
        blocks.push(
          [
            '【骨架主题】',
            ...topicRows.slice(0, 20).map(
              (row) =>
                `- ${row.topic_name ?? ''}｜${row.topic_key ?? ''}｜${row.topic_type ?? ''}｜${row.description ?? ''}`,
            ),
          ].join('\n'),
        );
      }
      summary.push({
        table: 'novel_skeleton_topics',
        label: '骨架主题',
        rowCount: topicRows.length,
        fields: ['topic_key', 'topic_name', 'topic_type', 'description'],
      });
    }

    const topicItemRows = referenceTables.includes('novel_skeleton_topic_items')
      ? await this.selectByNovel(
          'novel_skeleton_topic_items',
          'si',
          novelId,
          'si.sort_order',
        )
      : [];
    if (referenceTables.includes('novel_skeleton_topic_items')) {
      if (topicItemRows.length) {
        const topicNameMap = new Map<number, string>();
        topicRows.forEach((row) =>
          topicNameMap.set(Number(row.id), row.topic_name ?? `Topic#${row.id}`),
        );
        const grouped = new Map<number, RowRecord[]>();
        topicItemRows.slice(0, 40).forEach((row) => {
          const topicId = Number(row.topic_id);
          if (!grouped.has(topicId)) {
            grouped.set(topicId, []);
          }
          grouped.get(topicId)!.push(row);
        });
        const lines: string[] = ['【骨架主题详情】'];
        grouped.forEach((rows, topicId) => {
          lines.push(`主题：${topicNameMap.get(topicId) ?? `Topic#${topicId}`}`);
          rows.forEach((row) => {
            lines.push(
              `- ${row.item_title ?? ''}：${this.trimBlock(row.content, 180)}${
                row.source_ref ? `（来源：${row.source_ref}）` : ''
              }`,
            );
          });
        });
        blocks.push(lines.join('\n'));
      }
      summary.push({
        table: 'novel_skeleton_topic_items',
        label: '骨架主题详情',
        rowCount: topicItemRows.length,
        fields: ['item_title', 'content', 'source_ref'],
      });
    }

    const explosionRows = referenceTables.includes('novel_explosions')
      ? await this.selectByNovel('novel_explosions', 'e', novelId, 'e.sort_order')
      : [];
    if (referenceTables.includes('novel_explosions')) {
      if (explosionRows.length) {
        blocks.push(
          [
            '【爆点设计】',
            ...explosionRows.slice(0, 18).map(
              (row) =>
                `- ${row.explosion_type ?? ''}｜${row.title ?? ''}｜${row.subtitle ?? ''}｜${this.trimBlock(
                  row.scene_restoration,
                  140,
                )}｜${this.trimBlock(row.dramatic_quality, 120)}｜${this.trimBlock(
                  row.adaptability,
                  120,
                )}`,
            ),
          ].join('\n'),
        );
      }
      summary.push({
        table: 'novel_explosions',
        label: '爆点设计',
        rowCount: explosionRows.length,
        fields: [
          'explosion_type',
          'title',
          'subtitle',
          'scene_restoration',
          'dramatic_quality',
          'adaptability',
        ],
      });
    }

    return { blocks, summary };
  }

  private buildEvidenceSummary(
    referenceSummary: ReferenceSummaryItem[],
  ): WorldviewEvidenceSummary | undefined {
    const sourceSummary = referenceSummary.find((item) => item.table === 'drama_source_text');
    if (!sourceSummary) {
      return undefined;
    }

    return {
      evidenceSegments: sourceSummary.segmentCount ?? sourceSummary.rowCount ?? 0,
      coverageChapters: sourceSummary.chapterCount ?? 0,
      evidenceChars: sourceSummary.usedChars ?? 0,
      fallbackUsed: Boolean(sourceSummary.usedFallback),
      moduleEvidenceCount: sourceSummary.moduleEvidenceCount ?? {},
    };
  }

  private async validateAndNormalizeWorldviewDraft(
    novelId: number,
    rawDraft: unknown,
    normalizationWarnings: string[],
    validationWarnings: string[],
  ): Promise<WorldviewDraft> {
    const root = this.asRecord(rawDraft);
    if (!root) {
      throw new BadRequestException('Worldview draft must be a JSON object');
    }
    const characterHints = await this.loadCharacterIdentityHints(novelId);

    const setPayoffArchRaw = this.asRecord(root.setPayoffArch) ?? {};
    const setOpponentMatrixRaw = this.asRecord(root.setOpponentMatrix) ?? {};
    const setTraitorSystemRaw = this.asRecord(root.setTraitorSystem) ?? {};

    if (!root.setPayoffArch) {
      validationWarnings.push('Missing setPayoffArch, fallback to empty object');
    }
    if (!root.setOpponentMatrix) {
      validationWarnings.push('Missing setOpponentMatrix, fallback to empty object');
    }
    if (!root.setTraitorSystem) {
      validationWarnings.push('Missing setTraitorSystem, fallback to empty object');
    }
    if (!Array.isArray(root.setPowerLadder)) {
      validationWarnings.push('Missing or invalid setPowerLadder, fallback to empty array');
    }
    if (!Array.isArray(root.setStoryPhases)) {
      validationWarnings.push('Missing or invalid setStoryPhases, fallback to empty array');
    }

    const draft: WorldviewDraft = {
      setPayoffArch: {
        name: this.normalizeText(setPayoffArchRaw.name) || '',
        notes: this.normalizeText(setPayoffArchRaw.notes) || '',
        lines: this.normalizeArray(setPayoffArchRaw.lines).map((item, index) => {
          const row = this.asRecord(item) ?? {};
          return {
            line_key: this.normalizeText(row.line_key) || `line_${index + 1}`,
            line_name: this.normalizeText(row.line_name) || `爽点线${index + 1}`,
            line_content: this.normalizeText(row.line_content) || '',
            start_ep: this.normalizeOptionalInt(row.start_ep),
            end_ep: this.normalizeOptionalInt(row.end_ep),
            stage_text: this.normalizeNullableText(row.stage_text),
            sort_order: this.normalizeOptionalInt(row.sort_order) ?? index,
          };
        }),
      },
      setOpponentMatrix: {
        name: this.normalizeText(setOpponentMatrixRaw.name) || '',
        description: this.normalizeText(setOpponentMatrixRaw.description) || '',
        opponents: this.normalizeArray(setOpponentMatrixRaw.opponents).map(
          (item, index) => {
            const row = this.asRecord(item) ?? {};
            return {
              level_name: this.normalizeText(row.level_name) || `层级${index + 1}`,
              opponent_name:
                this.normalizeText(row.opponent_name) || `对手${index + 1}`,
              threat_type: this.normalizeNullableText(row.threat_type),
              detailed_desc: this.normalizeNullableText(row.detailed_desc),
              sort_order: this.normalizeOptionalInt(row.sort_order) ?? index,
            };
          },
        ),
      },
      setPowerLadder: this.normalizeArray(root.setPowerLadder).map((item, index) => {
        const row = this.asRecord(item) ?? {};
        return {
          level_no: this.normalizeOptionalInt(row.level_no) ?? index + 1,
          level_title: this.normalizeText(row.level_title) || `Lv.${index + 1}`,
          identity_desc: this.normalizeText(row.identity_desc) || '',
          ability_boundary: this.normalizeText(row.ability_boundary) || '',
          start_ep: this.normalizeOptionalInt(row.start_ep),
          end_ep: this.normalizeOptionalInt(row.end_ep),
          sort_order: this.normalizeOptionalInt(row.sort_order) ?? index,
        };
      }),
      setTraitorSystem: {
        name: this.normalizeText(setTraitorSystemRaw.name) || '',
        description: this.normalizeText(setTraitorSystemRaw.description) || '',
        traitors: this.normalizeArray(setTraitorSystemRaw.traitors).map(
          (item, index) => {
            const row = this.asRecord(item) ?? {};
            const mission = this.normalizeNullableText(row.mission);
            const threatDesc = this.normalizeNullableText(row.threat_desc);
            const publicIdentity = this.normalizeNullableText(row.public_identity);
            const realIdentity = this.normalizeNullableText(row.real_identity);
            return {
              name: this.normalizeText(row.name) || `内鬼${index + 1}`,
              public_identity: publicIdentity,
              real_identity: realIdentity,
              mission:
                mission ||
                `在关键节点执行潜伏渗透与情报误导，制造“里应外合”风险（角色：${
                  publicIdentity || realIdentity || `内鬼${index + 1}`
                }）。`,
              threat_desc:
                threatDesc ||
                `该角色以${publicIdentity || '潜伏身份'}影响决策链路，在战局关键点制造背叛/失守风险。`,
              sort_order: this.normalizeOptionalInt(row.sort_order) ?? index,
            };
          },
        ),
        stages: this.normalizeArray(setTraitorSystemRaw.stages).map((item, index) => {
          const row = this.asRecord(item) ?? {};
          const stageTitle = this.normalizeText(row.stage_title) || `阶段${index + 1}`;
          const stageDesc = this.normalizeText(row.stage_desc);
          return {
            stage_title: stageTitle,
            stage_desc:
              stageDesc ||
              `围绕“${stageTitle}”推进内鬼线：从可疑线索到潜伏布局，再到暴露与反制，形成阶段升级。`,
            start_ep: this.normalizeOptionalInt(row.start_ep),
            end_ep: this.normalizeOptionalInt(row.end_ep),
            sort_order: this.normalizeOptionalInt(row.sort_order) ?? index,
          };
        }),
      },
      setStoryPhases: this.normalizeArray(root.setStoryPhases).map((item, index) => {
        const row = this.asRecord(item) ?? {};
        return {
          phase_name: this.normalizeText(row.phase_name) || `阶段${index + 1}`,
          start_ep: this.normalizeOptionalInt(row.start_ep),
          end_ep: this.normalizeOptionalInt(row.end_ep),
          historical_path: this.normalizeNullableText(row.historical_path),
          rewrite_path: this.normalizeNullableText(row.rewrite_path),
          sort_order: this.normalizeOptionalInt(row.sort_order) ?? index,
        };
      }),
    };

    draft.setPayoffArch.lines.forEach((row, index) => {
      if (!row.line_content) {
        normalizationWarnings.push(`setPayoffArch.lines[${index}] line_content is empty`);
      }
    });
    draft.setPowerLadder.forEach((row, index) => {
      if (!row.identity_desc && !row.ability_boundary) {
        normalizationWarnings.push(
          `setPowerLadder[${index}] identity_desc and ability_boundary are both empty`,
        );
      }
    });
    draft.setStoryPhases.forEach((row, index) => {
      if (!row.historical_path && !row.rewrite_path) {
        normalizationWarnings.push(
          `setStoryPhases[${index}] historical_path and rewrite_path are both empty`,
        );
      }
    });

    this.applyTraitorIdentityFallback(draft, characterHints, normalizationWarnings);
    this.normalizeStoryPhaseEpisodeBounds(draft, normalizationWarnings);

    return draft;
  }

  private applyCurrentSchemaOptimization<T extends WorldviewDraft | WorldviewDraftShape>(
    draft: T,
    totalChapters: number | null,
  ): {
    draft: T;
    inferenceSummary: WorldviewInferenceSummary;
    inferenceWarnings: Array<
      | StoryPhaseInferenceWarning
      | PayoffInferenceWarning
      | PowerInferenceWarning
      | TraitorStageInferenceWarning
    >;
    alignmentSummary: WorldviewAlignmentSummary;
    alignmentWarnings: WorldviewAlignmentWarning[];
  } {
    const storyInference = this.storyPhaseInference.apply({
      storyPhases: draft.setStoryPhases,
      totalChapters,
    });
    const withStory = {
      ...draft,
      setStoryPhases: storyInference.storyPhases.map((item, index) => ({
        ...item,
        sort_order:
          (draft as WorldviewDraft).setStoryPhases?.[index]?.sort_order ?? index,
      })),
    } as WorldviewDraft;

    const payoffInference = this.payoffInference.apply({
      lines: withStory.setPayoffArch.lines,
      storyPhases: withStory.setStoryPhases,
      totalChapters,
    });
    withStory.setPayoffArch = {
      ...withStory.setPayoffArch,
      lines: payoffInference.lines.map((item, index) => ({
        line_key:
          withStory.setPayoffArch.lines?.[index]?.line_key ??
          `line_${index + 1}`,
        ...item,
        sort_order:
          withStory.setPayoffArch.lines?.[index]?.sort_order ?? index,
      })),
    };

    const powerInference = this.powerInference.apply({
      powerLadder: withStory.setPowerLadder,
      storyPhases: withStory.setStoryPhases,
      totalChapters,
    });
    withStory.setPowerLadder = powerInference.powerLadder.map((item, index) => ({
      ...item,
      sort_order:
        withStory.setPowerLadder?.[index]?.sort_order ?? index,
    }));

    const traitorStageInference = this.traitorStageInference.apply({
      stages: withStory.setTraitorSystem.stages,
      storyPhases: withStory.setStoryPhases,
      totalChapters,
    });
    withStory.setTraitorSystem = {
      ...withStory.setTraitorSystem,
      stages: traitorStageInference.stages.map((item, index) => ({
        ...item,
        sort_order:
          withStory.setTraitorSystem.stages?.[index]?.sort_order ?? index,
      })),
    };

    withStory.setOpponentMatrix = {
      ...withStory.setOpponentMatrix,
      opponents: withStory.setOpponentMatrix.opponents.map((item, index) =>
        this.hardenOpponentFields(item, index),
      ),
    };

    const { alignmentSummary, alignmentWarnings } = this.crossTableAlignmentChecker.evaluate({
      totalChapters,
      setPayoffArch: withStory.setPayoffArch,
      setOpponentMatrix: withStory.setOpponentMatrix,
      setPowerLadder: withStory.setPowerLadder,
      setTraitorSystem: withStory.setTraitorSystem,
      setStoryPhases: withStory.setStoryPhases,
    });

    return {
      draft: withStory as T,
      inferenceSummary: {
        storyPhase: storyInference.summary,
        payoff: payoffInference.summary,
        power: powerInference.summary,
        traitorStage: traitorStageInference.summary,
      },
      inferenceWarnings: [
        ...storyInference.warnings,
        ...payoffInference.warnings,
        ...powerInference.warnings,
        ...traitorStageInference.warnings,
      ],
      alignmentSummary,
      alignmentWarnings,
    };
  }

  private mergeOptimizationWarnings(
    qualityWarnings: WorldviewQualityWarning[],
    inferenceWarnings: Array<
      | StoryPhaseInferenceWarning
      | PayoffInferenceWarning
      | PowerInferenceWarning
      | TraitorStageInferenceWarning
    >,
    alignmentWarnings: WorldviewAlignmentWarning[],
  ): WorldviewQualityWarning[] {
    if (!inferenceWarnings.length && !alignmentWarnings.length) {
      return qualityWarnings;
    }
    const merged = [...qualityWarnings];
    inferenceWarnings.forEach((item) => {
      const moduleKey = this.resolveModuleKeyByPath(item.path);
      merged.push({
        moduleKey,
        path: item.path,
        severity: item.severity,
        reason: `${item.reason} (auto-fixed/inferred)`,
      });
    });
    alignmentWarnings.forEach((item) => {
      merged.push({
        moduleKey: item.moduleKey,
        path: item.path,
        severity: item.severity,
        reason: `${item.reason} (cross-table alignment)`,
      });
    });
    return merged;
  }

  private resolveModuleKeyByPath(path: string): WorldviewQualityWarning['moduleKey'] {
    if (path.startsWith('setPayoffArch.lines')) return 'payoff';
    if (path.startsWith('setPowerLadder')) return 'power';
    if (path.startsWith('setTraitorSystem')) return 'traitor';
    if (path.startsWith('setOpponentMatrix')) return 'opponents';
    return 'story_phase';
  }

  private hardenOpponentFields(
    row: WorldviewDraft['setOpponentMatrix']['opponents'][number],
    index: number,
  ): WorldviewDraft['setOpponentMatrix']['opponents'][number] {
    const desc = this.normalizeText(row.detailed_desc);
    const currentThreat = this.normalizeText(row.threat_type);
    const currentLevel = this.normalizeText(row.level_name);
    const currentName = this.normalizeText(row.opponent_name);

    let levelName = currentLevel;
    if (/^(层级|分类)\d+$/u.test(levelName)) {
      levelName = this.inferOpponentLevel(desc, currentThreat) || `威胁层${index + 1}`;
    }

    let opponentName = currentName;
    if (/^(对手|角色)\d+$/u.test(opponentName) || !opponentName) {
      opponentName =
        this.inferOpponentName(desc) ||
        this.inferOpponentName(currentThreat) ||
        `关键威胁角色${index + 1}`;
    }

    let threatType = currentThreat;
    if (!threatType) {
      threatType = this.inferThreatType(desc) || '复合威胁';
    }

    return {
      ...row,
      level_name: levelName,
      opponent_name: opponentName,
      threat_type: threatType,
    };
  }

  private inferOpponentName(text: string): string | null {
    if (!text) return null;
    const candidates = ['朱棣', '姚广孝', '李景隆', '黄子澄', '齐泰', '建文帝', '朱允炆', '燕王府', '朝堂保守派'];
    for (const candidate of candidates) {
      if (text.includes(candidate)) return candidate;
    }
    return null;
  }

  private inferOpponentLevel(desc: string, threatType: string): string | null {
    const text = `${desc} ${threatType}`;
    if (/军事|兵权|战场|北军|南军/u.test(text)) return '军事威胁层';
    if (/情报|泄密|渗透|内应|暗线/u.test(text)) return '情报渗透层';
    if (/朝堂|决策|重臣|政治/u.test(text)) return '政治决策层';
    if (/身份|暴露|信任危机/u.test(text)) return '身份危机层';
    return null;
  }

  private inferThreatType(text: string): string | null {
    if (!text) return null;
    if (/军事|兵权|战场|起兵/u.test(text)) return '军事威胁';
    if (/情报|泄密|渗透|暗线|内应/u.test(text)) return '情报威胁';
    if (/身份|暴露|伪装/u.test(text)) return '身份危机';
    if (/决策|误导|拖后腿|掣肘/u.test(text)) return '决策干扰';
    return null;
  }

  private applyTraitorIdentityFallback(
    draft: WorldviewDraft,
    characterHints: Map<string, { publicIdentity: string | null; realIdentity: string | null }>,
    normalizationWarnings: string[],
  ) {
    draft.setTraitorSystem.traitors = draft.setTraitorSystem.traitors.map((row, index) => {
      const name = this.normalizeText(row.name) || `内鬼${index + 1}`;
      const hint = characterHints.get(name) ?? { publicIdentity: null, realIdentity: null };
      const mission = this.normalizeText(row.mission);
      const threatDesc = this.normalizeText(row.threat_desc);
      let publicIdentity = this.normalizeText(row.public_identity) || this.normalizeText(hint.publicIdentity);
      let realIdentity = this.normalizeText(row.real_identity) || this.normalizeText(hint.realIdentity);

      if (!publicIdentity) {
        if (/主将|朝廷|重臣|帝|将领/u.test(mission + threatDesc)) {
          publicIdentity = '朝廷主将/重臣（表面忠诚）';
        } else if (/王府|幕僚|长史/u.test(mission + threatDesc)) {
          publicIdentity = '王府幕僚（表面身份）';
        } else {
          publicIdentity = '表面忠臣/关键角色';
        }
        normalizationWarnings.push(
          `setTraitorSystem.traitors[${index}].public_identity missing, fallback applied`,
        );
      }

      if (!realIdentity) {
        if (/内应|通敌|叛|渗透|潜伏|里应外合|开城门/u.test(mission + threatDesc)) {
          realIdentity = '潜在内应/暗中通敌者';
        } else if (/双面|策反/u.test(mission + threatDesc)) {
          realIdentity = '双面角色/被策反者';
        } else {
          realIdentity = '隐藏立场角色';
        }
        normalizationWarnings.push(
          `setTraitorSystem.traitors[${index}].real_identity missing, fallback applied`,
        );
      }

      if (publicIdentity === realIdentity) {
        realIdentity = `${realIdentity}（隐藏立场）`;
        normalizationWarnings.push(
          `setTraitorSystem.traitors[${index}] identity fields are identical, real_identity adjusted`,
        );
      }

      return {
        ...row,
        public_identity: publicIdentity,
        real_identity: realIdentity,
      };
    });
  }

  private normalizeStoryPhaseEpisodeBounds(
    draft: WorldviewDraft,
    normalizationWarnings: string[],
  ) {
    draft.setStoryPhases = draft.setStoryPhases.map((row, index) => {
      const startEp = row.start_ep;
      const endEp = row.end_ep;
      if (startEp !== null && endEp !== null && startEp > endEp) {
        normalizationWarnings.push(
          `setStoryPhases[${index}] start_ep > end_ep, swapped automatically`,
        );
        return {
          ...row,
          start_ep: endEp,
          end_ep: startEp,
        };
      }
      return row;
    });
  }

  private async loadCharacterIdentityHints(
    novelId: number,
  ): Promise<Map<string, { publicIdentity: string | null; realIdentity: string | null }>> {
    const hints = new Map<string, { publicIdentity: string | null; realIdentity: string | null }>();
    if (!(await this.hasTable('novel_characters'))) {
      return hints;
    }

    const rows = await this.dataSource.query(
      `
      SELECT name, faction, description
      FROM novel_characters
      WHERE novel_id = ?
      ORDER BY sort_order ASC, id ASC
      `,
      [novelId],
    );

    rows.forEach((row: RowRecord) => {
      const name = this.normalizeText(row.name);
      if (!name) return;

      const faction = this.normalizeText(row.faction);
      const description = this.normalizeText(row.description);
      const publicIdentity = faction ? `${faction}阵营角色` : null;
      let realIdentity: string | null = null;
      if (/内应|叛徒|通敌|潜伏|渗透|可疑/u.test(description)) {
        realIdentity = '潜在内应/暗中通敌者';
      }
      hints.set(name, { publicIdentity, realIdentity });
    });

    return hints;
  }

  private async getNovelTotalChapters(novelId: number): Promise<number | null> {
    const rows = await this.dataSource.query(
      `
      SELECT total_chapters AS totalChapters
      FROM drama_novels
      WHERE id = ?
      LIMIT 1
      `,
      [novelId],
    );
    const totalChapters = this.normalizeOptionalInt(rows[0]?.totalChapters);
    return totalChapters && totalChapters > 0 ? totalChapters : null;
  }

  private async loadPersistedWorldviewDraft(novelId: number): Promise<WorldviewDraftShape> {
    const payoffArchRows = await this.selectByNovel('set_payoff_arch', 'pa', novelId, 'pa.id');
    const payoffLineRows = await this.selectByNovel('set_payoff_lines', 'pl', novelId, 'pl.sort_order');
    const opponentMatrixRows = await this.selectByNovel(
      'set_opponent_matrix',
      'om',
      novelId,
      'om.id',
    );
    const opponentRows = await this.selectByNovel('set_opponents', 'op', novelId, 'op.sort_order');
    const powerRows = await this.selectByNovel('set_power_ladder', 'pw', novelId, 'pw.sort_order');
    const traitorSystemRows = await this.selectByNovel('set_traitor_system', 'ts', novelId, 'ts.id');
    const traitorRows = await this.selectByNovel('set_traitors', 'tr', novelId, 'tr.sort_order');
    const traitorStageRows = await this.selectByNovel(
      'set_traitor_stages',
      'st',
      novelId,
      'st.sort_order',
    );
    const storyRows = await this.selectByNovel('set_story_phases', 'sp', novelId, 'sp.sort_order');

    const activePayoffArch = payoffArchRows[0] ?? {};
    const activeOpponentMatrix = opponentMatrixRows[0] ?? {};
    const activeTraitorSystem = traitorSystemRows[0] ?? {};
    const payoffArchId = this.normalizeOptionalInt(activePayoffArch.id);
    const opponentMatrixId = this.normalizeOptionalInt(activeOpponentMatrix.id);
    const traitorSystemId = this.normalizeOptionalInt(activeTraitorSystem.id);

    return {
      setPayoffArch: {
        name: this.normalizeText(activePayoffArch.name),
        notes: this.normalizeText(activePayoffArch.notes),
        lines: payoffLineRows
          .filter((row) =>
            payoffArchId === null
              ? true
              : this.normalizeOptionalInt(row.payoff_arch_id) === payoffArchId,
          )
          .map((row) => ({
            line_name: this.normalizeText(row.line_name),
            line_content: this.normalizeText(row.line_content),
            start_ep: this.normalizeOptionalInt(row.start_ep),
            end_ep: this.normalizeOptionalInt(row.end_ep),
            stage_text: this.normalizeNullableText(row.stage_text),
          })),
      },
      setOpponentMatrix: {
        name: this.normalizeText(activeOpponentMatrix.name),
        description: this.normalizeText(activeOpponentMatrix.description),
        opponents: opponentRows
          .filter((row) =>
            opponentMatrixId === null
              ? true
              : this.normalizeOptionalInt(row.opponent_matrix_id) === opponentMatrixId,
          )
          .map((row) => ({
            level_name: this.normalizeText(row.level_name),
            opponent_name: this.normalizeText(row.opponent_name),
            threat_type: this.normalizeNullableText(row.threat_type),
            detailed_desc: this.normalizeNullableText(row.detailed_desc),
          })),
      },
      setPowerLadder: powerRows.map((row) => ({
        level_title: this.normalizeText(row.level_title),
        identity_desc: this.normalizeText(row.identity_desc),
        ability_boundary: this.normalizeText(row.ability_boundary),
        start_ep: this.normalizeOptionalInt(row.start_ep),
        end_ep: this.normalizeOptionalInt(row.end_ep),
      })),
      setTraitorSystem: {
        name: this.normalizeText(activeTraitorSystem.name),
        description: this.normalizeText(activeTraitorSystem.description),
        traitors: traitorRows
          .filter((row) =>
            traitorSystemId === null
              ? true
              : this.normalizeOptionalInt(row.traitor_system_id) === traitorSystemId,
          )
          .map((row) => ({
            public_identity: this.normalizeNullableText(row.public_identity),
            real_identity: this.normalizeNullableText(row.real_identity),
            mission: this.normalizeNullableText(row.mission),
            threat_desc: this.normalizeNullableText(row.threat_desc),
          })),
        stages: traitorStageRows
          .filter((row) =>
            traitorSystemId === null
              ? true
              : this.normalizeOptionalInt(row.traitor_system_id) === traitorSystemId,
          )
          .map((row) => ({
            stage_title: this.normalizeText(row.stage_title),
            stage_desc: this.normalizeText(row.stage_desc),
            start_ep: this.normalizeOptionalInt(row.start_ep),
            end_ep: this.normalizeOptionalInt(row.end_ep),
          })),
      },
      setStoryPhases: storyRows.map((row) => ({
        phase_name: this.normalizeText(row.phase_name),
        start_ep: this.normalizeOptionalInt(row.start_ep),
        end_ep: this.normalizeOptionalInt(row.end_ep),
        historical_path: this.normalizeNullableText(row.historical_path),
        rewrite_path: this.normalizeNullableText(row.rewrite_path),
      })),
    };
  }

  private async insertWorldviewDraft(
    novelId: number,
    draft: WorldviewDraft,
    manager: DataSource['manager'],
  ): Promise<WorldviewPersistSummary> {
    const summary: WorldviewPersistSummary = {
      payoffArch: 0,
      payoffLines: 0,
      opponentMatrix: 0,
      opponents: 0,
      powerLadder: 0,
      traitorSystem: 0,
      traitors: 0,
      traitorStages: 0,
      storyPhases: 0,
    };

    if (
      draft.setPayoffArch.name ||
      draft.setPayoffArch.notes ||
      draft.setPayoffArch.lines.length
    ) {
      const payoffResult: any = await manager.query(
        `
        INSERT INTO set_payoff_arch (novel_id, name, notes, version, is_active)
        VALUES (?, ?, ?, 1, 1)
        `,
        [
          novelId,
          draft.setPayoffArch.name || 'AI生成爽点架构',
          draft.setPayoffArch.notes || null,
        ],
      );
      const payoffArchId = Number(payoffResult.insertId);
      summary.payoffArch = 1;

      for (const row of draft.setPayoffArch.lines) {
        await manager.query(
          `
          INSERT INTO set_payoff_lines (
            novel_id, payoff_arch_id, line_key, line_name, line_content,
            start_ep, end_ep, stage_text, sort_order
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          `,
          [
            novelId,
            payoffArchId,
            row.line_key,
            row.line_name,
            row.line_content || '',
            row.start_ep,
            row.end_ep,
            row.stage_text,
            row.sort_order,
          ],
        );
        summary.payoffLines += 1;
      }
    }

    if (
      draft.setOpponentMatrix.name ||
      draft.setOpponentMatrix.description ||
      draft.setOpponentMatrix.opponents.length
    ) {
      const matrixResult: any = await manager.query(
        `
        INSERT INTO set_opponent_matrix (novel_id, name, description, version, is_active)
        VALUES (?, ?, ?, 1, 1)
        `,
        [
          novelId,
          draft.setOpponentMatrix.name || 'AI生成对手矩阵',
          draft.setOpponentMatrix.description || null,
        ],
      );
      const matrixId = Number(matrixResult.insertId);
      summary.opponentMatrix = 1;

      for (const row of draft.setOpponentMatrix.opponents) {
        await manager.query(
          `
          INSERT INTO set_opponents (
            novel_id, opponent_matrix_id, level_name, opponent_name,
            threat_type, detailed_desc, sort_order
          ) VALUES (?, ?, ?, ?, ?, ?, ?)
          `,
          [
            novelId,
            matrixId,
            row.level_name,
            row.opponent_name,
            row.threat_type,
            row.detailed_desc,
            row.sort_order,
          ],
        );
        summary.opponents += 1;
      }
    }

    for (const row of draft.setPowerLadder) {
      await manager.query(
        `
        INSERT INTO set_power_ladder (
          novel_id, level_no, level_title, identity_desc,
          ability_boundary, start_ep, end_ep, sort_order
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `,
        [
          novelId,
          row.level_no,
          row.level_title,
          row.identity_desc,
          row.ability_boundary,
          row.start_ep,
          row.end_ep,
          row.sort_order,
        ],
      );
      summary.powerLadder += 1;
    }

    if (
      draft.setTraitorSystem.name ||
      draft.setTraitorSystem.description ||
      draft.setTraitorSystem.traitors.length ||
      draft.setTraitorSystem.stages.length
    ) {
      const systemResult: any = await manager.query(
        `
        INSERT INTO set_traitor_system (novel_id, name, description, version, is_active)
        VALUES (?, ?, ?, 1, 1)
        `,
        [
          novelId,
          draft.setTraitorSystem.name || 'AI生成内鬼系统',
          draft.setTraitorSystem.description || null,
        ],
      );
      const systemId = Number(systemResult.insertId);
      summary.traitorSystem = 1;

      for (const row of draft.setTraitorSystem.traitors) {
        await manager.query(
          `
          INSERT INTO set_traitors (
            novel_id, traitor_system_id, name, public_identity,
            real_identity, mission, threat_desc, sort_order
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          `,
          [
            novelId,
            systemId,
            row.name,
            row.public_identity,
            row.real_identity,
            row.mission,
            row.threat_desc,
            row.sort_order,
          ],
        );
        summary.traitors += 1;
      }

      for (const row of draft.setTraitorSystem.stages) {
        await manager.query(
          `
          INSERT INTO set_traitor_stages (
            novel_id, traitor_system_id, stage_title, stage_desc,
            start_ep, end_ep, sort_order
          ) VALUES (?, ?, ?, ?, ?, ?, ?)
          `,
          [
            novelId,
            systemId,
            row.stage_title,
            row.stage_desc,
            row.start_ep,
            row.end_ep,
            row.sort_order,
          ],
        );
        summary.traitorStages += 1;
      }
    }

    for (const row of draft.setStoryPhases) {
      await manager.query(
        `
        INSERT INTO set_story_phases (
          novel_id, phase_name, start_ep, end_ep,
          historical_path, rewrite_path, sort_order
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
        `,
        [
          novelId,
          row.phase_name,
          row.start_ep ?? 0,
          row.end_ep ?? 0,
          row.historical_path,
          row.rewrite_path,
          row.sort_order,
        ],
      );
      summary.storyPhases += 1;
    }

    return summary;
  }

  private async deleteExistingWorldviewData(
    novelId: number,
    manager: DataSource['manager'],
  ): Promise<void> {
    const deleteOrder = [
      'set_payoff_lines',
      'set_opponents',
      'set_traitors',
      'set_traitor_stages',
      'set_story_phases',
      'set_power_ladder',
      'set_payoff_arch',
      'set_opponent_matrix',
      'set_traitor_system',
    ];
    for (const tableName of deleteOrder) {
      await manager.query(`DELETE FROM ${tableName} WHERE novel_id = ?`, [novelId]);
    }
  }

  private async assertOutputTablesExist(): Promise<void> {
    const requiredTables = [
      'set_payoff_arch',
      'set_payoff_lines',
      'set_opponent_matrix',
      'set_opponents',
      'set_power_ladder',
      'set_traitor_system',
      'set_traitors',
      'set_traitor_stages',
      'set_story_phases',
    ];
    const missing: string[] = [];
    for (const tableName of requiredTables) {
      if (!(await this.hasTable(tableName))) {
        missing.push(tableName);
      }
    }
    if (missing.length) {
      throw new BadRequestException(`Missing worldview tables: ${missing.join(', ')}`);
    }
  }

  private async getNovelBaseInfo(novelId: number): Promise<RowRecord | null> {
    const rows = await this.dataSource.query(
      `
      SELECT novels_name, description, total_chapters, power_up_interval, author
      FROM drama_novels
      WHERE id = ?
      LIMIT 1
      `,
      [novelId],
    );
    return rows[0] ?? null;
  }

  private async getSourceTextBlock(
    novelId: number,
    charBudget: number,
  ): Promise<SourceTextBlockResult> {
    if (!(await this.hasTable('drama_source_text'))) {
      return {
        block: '',
        rowCount: 0,
        usedChars: 0,
        originalChars: 0,
        warnings: ['drama_source_text table not found, skipped source text'],
      };
    }

    const rows = await this.dataSource.query(
      `
      SELECT source_text AS sourceText
      FROM drama_source_text
      WHERE novels_id = ?
      ORDER BY update_time DESC, id DESC
      `,
      [novelId],
    );
    const originalChars = rows.reduce((sum: number, row: RowRecord) => {
      const text = this.normalizeText(row.sourceText);
      return sum + (text?.length ?? 0);
    }, 0);

    if (!rows.length) {
      return { block: '', rowCount: 0, usedChars: 0, originalChars, warnings: [] };
    }

    const parts: string[] = ['【原始素材节选】'];
    let usedChars = 0;
    for (const [index, row] of rows.entries()) {
      const text = this.normalizeText(row.sourceText);
      if (!text) continue;
      const remaining = charBudget - usedChars;
      if (remaining <= 0) break;
      const truncated = this.trimBlock(text, Math.min(remaining, MAX_SOURCE_TEXT_PER_ROW));
      parts.push(`--- 原始资料 ${index + 1} ---`);
      parts.push(truncated);
      usedChars += truncated.length;
    }

    const warnings: string[] = [];
    if (originalChars > usedChars) {
      warnings.push(
        `drama_source_text 已节选 ${usedChars} 字符（原始总量 ${originalChars}），不会全量投喂模型`,
      );
    }

    return {
      block: parts.join('\n'),
      rowCount: rows.length,
      usedChars,
      originalChars,
      warnings,
    };
  }

  private async getLatestAdaptationStrategy(novelId: number): Promise<RowRecord | null> {
    if (!(await this.hasTable('novel_adaptation_strategy'))) {
      return null;
    }

    const rows = await this.dataSource.query(
      `
      SELECT
        id,
        mode_id AS modeId,
        strategy_title AS strategyTitle,
        strategy_description AS strategyDescription,
        ai_prompt_template AS aiPromptTemplate,
        version
      FROM novel_adaptation_strategy
      WHERE novel_id = ?
      ORDER BY version DESC, updated_at DESC, id DESC
      LIMIT 1
      `,
      [novelId],
    );
    return rows[0] ?? null;
  }

  private async getAdaptationModeById(modeId: number): Promise<RowRecord | null> {
    if (!(await this.hasTable('adaptation_modes'))) {
      return null;
    }

    const rows = await this.dataSource.query(
      `
      SELECT id, mode_key, mode_name, description
      FROM adaptation_modes
      WHERE id = ?
      LIMIT 1
      `,
      [modeId],
    );
    return rows[0] ?? null;
  }

  private async getActiveSetCore(novelId: number): Promise<RowRecord | null> {
    if (!(await this.hasTable('set_core'))) {
      return null;
    }

    const rows = await this.dataSource.query(
      `
      SELECT
        id,
        title,
        core_text,
        protagonist_name,
        protagonist_identity,
        target_story,
        rewrite_goal,
        constraint_text
      FROM set_core
      WHERE novel_id = ? AND is_active = 1
      ORDER BY version DESC, updated_at DESC, id DESC
      LIMIT 1
      `,
      [novelId],
    );
    return rows[0] ?? null;
  }

  private async selectByNovel(
    tableName: string,
    alias: string,
    novelId: number,
    orderBy?: string,
  ): Promise<RowRecord[]> {
    if (!(await this.hasTable(tableName))) {
      return [];
    }

    const qb = this.dataSource
      .createQueryBuilder()
      .select(`${alias}.*`)
      .from(tableName, alias)
      .where(`${alias}.novel_id = :novelId`, { novelId });

    if (orderBy) {
      qb.orderBy(orderBy, 'ASC');
    }

    return qb.getRawMany();
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

  private async hasTable(tableName: string): Promise<boolean> {
    const rows = await this.dataSource.query(
      `
      SELECT 1
      FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?
      LIMIT 1
      `,
      [tableName],
    );
    return rows.length > 0;
  }

  private normalizeArray(value: unknown): unknown[] {
    return Array.isArray(value) ? value : [];
  }

  private asRecord(value: unknown): RowRecord | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return null;
    }
    return value as RowRecord;
  }

  private normalizeText(value: unknown): string {
    if (value === null || value === undefined) {
      return '';
    }
    if (typeof value === 'string') {
      return value.trim();
    }
    if (typeof value === 'number' || typeof value === 'boolean') {
      return String(value).trim();
    }
    return '';
  }

  private normalizeNullableText(value: unknown): string | null {
    const text = this.normalizeText(value);
    return text || null;
  }

  private normalizeOptionalInt(value: unknown): number | null {
    if (value === null || value === undefined || value === '') {
      return null;
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
      return Math.trunc(value);
    }
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (!trimmed) return null;
      const parsed = Number(trimmed);
      if (Number.isFinite(parsed)) {
        return Math.trunc(parsed);
      }
    }
    return null;
  }

  private trimBlock(value: unknown, maxLength: number): string {
    const text = typeof value === 'string' ? value.trim() : this.normalizeText(value);
    if (!text) {
      return '';
    }
    if (text.length <= maxLength) {
      return text;
    }
    return `${text.slice(0, maxLength)}...(截断)`;
  }

  private getLcApiEndpoint(): string {
    const raw = process.env.lc_api_url?.trim();
    if (!raw) {
      throw new InternalServerErrorException('lc_api_url is not configured');
    }
    const normalized = raw.replace(/\/+$/, '');
    if (
      normalized.endsWith('/v1/chat/completions') ||
      normalized.endsWith('/chat/completions')
    ) {
      return normalized;
    }
    return `${normalized}/v1/chat/completions`;
  }

  private getLcApiKey(): string {
    const key = process.env.lc_api_key?.trim();
    if (!key) {
      throw new InternalServerErrorException('lc_api_key is not configured');
    }
    return key;
  }

  private async callLcAiApi(
    modelKey: string,
    promptPreview: string,
  ): Promise<Record<string, unknown>> {
    const endpoint = this.getLcApiEndpoint();
    const apiKey = this.getLcApiKey();

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: modelKey,
        temperature: 0.4,
        messages: [
          {
            role: 'system',
            content:
              '你是短剧世界观结构化提炼助手。你必须输出严格 JSON，不要输出 markdown，不要输出解释。',
          },
          { role: 'user', content: promptPreview },
        ],
      }),
    });

    const contentType = response.headers.get('content-type') || '';
    const rawText = await response.text();

    if (this.isHtmlResponse(contentType, rawText)) {
      throw new BadRequestException(
        `Worldview draft request reached an HTML page instead of JSON API. endpoint=${endpoint}, status=${response.status}, contentType=${contentType}, body=${this.summarizeBody(rawText)}`,
      );
    }
    if (!response.ok) {
      throw new BadRequestException(
        `Worldview draft request failed. endpoint=${endpoint}, status=${response.status}, contentType=${contentType}, body=${this.summarizeBody(rawText)}`,
      );
    }

    let payload: any;
    try {
      payload = JSON.parse(rawText);
    } catch {
      throw new BadRequestException(
        `Worldview draft response is not valid JSON. endpoint=${endpoint}, status=${response.status}, contentType=${contentType}, body=${this.summarizeBody(rawText)}`,
      );
    }

    const content = this.extractAiText(payload);
    if (!content) {
      throw new BadRequestException('Worldview draft response does not contain usable text content');
    }
    return this.parseJsonObjectFromText(content);
  }

  private extractAiText(payload: any): string {
    if (typeof payload === 'string') return payload;
    const content = payload?.choices?.[0]?.message?.content;
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) {
      return content
        .map((item) => {
          if (typeof item === 'string') return item;
          if (typeof item?.text === 'string') return item.text;
          if (typeof item?.content === 'string') return item.content;
          return '';
        })
        .join('\n');
    }
    if (typeof payload?.output_text === 'string') return payload.output_text;
    if (typeof payload?.response === 'string') return payload.response;
    return '';
  }

  private parseJsonObjectFromText(text: string): Record<string, unknown> {
    const trimmed = this.stripMarkdownCodeFence(text.trim());
    try {
      return JSON.parse(trimmed);
    } catch {
      const start = trimmed.indexOf('{');
      const end = trimmed.lastIndexOf('}');
      if (start >= 0 && end > start) {
        const candidate = trimmed.slice(start, end + 1);
        return this.parsePossiblyDirtyJson(candidate);
      }
    }
    return this.parsePossiblyDirtyJson(trimmed);
  }

  private parsePossiblyDirtyJson(text: string): Record<string, unknown> {
    const candidates = [text, this.normalizeJsonLikeText(text)];
    for (const candidate of candidates) {
      try {
        return JSON.parse(candidate);
      } catch {
        // try next candidate
      }
    }
    throw new BadRequestException(
      `Worldview draft content is not valid JSON: ${text.slice(0, 500)}`,
    );
  }

  private stripMarkdownCodeFence(text: string): string {
    return text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  }

  private normalizeJsonLikeText(text: string): string {
    return text
      .replace(/[\u2018\u2019]/g, "'")
      .replace(/[\u201C\u201D]/g, '"')
      .replace(/^\uFEFF/, '')
      .trim();
  }

  private isHtmlResponse(contentType: string, body: string): boolean {
    return contentType.includes('text/html') || /^\s*<!doctype html/i.test(body);
  }

  private summarizeBody(body: string): string {
    return body.replace(/\s+/g, ' ').slice(0, 500);
  }

  private resolveClosureStatus(
    report: WorldviewValidationReport,
    repairApplied: boolean,
  ): WorldviewClosureStatus {
    const hasMajorRelevance = report.issues.some(
      (item) =>
        item.moduleKey === 'evidence' &&
        item.severity !== 'minor' &&
        item.source === 'relevance',
    );
    if (!report.fatalCount && report.score >= 80 && !hasMajorRelevance) {
      return repairApplied ? 'repaired' : 'accepted';
    }
    if (!report.fatalCount && report.majorCount <= 2 && report.score >= 75) {
      return 'repaired';
    }
    return 'low_confidence';
  }

  private extractEvidenceBlock(promptPreview: string): string {
    const start = promptPreview.indexOf('【原文证据片段');
    if (start < 0) return '';
    const tail = promptPreview.slice(start);
    const nextHeaderIndex = tail.indexOf('\n【用户附加要求】');
    if (nextHeaderIndex < 0) return tail;
    return tail.slice(0, nextHeaderIndex).trim();
  }

  private filterWeakRelevanceEvidence(promptPreview: string): {
    prompt: string;
    removedCount: number;
  } {
    const weakTerms = ['张士诚', '陈友谅', '蓝玉', '胡惟庸'];
    const lines = promptPreview.split('\n');
    let removedCount = 0;
    const filtered = lines.filter((line) => {
      if (!line.includes('证据：')) return true;
      const hit = weakTerms.some((term) => line.includes(term));
      if (hit) {
        removedCount += 1;
        return false;
      }
      return true;
    });
    return {
      prompt: filtered.join('\n'),
      removedCount,
    };
  }
}
