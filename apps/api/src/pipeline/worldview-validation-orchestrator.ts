import {
  WorldviewValidationIssue,
  WorldviewValidationRecommendedAction,
  WorldviewValidationReport,
} from './worldview-closure.types';
import {
  WorldviewQualitySummary,
  WorldviewQualityWarning,
} from './worldview-quality-checker';
import { WorldviewAlignmentWarning } from './worldview-cross-table-alignment-checker';
import { WorldviewSemanticValidator } from './worldview-semantic-validator';
import { WorldviewRelevanceValidator } from './worldview-relevance-validator';

type OrchestratorInput = {
  draft: any;
  promptPreview: string;
  qualitySummary: WorldviewQualitySummary;
  qualityWarnings: WorldviewQualityWarning[];
  alignmentWarnings: WorldviewAlignmentWarning[];
  evidenceSummary?: {
    evidenceSegments: number;
    evidenceChars: number;
    fallbackUsed: boolean;
  } | null;
};

export class WorldviewValidationOrchestrator {
  private readonly semanticValidator = new WorldviewSemanticValidator();
  private readonly relevanceValidator = new WorldviewRelevanceValidator();

  evaluate(input: OrchestratorInput): WorldviewValidationReport {
    const structureIssues = this.fromQualityWarnings(input.qualityWarnings);
    const alignmentIssues = this.fromAlignmentWarnings(input.alignmentWarnings);
    const semanticIssues = this.semanticValidator.validate(input.draft);
    const relevanceIssues = this.relevanceValidator.validate({
      promptPreview: input.promptPreview,
      evidenceSummary: input.evidenceSummary,
    });

    const issues = [
      ...structureIssues,
      ...alignmentIssues,
      ...semanticIssues,
      ...relevanceIssues,
    ];
    const deduped = this.dedupeIssues(issues);
    const fatalCount = deduped.filter((item) => item.severity === 'fatal').length;
    const majorCount = deduped.filter((item) => item.severity === 'major').length;
    const minorCount = deduped.filter((item) => item.severity === 'minor').length;
    const score = Math.max(0, 100 - fatalCount * 25 - majorCount * 8 - minorCount * 3);
    const recommendedAction = this.getRecommendedAction({
      fatalCount,
      majorCount,
      minorCount,
      score,
      issues: deduped,
    });

    return {
      passed: fatalCount === 0 && majorCount <= 2 && score >= 80,
      score,
      fatalCount,
      majorCount,
      minorCount,
      issues: deduped,
      recommendedAction,
    };
  }

  private fromQualityWarnings(
    warnings: WorldviewQualityWarning[],
  ): WorldviewValidationIssue[] {
    return warnings.map((item) => ({
      moduleKey: item.moduleKey,
      path: item.path,
      severity: item.severity === 'bad' ? 'major' : 'minor',
      reason: item.reason,
      repairStrategy: item.severity === 'bad' ? 'regenerate_module' : 'fix_in_place',
      source: 'structure',
    }));
  }

  private fromAlignmentWarnings(
    warnings: WorldviewAlignmentWarning[],
  ): WorldviewValidationIssue[] {
    return warnings.map((item) => ({
      moduleKey: item.moduleKey,
      path: item.path,
      severity: item.severity === 'bad' ? 'major' : 'minor',
      reason: item.reason,
      repairStrategy: 'fix_in_place',
      source: 'alignment',
    }));
  }

  private dedupeIssues(issues: WorldviewValidationIssue[]): WorldviewValidationIssue[] {
    const bucket = new Map<string, WorldviewValidationIssue>();
    issues.forEach((item) => {
      const key = `${item.moduleKey}::${item.path}::${item.reason}`;
      const existing = bucket.get(key);
      if (!existing) {
        bucket.set(key, item);
        return;
      }
      if (this.severityRank(item.severity) > this.severityRank(existing.severity)) {
        bucket.set(key, item);
      }
    });
    return [...bucket.values()];
  }

  private severityRank(severity: WorldviewValidationIssue['severity']): number {
    if (severity === 'fatal') return 3;
    if (severity === 'major') return 2;
    return 1;
  }

  private getRecommendedAction(input: {
    fatalCount: number;
    majorCount: number;
    minorCount: number;
    score: number;
    issues: WorldviewValidationIssue[];
  }): WorldviewValidationRecommendedAction {
    if (!input.fatalCount && input.majorCount <= 2 && input.score >= 80) {
      return 'accept';
    }
    if (
      input.issues.some(
        (item) => item.repairStrategy === 'reselect_evidence' && item.severity !== 'minor',
      )
    ) {
      return 'reselect_evidence';
    }
    if (input.issues.some((item) => item.repairStrategy === 'regenerate_module')) {
      return 'regenerate_modules';
    }
    return 'repair';
  }
}

