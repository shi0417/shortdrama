import { WorldviewValidationIssue } from './worldview-closure.types';

type RelevanceInput = {
  promptPreview: string;
  evidenceSummary?: {
    evidenceSegments: number;
    evidenceChars: number;
    fallbackUsed: boolean;
  } | null;
};

const WEAK_RELEVANCE_TERMS = ['张士诚', '陈友谅', '蓝玉', '胡惟庸'];

export class WorldviewRelevanceValidator {
  validate(input: RelevanceInput): WorldviewValidationIssue[] {
    const issues: WorldviewValidationIssue[] = [];
    const promptText = input.promptPreview || '';
    const weakHits = WEAK_RELEVANCE_TERMS.filter((term) => promptText.includes(term));

    if (weakHits.length >= 2) {
      issues.push({
        moduleKey: 'evidence',
        path: 'evidenceSegments',
        severity: 'major',
        reason: `弱相关历史证据疑似占据上下文预算：${weakHits.join('、')}`,
        repairStrategy: 'reselect_evidence',
        source: 'relevance',
      });
    } else if (weakHits.length === 1) {
      issues.push({
        moduleKey: 'evidence',
        path: 'evidenceSegments',
        severity: 'minor',
        reason: `发现潜在串题证据词：${weakHits[0]}`,
        repairStrategy: 'reselect_evidence',
        source: 'relevance',
      });
    }

    if (input.evidenceSummary?.fallbackUsed) {
      issues.push({
        moduleKey: 'evidence',
        path: 'evidenceSummary.fallbackUsed',
        severity: 'minor',
        reason: '当前使用 raw fallback，证据精度可能下降',
        repairStrategy: 'reselect_evidence',
        source: 'relevance',
      });
    }

    if ((input.evidenceSummary?.evidenceSegments ?? 0) <= 4) {
      issues.push({
        moduleKey: 'evidence',
        path: 'evidenceSummary.evidenceSegments',
        severity: 'minor',
        reason: '证据片段数较少，可能不足以支撑多模块生成',
        repairStrategy: 'reselect_evidence',
        source: 'relevance',
      });
    }

    return issues;
  }
}

