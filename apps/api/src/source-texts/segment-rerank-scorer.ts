import { WorldviewQueryBundle, WorldviewQueryModuleKey } from './worldview-query-builder';

export type SegmentCandidate = {
  id: number;
  chapterLabel: string | null;
  titleHint: string | null;
  charLength: number;
  contentText: string;
  keywordText: string | null;
  segmentIndex: number;
};

export type ScoredSegmentCandidate = SegmentCandidate & {
  score: number;
  moduleKey: WorldviewQueryModuleKey;
  matchedTerms: string[];
};

const CORE_ENTITIES = ['沈昭', '朱棣', '建文帝', '李景隆', '姚广孝', '金川门', '削藩', '靖难'];

export class SegmentRerankScorer {
  scoreModuleCandidate(
    candidate: SegmentCandidate,
    bundle: WorldviewQueryBundle,
  ): ScoredSegmentCandidate {
    const chapterLabel = candidate.chapterLabel || '';
    const titleHint = candidate.titleHint || '';
    const keywordText = candidate.keywordText || '';
    const contentText = candidate.contentText || '';
    const matchedTerms = new Set<string>();
    let score = 0;

    for (const phrase of bundle.phrases) {
      if (this.containsText(contentText, phrase) || this.containsText(keywordText, phrase)) {
        score += 5;
        matchedTerms.add(phrase);
      }
    }

    for (const term of bundle.terms) {
      let termScore = 0;
      if (this.containsText(keywordText, term)) termScore += 4;
      if (this.containsText(titleHint, term)) termScore += 3;
      if (this.containsText(chapterLabel, term)) termScore += 2;
      if (this.containsText(contentText, term)) termScore += 2;
      if (termScore > 0) {
        matchedTerms.add(term);
        score += termScore;
      }
    }

    for (const entity of CORE_ENTITIES) {
      if (this.containsText(keywordText, entity) || this.containsText(contentText, entity)) {
        score += 3;
      }
    }

    score += 4; // module match baseline

    if (chapterLabel.includes('附录') || chapterLabel.includes('题记')) {
      score -= 8;
    }
    if (titleHint.includes('目录') || chapterLabel.includes('目录')) {
      score -= 12;
    }

    return {
      ...candidate,
      score,
      moduleKey: bundle.moduleKey,
      matchedTerms: [...matchedTerms].slice(0, 12),
    };
  }

  similarity(left: string, right: string): number {
    const leftTokens = this.tokenize(left);
    const rightTokens = this.tokenize(right);
    if (!leftTokens.size || !rightTokens.size) {
      return 0;
    }

    let intersection = 0;
    leftTokens.forEach((token) => {
      if (rightTokens.has(token)) {
        intersection += 1;
      }
    });

    const union = new Set([...leftTokens, ...rightTokens]).size;
    return union === 0 ? 0 : intersection / union;
  }

  private containsText(haystack: string, needle: string): boolean {
    return Boolean(haystack) && Boolean(needle) && haystack.includes(needle);
  }

  private tokenize(text: string): Set<string> {
    return new Set(
      text
        .split(/[\s,，。！？；：、（）()《》“”"'‘’【】\[\]<>…—\-]+/u)
        .map((item) => item.trim())
        .filter((item) => item.length >= 2 && item.length <= 20),
    );
  }
}
