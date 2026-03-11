export type TraitorStageIntervalInferenceSummary = {
  traitorStageIntervalsInferred: number;
  traitorStageIntervalsAdjusted: number;
  notes: string[];
};

export type TraitorStageInferenceWarning = {
  path: string;
  severity: 'weak' | 'bad';
  reason: string;
};

type StoryPhaseRow = {
  start_ep: number | null;
  end_ep: number | null;
};

type StageRow = {
  stage_title: string;
  stage_desc: string;
  start_ep: number | null;
  end_ep: number | null;
};

type ApplyInput = {
  stages: StageRow[];
  storyPhases: StoryPhaseRow[];
  totalChapters: number | null;
};

type ApplyOutput = {
  stages: StageRow[];
  summary: TraitorStageIntervalInferenceSummary;
  warnings: TraitorStageInferenceWarning[];
};

type StageHint = 'early' | 'mid' | 'late';

export class WorldviewTraitorStageIntervalInference {
  apply(input: ApplyInput): ApplyOutput {
    const stages = input.stages.map((item) => ({ ...item }));
    const warnings: TraitorStageInferenceWarning[] = [];
    let inferred = 0;
    let adjusted = 0;
    if (!stages.length) {
      return {
        stages,
        summary: {
          traitorStageIntervalsInferred: 0,
          traitorStageIntervalsAdjusted: 0,
          notes: ['no traitor stages'],
        },
        warnings,
      };
    }

    const total = this.resolveTotal(input.totalChapters, input.storyPhases, stages.length);
    const baseline = this.buildRanges(total, stages.length);
    let prevEnd = 0;

    stages.forEach((row, index) => {
      const originalStart = row.start_ep;
      const originalEnd = row.end_ep;
      let start = this.toPos(row.start_ep);
      let end = this.toPos(row.end_ep);
      const hint = this.resolveHint(row);

      if (start === null || end === null || start > end) {
        inferred += 1;
        const [baseStart, baseEnd] = baseline[index];
        [start, end] = this.applyHint([baseStart, baseEnd], hint, total);
        warnings.push({
          path: `setTraitorSystem.stages[${index}]`,
          severity: 'weak',
          reason: 'stage interval missing, inferred from stage order and semantics',
        });
      }

      if (start <= prevEnd) {
        start = Math.min(prevEnd + 1, total);
        adjusted += 1;
      }
      if (end < start) {
        end = start;
        adjusted += 1;
      }
      if (end > total) {
        end = total;
        adjusted += 1;
      }

      row.start_ep = start;
      row.end_ep = end;
      prevEnd = end;

      if (originalStart !== row.start_ep || originalEnd !== row.end_ep) {
        adjusted += 1;
      }
    });

    return {
      stages,
      summary: {
        traitorStageIntervalsInferred: inferred,
        traitorStageIntervalsAdjusted: adjusted,
        notes: [],
      },
      warnings,
    };
  }

  private resolveTotal(totalChapters: number | null, phases: StoryPhaseRow[], count: number): number {
    if (typeof totalChapters === 'number' && totalChapters > 0) return Math.trunc(totalChapters);
    const maxEnd = phases.reduce((acc, item) => {
      const end = this.toPos(item.end_ep);
      return end && end > acc ? end : acc;
    }, 0);
    if (maxEnd > 0) return maxEnd;
    return Math.max(12, count * 8);
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

  private resolveHint(row: StageRow): StageHint {
    const text = `${row.stage_title} ${row.stage_desc}`;
    if (/(可疑|察觉|排查|潜伏|萌芽)/u.test(text)) return 'early';
    if (/(反制|暴露|收网|终局|摊牌)/u.test(text)) return 'late';
    return 'mid';
  }

  private applyHint(range: [number, number], hint: StageHint, total: number): [number, number] {
    const width = Math.max(3, range[1] - range[0] + 1);
    if (hint === 'early') {
      const start = Math.max(1, Math.min(range[0], Math.floor(total * 0.35) - width + 1));
      return [start, Math.min(total, start + width - 1)];
    }
    if (hint === 'late') {
      const start = Math.max(range[0], Math.floor(total * 0.66));
      return [start, Math.min(total, start + width - 1)];
    }
    return range;
  }

  private toPos(value: number | null): number | null {
    if (typeof value !== 'number' || !Number.isFinite(value)) return null;
    const n = Math.trunc(value);
    return n > 0 ? n : null;
  }
}
