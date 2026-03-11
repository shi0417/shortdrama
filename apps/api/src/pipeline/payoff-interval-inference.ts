export type PayoffIntervalInferenceSummary = {
  payoffIntervalsInferred: number;
  payoffIntervalsAdjusted: number;
  notes: string[];
};

export type PayoffInferenceWarning = {
  path: string;
  severity: 'weak' | 'bad';
  reason: string;
};

type StoryPhaseRow = {
  phase_name: string;
  start_ep: number | null;
  end_ep: number | null;
};

type PayoffLineRow = {
  line_name: string;
  line_content: string;
  start_ep: number | null;
  end_ep: number | null;
  stage_text: string | null;
};

type ApplyInput = {
  lines: PayoffLineRow[];
  storyPhases: StoryPhaseRow[];
  totalChapters: number | null;
};

type ApplyOutput = {
  lines: PayoffLineRow[];
  summary: PayoffIntervalInferenceSummary;
  warnings: PayoffInferenceWarning[];
};

type SpanHint = 'full' | 'early' | 'mid' | 'late';

export class WorldviewPayoffIntervalInference {
  apply(input: ApplyInput): ApplyOutput {
    const lines = input.lines.map((item) => ({ ...item }));
    const warnings: PayoffInferenceWarning[] = [];
    const notes: string[] = [];
    let inferred = 0;
    let adjusted = 0;
    if (!lines.length) {
      return {
        lines,
        summary: { payoffIntervalsInferred: 0, payoffIntervalsAdjusted: 0, notes: ['no payoff lines'] },
        warnings,
      };
    }

    const total = this.resolveTotal(input.totalChapters, input.storyPhases, lines.length);
    const baseline = this.buildRanges(total, lines.length);
    const phaseRanges = input.storyPhases
      .map((phase) => [this.toPos(phase.start_ep), this.toPos(phase.end_ep)] as const)
      .filter((pair): pair is readonly [number, number] => pair[0] !== null && pair[1] !== null);

    lines.forEach((line, index) => {
      const original = { ...line };
      let start = this.toPos(line.start_ep);
      let end = this.toPos(line.end_ep);
      const hint = this.resolveHint(line);

      if (start === null || end === null || start > end) {
        inferred += 1;
        if (hint === 'full') {
          start = 1;
          end = total;
        } else {
          const fromPhase = this.matchRangeFromStoryPhase(phaseRanges, hint);
          const fromBase = baseline[index] ?? [1, total];
          start = fromPhase?.[0] ?? fromBase[0];
          end = fromPhase?.[1] ?? fromBase[1];
        }
        warnings.push({
          path: `setPayoffArch.lines[${index}]`,
          severity: 'weak',
          reason: 'interval missing, inferred from line semantics and story phases',
        });
      }

      if (start < 1) {
        start = 1;
        adjusted += 1;
      }
      if (end > total) {
        end = total;
        adjusted += 1;
      }
      if (end < start) {
        end = start;
        adjusted += 1;
        warnings.push({
          path: `setPayoffArch.lines[${index}]`,
          severity: 'weak',
          reason: 'end_ep < start_ep, auto-fixed',
        });
      }

      const minSpan = hint === 'full' ? Math.max(10, Math.floor(total * 0.4)) : 4;
      if (end - start + 1 < minSpan) {
        end = Math.min(total, start + minSpan - 1);
        adjusted += 1;
      }

      let stageText = (line.stage_text || '').trim();
      if (!stageText) {
        stageText = this.deriveStageText(hint, start, end, total);
        adjusted += 1;
        warnings.push({
          path: `setPayoffArch.lines[${index}].stage_text`,
          severity: 'weak',
          reason: 'stage_text missing, auto-filled by inferred interval',
        });
      }

      line.start_ep = start;
      line.end_ep = end;
      line.stage_text = stageText;

      if (
        original.start_ep !== line.start_ep ||
        original.end_ep !== line.end_ep ||
        (original.stage_text || '') !== (line.stage_text || '')
      ) {
        adjusted += 1;
      }
    });

    return {
      lines,
      summary: {
        payoffIntervalsInferred: inferred,
        payoffIntervalsAdjusted: adjusted,
        notes,
      },
      warnings,
    };
  }

  private resolveTotal(totalChapters: number | null, storyPhases: StoryPhaseRow[], lineCount: number): number {
    if (typeof totalChapters === 'number' && totalChapters > 0) return Math.trunc(totalChapters);
    const maxStoryEnd = storyPhases.reduce((acc, row) => {
      const end = this.toPos(row.end_ep);
      return end && end > acc ? end : acc;
    }, 0);
    if (maxStoryEnd > 0) return maxStoryEnd;
    return Math.max(12, lineCount * 8);
  }

  private buildRanges(total: number, count: number): Array<[number, number]> {
    const ranges: Array<[number, number]> = [];
    for (let i = 0; i < count; i += 1) {
      const start = Math.floor((i * total) / count) + 1;
      const end = Math.max(start, Math.floor(((i + 1) * total) / count));
      ranges.push([start, end]);
    }
    if (ranges.length) ranges[ranges.length - 1][1] = total;
    return ranges;
  }

  private resolveHint(line: PayoffLineRow): SpanHint {
    const text = `${line.line_name} ${line.line_content}`;
    if (/(穿越|身份反差|全程|贯穿|预知)/u.test(text)) return 'full';
    if (/(削藩|信任|铺垫|起势|开局|前期)/u.test(text)) return 'early';
    if (/(权谋|布局|渗透|博弈|中盘|中段)/u.test(text)) return 'mid';
    if (/(决战|终局|反杀|收网|最终|翻盘)/u.test(text)) return 'late';
    return 'mid';
  }

  private matchRangeFromStoryPhase(
    phaseRanges: ReadonlyArray<readonly [number, number]>,
    hint: SpanHint,
  ): [number, number] | null {
    if (!phaseRanges.length) return null;
    if (hint === 'full') {
      return [phaseRanges[0][0], phaseRanges[phaseRanges.length - 1][1]];
    }
    if (hint === 'early') {
      return [phaseRanges[0][0], phaseRanges[Math.min(1, phaseRanges.length - 1)][1]];
    }
    if (hint === 'late') {
      const idx = Math.max(0, phaseRanges.length - 2);
      return [phaseRanges[idx][0], phaseRanges[phaseRanges.length - 1][1]];
    }
    const midIdx = Math.floor((phaseRanges.length - 1) / 2);
    return [phaseRanges[midIdx][0], phaseRanges[midIdx][1]];
  }

  private deriveStageText(hint: SpanHint, start: number, end: number, total: number): string {
    if (hint === 'full') return '全程贯穿';
    const ratio = (start + end) / 2 / Math.max(1, total);
    if (ratio < 0.33) return '前期密集';
    if (ratio < 0.66) return '中期推进';
    return '后期收束';
  }

  private toPos(value: number | null): number | null {
    if (typeof value !== 'number' || !Number.isFinite(value)) return null;
    const n = Math.trunc(value);
    return n > 0 ? n : null;
  }
}
