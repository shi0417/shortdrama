export type StoryPhaseIntervalInferenceSummary = {
  storyPhaseIntervalsInferred: number;
  storyPhaseIntervalsAdjusted: number;
  notes: string[];
};

export type StoryPhaseInferenceWarning = {
  path: string;
  severity: 'weak';
  reason: string;
};

type StoryPhaseRow = {
  phase_name: string;
  start_ep: number | null;
  end_ep: number | null;
  historical_path: string | null;
  rewrite_path: string | null;
};

type ApplyInput = {
  storyPhases: StoryPhaseRow[];
  totalChapters: number | null;
};

type ApplyOutput = {
  storyPhases: StoryPhaseRow[];
  summary: StoryPhaseIntervalInferenceSummary;
  warnings: StoryPhaseInferenceWarning[];
};

type StageHint = 'early' | 'mid' | 'late' | 'neutral';

export class WorldviewStoryPhaseInference {
  apply(input: ApplyInput): ApplyOutput {
    const phases = input.storyPhases.map((item) => ({ ...item }));
    if (!phases.length) {
      return {
        storyPhases: phases,
        summary: {
          storyPhaseIntervalsInferred: 0,
          storyPhaseIntervalsAdjusted: 0,
          notes: ['no story phases'],
        },
        warnings: [],
      };
    }

    const warnings: StoryPhaseInferenceWarning[] = [];
    const notes: string[] = [];
    let inferred = 0;
    let adjusted = 0;

    const phaseCount = phases.length;
    const inferredTotalChapters = this.resolveTotalChapters(input.totalChapters, phases);
    if (input.totalChapters === null) {
      notes.push(`total_chapters missing, inferred=${inferredTotalChapters}`);
    }

    const baselineRanges = this.buildBaselineRanges(inferredTotalChapters, phaseCount);
    let prevEnd = 0;

    for (let index = 0; index < phaseCount; index += 1) {
      const row = phases[index];
      const originalStart = row.start_ep;
      const originalEnd = row.end_ep;

      let start = this.toPositiveInt(row.start_ep);
      let end = this.toPositiveInt(row.end_ep);
      const stageHint = this.resolveStageHint(row);
      const [baseStart, baseEnd] = baselineRanges[index];

      const hasValidRange = start !== null && end !== null && start <= end;
      if (!hasValidRange) {
        inferred += 1;
        const hintedRange = this.applyStageHint(
          [baseStart, baseEnd],
          stageHint,
          inferredTotalChapters,
          phaseCount,
          index,
        );
        start = hintedRange[0];
        end = hintedRange[1];
        warnings.push({
          path: `setStoryPhases[${index}]`,
          severity: 'weak',
          reason:
            'start_ep missing, inferred from phase order and total chapters',
        });
      }

      if (start! < 1) {
        start = 1;
        adjusted += 1;
        warnings.push({
          path: `setStoryPhases[${index}].start_ep`,
          severity: 'weak',
          reason: 'start_ep below 1, clamped to 1',
        });
      }
      if (end! < 1) {
        end = start!;
        adjusted += 1;
        warnings.push({
          path: `setStoryPhases[${index}].end_ep`,
          severity: 'weak',
          reason: 'end_ep below 1, adjusted to start_ep',
        });
      }
      if (start! > inferredTotalChapters) {
        start = inferredTotalChapters;
        adjusted += 1;
        warnings.push({
          path: `setStoryPhases[${index}].start_ep`,
          severity: 'weak',
          reason: 'start_ep exceeded total chapters, clamped',
        });
      }
      if (end! > inferredTotalChapters) {
        end = inferredTotalChapters;
        adjusted += 1;
        warnings.push({
          path: `setStoryPhases[${index}].end_ep`,
          severity: 'weak',
          reason: 'end_ep exceeded total chapters, clamped',
        });
      }

      if (start! <= prevEnd) {
        const nextStart = Math.min(prevEnd + 1, inferredTotalChapters);
        if (nextStart !== start) {
          start = nextStart;
          adjusted += 1;
          warnings.push({
            path: `setStoryPhases[${index}].start_ep`,
            severity: 'weak',
            reason: 'adjusted to keep phase order monotonic',
          });
        }
      }

      if (end! < start!) {
        end = start!;
        adjusted += 1;
        warnings.push({
          path: `setStoryPhases[${index}]`,
          severity: 'weak',
          reason: 'end_ep < start_ep, auto-fixed',
        });
      }

      const remaining = phaseCount - index - 1;
      const maxEnd = inferredTotalChapters - remaining;
      if (end! > maxEnd) {
        end = maxEnd;
        adjusted += 1;
        warnings.push({
          path: `setStoryPhases[${index}].end_ep`,
          severity: 'weak',
          reason: 'trimmed to reserve room for later phases',
        });
      }
      if (end! < start!) {
        end = start!;
      }

      row.start_ep = start;
      row.end_ep = end;
      prevEnd = end;

      if (originalStart !== row.start_ep || originalEnd !== row.end_ep) {
        adjusted += 1;
      }
    }

    // Ensure final phase reaches the tail when possible.
    const last = phases[phases.length - 1];
    if (last && last.end_ep !== inferredTotalChapters) {
      if (last.start_ep !== null && last.start_ep <= inferredTotalChapters) {
        last.end_ep = inferredTotalChapters;
        adjusted += 1;
        warnings.push({
          path: `setStoryPhases[${phases.length - 1}].end_ep`,
          severity: 'weak',
          reason: 'extended to cover ending episodes',
        });
      }
    }

    return {
      storyPhases: phases,
      summary: {
        storyPhaseIntervalsInferred: inferred,
        storyPhaseIntervalsAdjusted: adjusted,
        notes,
      },
      warnings,
    };
  }

  private resolveTotalChapters(totalChapters: number | null, phases: StoryPhaseRow[]): number {
    if (typeof totalChapters === 'number' && totalChapters > 0) {
      return Math.trunc(totalChapters);
    }
    const maxEnd = phases.reduce((acc, row) => {
      const end = this.toPositiveInt(row.end_ep);
      return end && end > acc ? end : acc;
    }, 0);
    if (maxEnd > 0) {
      return maxEnd;
    }
    return Math.max(phases.length * 12, 12);
  }

  private buildBaselineRanges(total: number, count: number): Array<[number, number]> {
    const ranges: Array<[number, number]> = [];
    for (let index = 0; index < count; index += 1) {
      const start = Math.floor((index * total) / count) + 1;
      const end = Math.floor(((index + 1) * total) / count);
      ranges.push([start, Math.max(start, end)]);
    }
    if (ranges.length) {
      ranges[ranges.length - 1][1] = total;
    }
    return ranges;
  }

  private applyStageHint(
    range: [number, number],
    hint: StageHint,
    total: number,
    count: number,
    index: number,
  ): [number, number] {
    if (hint === 'neutral') {
      return range;
    }
    const width = Math.max(1, range[1] - range[0] + 1);
    const oneThird = Math.max(1, Math.floor(total / 3));
    const twoThird = Math.max(oneThird + 1, Math.floor((total * 2) / 3));
    let targetStart = range[0];

    if (hint === 'early') {
      targetStart = Math.min(range[0], oneThird - width + 1);
    } else if (hint === 'mid') {
      const midStart = Math.floor((oneThird + twoThird - width) / 2);
      targetStart = Math.max(range[0], midStart);
    } else if (hint === 'late') {
      targetStart = Math.max(range[0], twoThird);
    }

    targetStart = Math.max(1, Math.min(targetStart, total - (count - index - 1)));
    let targetEnd = targetStart + width - 1;
    targetEnd = Math.min(total, targetEnd);
    if (targetEnd < targetStart) {
      targetEnd = targetStart;
    }
    return [targetStart, targetEnd];
  }

  private resolveStageHint(row: StoryPhaseRow): StageHint {
    const text = `${row.phase_name || ''} ${row.historical_path || ''} ${row.rewrite_path || ''}`;
    if (/(前期|初期|开局|起势)/u.test(text)) return 'early';
    if (/(中期|升级|博弈|僵持)/u.test(text)) return 'mid';
    if (/(决战|终局|收尾|结局|落幕)/u.test(text)) return 'late';
    return 'neutral';
  }

  private toPositiveInt(value: number | null): number | null {
    if (typeof value !== 'number' || !Number.isFinite(value)) return null;
    const n = Math.trunc(value);
    return n > 0 ? n : null;
  }
}
