export type WorldviewAlignmentModuleKey = 'payoff' | 'opponents' | 'power' | 'traitor' | 'story_phase';

export type WorldviewAlignmentWarning = {
  moduleKey: WorldviewAlignmentModuleKey;
  path: string;
  severity: 'weak' | 'bad';
  reason: string;
};

export type WorldviewAlignmentSummary = {
  totalIssues: number;
  byModule: Record<WorldviewAlignmentModuleKey, number>;
};

type InputShape = {
  totalChapters: number | null;
  setPayoffArch: { lines: Array<{ line_name: string; start_ep: number | null; end_ep: number | null }> };
  setOpponentMatrix: { opponents: Array<{ level_name: string; opponent_name: string; threat_type: string | null }> };
  setPowerLadder: Array<{ level_no: number; level_title: string; start_ep: number | null; end_ep: number | null }>;
  setTraitorSystem: { stages: Array<{ stage_title: string; stage_desc: string; start_ep: number | null; end_ep: number | null }> };
  setStoryPhases: Array<{ phase_name: string; start_ep: number | null; end_ep: number | null }>;
};

export class WorldviewCrossTableAlignmentChecker {
  evaluate(input: InputShape): { alignmentSummary: WorldviewAlignmentSummary; alignmentWarnings: WorldviewAlignmentWarning[] } {
    const warnings: WorldviewAlignmentWarning[] = [];
    const total = input.totalChapters && input.totalChapters > 0 ? input.totalChapters : null;

    const push = (
      moduleKey: WorldviewAlignmentModuleKey,
      path: string,
      severity: 'weak' | 'bad',
      reason: string,
    ) => warnings.push({ moduleKey, path, severity, reason });

    const checkBounds = (
      moduleKey: WorldviewAlignmentModuleKey,
      rows: Array<{ start_ep: number | null; end_ep: number | null }>,
      pathPrefix: string,
    ) => {
      rows.forEach((row, index) => {
        if (row.start_ep === null || row.end_ep === null) {
          push(moduleKey, `${pathPrefix}[${index}]`, 'bad', 'missing interval anchor');
          return;
        }
        if (row.start_ep > row.end_ep) {
          push(moduleKey, `${pathPrefix}[${index}]`, 'bad', 'interval reversed');
        }
        if (total && (row.start_ep < 1 || row.end_ep > total)) {
          push(moduleKey, `${pathPrefix}[${index}]`, 'weak', 'interval outside total chapters');
        }
      });
    };

    checkBounds('story_phase', input.setStoryPhases, 'setStoryPhases');
    checkBounds('payoff', input.setPayoffArch.lines, 'setPayoffArch.lines');
    checkBounds('power', input.setPowerLadder, 'setPowerLadder');
    checkBounds('traitor', input.setTraitorSystem.stages, 'setTraitorSystem.stages');

    this.checkMonotonic(
      input.setPowerLadder.map((row) => ({ start: row.start_ep, end: row.end_ep, label: row.level_title })),
      'power',
      'setPowerLadder',
      push,
    );
    this.checkMonotonic(
      input.setTraitorSystem.stages.map((row) => ({
        start: row.start_ep,
        end: row.end_ep,
        label: row.stage_title,
      })),
      'traitor',
      'setTraitorSystem.stages',
      push,
    );

    input.setPayoffArch.lines.forEach((line, index) => {
      const text = line.line_name || '';
      if (/决战|终局|反杀|收网/u.test(text) && line.end_ep !== null && total && line.end_ep < total * 0.6) {
        push('payoff', `setPayoffArch.lines[${index}]`, 'weak', 'late-stage payoff appears too early');
      }
      if (/开局|前期|铺垫/u.test(text) && line.start_ep !== null && total && line.start_ep > total * 0.5) {
        push('payoff', `setPayoffArch.lines[${index}]`, 'weak', 'early-stage payoff appears too late');
      }
    });

    input.setPowerLadder.forEach((row, index) => {
      if (/Lv\.?1|一级|初阶/u.test(row.level_title) && row.start_ep !== null && total && row.start_ep > total * 0.4) {
        push('power', `setPowerLadder[${index}]`, 'weak', 'Lv.1 starts too late on story axis');
      }
    });

    input.setTraitorSystem.stages.forEach((row, index) => {
      if (/反制|收网|暴露/u.test(row.stage_desc) && row.end_ep !== null && total && row.end_ep < total * 0.55) {
        push('traitor', `setTraitorSystem.stages[${index}]`, 'weak', 'late traitor stage appears too early');
      }
    });

    input.setOpponentMatrix.opponents.forEach((row, index) => {
      if (/^对手\d+$/u.test((row.opponent_name || '').trim())) {
        push('opponents', `setOpponentMatrix.opponents[${index}].opponent_name`, 'bad', 'placeholder opponent_name remains');
      }
      if (!row.threat_type) {
        push('opponents', `setOpponentMatrix.opponents[${index}].threat_type`, 'weak', 'threat_type is empty');
      }
      if (/^层级\d+$/u.test((row.level_name || '').trim())) {
        push('opponents', `setOpponentMatrix.opponents[${index}].level_name`, 'weak', 'placeholder level_name remains');
      }
    });

    const summary: WorldviewAlignmentSummary = {
      totalIssues: warnings.length,
      byModule: {
        payoff: 0,
        opponents: 0,
        power: 0,
        traitor: 0,
        story_phase: 0,
      },
    };
    warnings.forEach((w) => {
      summary.byModule[w.moduleKey] += 1;
    });
    return { alignmentSummary: summary, alignmentWarnings: warnings };
  }

  private checkMonotonic(
    rows: Array<{ start: number | null; end: number | null; label: string }>,
    moduleKey: WorldviewAlignmentModuleKey,
    pathPrefix: string,
    push: (moduleKey: WorldviewAlignmentModuleKey, path: string, severity: 'weak' | 'bad', reason: string) => void,
  ) {
    let prevEnd = 0;
    rows.forEach((row, index) => {
      if (row.start === null || row.end === null) return;
      if (row.start < prevEnd) {
        push(moduleKey, `${pathPrefix}[${index}]`, 'weak', 'non-monotonic interval order');
      }
      prevEnd = Math.max(prevEnd, row.end);
    });
  }
}
