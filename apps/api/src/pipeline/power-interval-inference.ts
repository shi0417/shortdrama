export type PowerIntervalInferenceSummary = {
  powerIntervalsInferred: number;
  powerIntervalsAdjusted: number;
  notes: string[];
};

export type PowerInferenceWarning = {
  path: string;
  severity: 'weak' | 'bad';
  reason: string;
};

type StoryPhaseRow = {
  start_ep: number | null;
  end_ep: number | null;
};

type PowerRow = {
  level_no: number;
  level_title: string;
  identity_desc: string;
  ability_boundary: string;
  start_ep: number | null;
  end_ep: number | null;
};

type ApplyInput = {
  powerLadder: PowerRow[];
  storyPhases: StoryPhaseRow[];
  totalChapters: number | null;
};

type ApplyOutput = {
  powerLadder: PowerRow[];
  summary: PowerIntervalInferenceSummary;
  warnings: PowerInferenceWarning[];
};

type SpanHint = 'early' | 'mid' | 'late';

export class WorldviewPowerIntervalInference {
  apply(input: ApplyInput): ApplyOutput {
    const rows = input.powerLadder.map((item) => ({ ...item }));
    const warnings: PowerInferenceWarning[] = [];
    let inferred = 0;
    let adjusted = 0;
    if (!rows.length) {
      return {
        powerLadder: rows,
        summary: { powerIntervalsInferred: 0, powerIntervalsAdjusted: 0, notes: ['no power rows'] },
        warnings,
      };
    }

    rows.sort((a, b) => (a.level_no || 0) - (b.level_no || 0));
    const total = this.resolveTotal(input.totalChapters, input.storyPhases, rows.length);
    const baseline = this.buildRanges(total, rows.length);
    let prevEnd = 0;

    rows.forEach((row, index) => {
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
          path: `setPowerLadder[${index}]`,
          severity: 'weak',
          reason: 'interval missing, inferred from level and capability semantics',
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

    const last = rows[rows.length - 1];
    if (last && last.end_ep !== total) {
      last.end_ep = total;
      adjusted += 1;
    }

    return {
      powerLadder: rows,
      summary: {
        powerIntervalsInferred: inferred,
        powerIntervalsAdjusted: adjusted,
        notes: [],
      },
      warnings,
    };
  }

  private resolveTotal(totalChapters: number | null, storyPhases: StoryPhaseRow[], rowCount: number): number {
    if (typeof totalChapters === 'number' && totalChapters > 0) return Math.trunc(totalChapters);
    const maxStoryEnd = storyPhases.reduce((acc, item) => {
      const end = this.toPos(item.end_ep);
      return end && end > acc ? end : acc;
    }, 0);
    if (maxStoryEnd > 0) return maxStoryEnd;
    return Math.max(12, rowCount * 8);
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

  private resolveHint(row: PowerRow): SpanHint {
    const text = `${row.level_title} ${row.identity_desc} ${row.ability_boundary}`;
    if (/(旁听|传话|私下提醒|卑微|初期|开局)/u.test(text)) return 'early';
    if (/(影子军师|全权|摊牌|终局|总指挥|后期)/u.test(text)) return 'late';
    return 'mid';
  }

  private applyHint(range: [number, number], hint: SpanHint, total: number): [number, number] {
    const width = Math.max(3, range[1] - range[0] + 1);
    if (hint === 'early') {
      const start = Math.max(1, Math.min(range[0], Math.floor(total * 0.3) - width + 1));
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
