export type WorldviewQualityModuleKey =
  | 'payoff'
  | 'opponents'
  | 'power'
  | 'traitor'
  | 'story_phase';

export type WorldviewQualitySeverity = 'bad' | 'weak';

export type WorldviewQualityWarning = {
  moduleKey: WorldviewQualityModuleKey;
  path: string;
  severity: WorldviewQualitySeverity;
  reason: string;
};

export type WorldviewQualitySummary = {
  totalIssues: number;
  badCount: number;
  weakCount: number;
  byModule: Record<WorldviewQualityModuleKey, { bad: number; weak: number }>;
};

export type WorldviewDraftShape = {
  setPayoffArch: {
    name: string;
    notes: string;
    lines: Array<{
      line_name: string;
      line_content: string;
      start_ep?: number | null;
      end_ep?: number | null;
      stage_text?: string | null;
    }>;
  };
  setOpponentMatrix: {
    name: string;
    description: string;
    opponents: Array<{
      level_name?: string;
      opponent_name?: string;
      threat_type: string | null;
      detailed_desc: string | null;
    }>;
  };
  setPowerLadder: Array<{
    level_title: string;
    identity_desc: string;
    ability_boundary: string;
    start_ep?: number | null;
    end_ep?: number | null;
  }>;
  setTraitorSystem: {
    name: string;
    description: string;
    traitors: Array<{
      public_identity: string | null;
      real_identity: string | null;
      mission: string | null;
      threat_desc: string | null;
    }>;
    stages: Array<{ stage_title: string; stage_desc: string; start_ep: number | null; end_ep: number | null }>;
  };
  setStoryPhases: Array<{
    phase_name: string;
    start_ep: number | null;
    end_ep: number | null;
    historical_path: string | null;
    rewrite_path: string | null;
  }>;
};

type EvaluateOptions = {
  totalChapters?: number | null;
};

const MODULE_KEYS: WorldviewQualityModuleKey[] = [
  'payoff',
  'opponents',
  'power',
  'traitor',
  'story_phase',
];

const TRIVIAL_WORDS = ['角色', '人物', '内鬼', '阶段', '暂无', '无'];

export class WorldviewQualityChecker {
  evaluate(
    draft: WorldviewDraftShape,
    options?: EvaluateOptions,
  ): { qualitySummary: WorldviewQualitySummary; qualityWarnings: WorldviewQualityWarning[] } {
    const warnings: WorldviewQualityWarning[] = [];
    const push = (
      moduleKey: WorldviewQualityModuleKey,
      path: string,
      severity: WorldviewQualitySeverity,
      reason: string,
    ) => warnings.push({ moduleKey, path, severity, reason });

    this.checkPayoff(draft, push);
    this.checkOpponents(draft, push);
    this.checkPower(draft, push);
    this.checkTraitor(draft, push);
    this.checkStoryPhase(draft, options, push);

    return {
      qualitySummary: this.buildSummary(warnings),
      qualityWarnings: warnings,
    };
  }

  private checkPayoff(
    draft: WorldviewDraftShape,
    push: (m: WorldviewQualityModuleKey, p: string, s: WorldviewQualitySeverity, r: string) => void,
  ) {
    if (!this.normalize(draft.setPayoffArch.name)) {
      push('payoff', 'setPayoffArch.name', 'bad', '爽点架构标题为空');
    }
    if (this.isWeakText(draft.setPayoffArch.notes, 14)) {
      push('payoff', 'setPayoffArch.notes', 'weak', '爽点架构 notes 过短或过泛');
    }
    draft.setPayoffArch.lines.forEach((line, index) => {
      if (!this.normalize(line.line_name)) {
        push('payoff', `setPayoffArch.lines[${index}].line_name`, 'bad', 'line_name 为空');
      }
      const content = this.normalize(line.line_content);
      if (!content) {
        push('payoff', `setPayoffArch.lines[${index}].line_content`, 'bad', 'line_content 为空');
      } else if (this.isWeakText(content, 28) || this.similar(content, line.line_name) > 0.82) {
        push(
          'payoff',
          `setPayoffArch.lines[${index}].line_content`,
          'weak',
          'line_content 过短或接近标题复读',
        );
      }
    });
  }

  private checkOpponents(
    draft: WorldviewDraftShape,
    push: (m: WorldviewQualityModuleKey, p: string, s: WorldviewQualitySeverity, r: string) => void,
  ) {
    if (!this.normalize(draft.setOpponentMatrix.name)) {
      push('opponents', 'setOpponentMatrix.name', 'bad', '对手矩阵标题为空');
    }
    if (this.isWeakText(draft.setOpponentMatrix.description, 14)) {
      push('opponents', 'setOpponentMatrix.description', 'weak', '对手矩阵 description 偏弱');
    }
    draft.setOpponentMatrix.opponents.forEach((row, index) => {
      const levelName = this.normalize(row.level_name);
      const opponentName = this.normalize(row.opponent_name);
      if (/^(层级|分类)\d+$/u.test(levelName)) {
        push(
          'opponents',
          `setOpponentMatrix.opponents[${index}].level_name`,
          'weak',
          'level_name 仍为占位值',
        );
      }
      if (/^(对手|角色)\d+$/u.test(opponentName)) {
        push(
          'opponents',
          `setOpponentMatrix.opponents[${index}].opponent_name`,
          'bad',
          'opponent_name 仍为占位值',
        );
      }
      if (!this.normalize(row.threat_type) && !this.normalize(row.detailed_desc)) {
        push(
          'opponents',
          `setOpponentMatrix.opponents[${index}]`,
          'bad',
          'threat_type 和 detailed_desc 同时为空',
        );
      } else if (this.isWeakText(row.detailed_desc, 18)) {
        push(
          'opponents',
          `setOpponentMatrix.opponents[${index}].detailed_desc`,
          'weak',
          'detailed_desc 偏弱',
        );
      }
    });
  }

  private checkPower(
    draft: WorldviewDraftShape,
    push: (m: WorldviewQualityModuleKey, p: string, s: WorldviewQualitySeverity, r: string) => void,
  ) {
    draft.setPowerLadder.forEach((row, index) => {
      if (!this.normalize(row.level_title)) {
        push('power', `setPowerLadder[${index}].level_title`, 'bad', 'level_title 为空');
      }
      if (!this.normalize(row.identity_desc)) {
        push('power', `setPowerLadder[${index}].identity_desc`, 'bad', 'identity_desc 为空');
      } else if (this.isWeakText(row.identity_desc, 20)) {
        push('power', `setPowerLadder[${index}].identity_desc`, 'weak', 'identity_desc 偏弱');
      }
      if (!this.normalize(row.ability_boundary)) {
        push('power', `setPowerLadder[${index}].ability_boundary`, 'bad', 'ability_boundary 为空');
      } else if (this.isWeakText(row.ability_boundary, 20)) {
        push('power', `setPowerLadder[${index}].ability_boundary`, 'weak', 'ability_boundary 偏弱');
      }
    });
  }

  private checkTraitor(
    draft: WorldviewDraftShape,
    push: (m: WorldviewQualityModuleKey, p: string, s: WorldviewQualitySeverity, r: string) => void,
  ) {
    if (!this.normalize(draft.setTraitorSystem.name)) {
      push('traitor', 'setTraitorSystem.name', 'bad', '内鬼系统标题为空');
    }
    if (this.isWeakText(draft.setTraitorSystem.description, 24)) {
      push('traitor', 'setTraitorSystem.description', 'weak', '内鬼系统描述偏弱');
    }

    draft.setTraitorSystem.traitors.forEach((row, index) => {
      const publicIdentity = this.normalize(row.public_identity);
      const realIdentity = this.normalize(row.real_identity);
      const mission = this.normalize(row.mission);
      const threatDesc = this.normalize(row.threat_desc);

      if (!publicIdentity) {
        push(
          'traitor',
          `setTraitorSystem.traitors[${index}].public_identity`,
          'bad',
          'public_identity 为空',
        );
      } else if (this.isTrivialIdentity(publicIdentity)) {
        push(
          'traitor',
          `setTraitorSystem.traitors[${index}].public_identity`,
          'weak',
          'public_identity 过于模糊',
        );
      }

      if (!realIdentity) {
        push(
          'traitor',
          `setTraitorSystem.traitors[${index}].real_identity`,
          'bad',
          'real_identity 为空',
        );
      } else if (this.isTrivialIdentity(realIdentity)) {
        push(
          'traitor',
          `setTraitorSystem.traitors[${index}].real_identity`,
          'weak',
          'real_identity 过于模糊',
        );
      }

      if (publicIdentity && realIdentity && this.similar(publicIdentity, realIdentity) > 0.9) {
        push(
          'traitor',
          `setTraitorSystem.traitors[${index}]`,
          'weak',
          'public_identity 与 real_identity 几乎一致，缺少区分',
        );
      }

      if (!mission) {
        push('traitor', `setTraitorSystem.traitors[${index}].mission`, 'bad', 'mission 为空');
      } else if (this.isWeakText(mission, 16)) {
        push('traitor', `setTraitorSystem.traitors[${index}].mission`, 'weak', 'mission 偏弱');
      }

      if (!threatDesc) {
        push('traitor', `setTraitorSystem.traitors[${index}].threat_desc`, 'bad', 'threat_desc 为空');
      } else if (this.isWeakText(threatDesc, 16)) {
        push(
          'traitor',
          `setTraitorSystem.traitors[${index}].threat_desc`,
          'weak',
          'threat_desc 偏弱',
        );
      }
    });

    draft.setTraitorSystem.stages.forEach((row, index) => {
      const stageDesc = this.normalize(row.stage_desc);
      if (!stageDesc) {
        push('traitor', `setTraitorSystem.stages[${index}].stage_desc`, 'bad', 'stage_desc 为空');
      } else if (this.isWeakText(stageDesc, 18)) {
        push(
          'traitor',
          `setTraitorSystem.stages[${index}].stage_desc`,
          'weak',
          'stage_desc 偏弱',
        );
      }
      if (row.start_ep !== null && row.end_ep !== null && row.start_ep > row.end_ep) {
        push(
          'traitor',
          `setTraitorSystem.stages[${index}]`,
          'bad',
          'start_ep 大于 end_ep',
        );
      }
    });
  }

  private checkStoryPhase(
    draft: WorldviewDraftShape,
    options: EvaluateOptions | undefined,
    push: (m: WorldviewQualityModuleKey, p: string, s: WorldviewQualitySeverity, r: string) => void,
  ) {
    const totalChapters =
      typeof options?.totalChapters === 'number' && options.totalChapters > 0
        ? options.totalChapters
        : null;

    draft.setStoryPhases.forEach((row, index) => {
      const phaseName = this.normalize(row.phase_name);
      const historicalPath = this.normalize(row.historical_path);
      const rewritePath = this.normalize(row.rewrite_path);
      const startEp = row.start_ep;
      const endEp = row.end_ep;

      if (!phaseName) {
        push('story_phase', `setStoryPhases[${index}].phase_name`, 'bad', 'phase_name 为空');
      }
      if (startEp === null || endEp === null) {
        push('story_phase', `setStoryPhases[${index}]`, 'bad', 'start_ep 或 end_ep 为空');
      } else {
        if (startEp <= 0 || endEp <= 0) {
          push('story_phase', `setStoryPhases[${index}]`, 'bad', '集数边界必须为正整数');
        }
        if (startEp > endEp) {
          push('story_phase', `setStoryPhases[${index}]`, 'bad', 'start_ep 大于 end_ep');
        }
        if (totalChapters && endEp > totalChapters + 3) {
          push(
            'story_phase',
            `setStoryPhases[${index}].end_ep`,
            'weak',
            `end_ep(${endEp}) 明显超出总集数(${totalChapters})`,
          );
        }
      }

      if (!historicalPath) {
        push('story_phase', `setStoryPhases[${index}].historical_path`, 'bad', 'historical_path 为空');
      } else if (this.isWeakText(historicalPath, 24)) {
        push(
          'story_phase',
          `setStoryPhases[${index}].historical_path`,
          'weak',
          'historical_path 偏弱或模板化',
        );
      }
      if (!rewritePath) {
        push('story_phase', `setStoryPhases[${index}].rewrite_path`, 'bad', 'rewrite_path 为空');
      } else if (this.isWeakText(rewritePath, 24)) {
        push(
          'story_phase',
          `setStoryPhases[${index}].rewrite_path`,
          'weak',
          'rewrite_path 偏弱或模板化',
        );
      }

      if (historicalPath && rewritePath && this.similar(historicalPath, rewritePath) > 0.88) {
        push(
          'story_phase',
          `setStoryPhases[${index}]`,
          'weak',
          'historical_path 与 rewrite_path 过于相似，改写差异不足',
        );
      }
      if (phaseName && historicalPath && this.similar(historicalPath, phaseName) > 0.9) {
        push(
          'story_phase',
          `setStoryPhases[${index}].historical_path`,
          'weak',
          'historical_path 接近 phase_name 复读',
        );
      }

      if (startEp !== null && endEp !== null) {
        const phaseText = `${phaseName} ${historicalPath} ${rewritePath}`;
        const earlyHint = /(前期|初期|开局)/u.test(phaseText);
        const lateHint = /(决战|终局|收尾|结局)/u.test(phaseText);
        if (earlyHint && startEp > 20) {
          push(
            'story_phase',
            `setStoryPhases[${index}]`,
            'weak',
            '阶段语义偏前期，但区间起点较后',
          );
        }
        if (lateHint && endEp < 15) {
          push(
            'story_phase',
            `setStoryPhases[${index}]`,
            'weak',
            '阶段语义偏终局，但区间终点较前',
          );
        }
      }
    });
  }

  private buildSummary(warnings: WorldviewQualityWarning[]): WorldviewQualitySummary {
    const summary: WorldviewQualitySummary = {
      totalIssues: warnings.length,
      badCount: warnings.filter((item) => item.severity === 'bad').length,
      weakCount: warnings.filter((item) => item.severity === 'weak').length,
      byModule: {
        payoff: { bad: 0, weak: 0 },
        opponents: { bad: 0, weak: 0 },
        power: { bad: 0, weak: 0 },
        traitor: { bad: 0, weak: 0 },
        story_phase: { bad: 0, weak: 0 },
      },
    };

    warnings.forEach((item) => {
      summary.byModule[item.moduleKey][item.severity] += 1;
    });
    return summary;
  }

  private normalize(value: unknown): string {
    if (value === null || value === undefined) return '';
    return String(value).trim();
  }

  private isWeakText(value: unknown, minLength: number): boolean {
    const text = this.normalize(value);
    if (!text) return true;
    if (text.length < minLength) return true;
    if (/^(暂无|无|待补充|-)+$/u.test(text)) return true;
    return false;
  }

  private isTrivialIdentity(value: string): boolean {
    if (value.length <= 2) return true;
    return TRIVIAL_WORDS.some((item) => value === item);
  }

  private similar(left: string, right: string): number {
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

  private tokenize(text: string): Set<string> {
    return new Set(
      text
        .split(/[\s,，。！？；：、（）()《》“”"'‘’【】\[\]<>…—\-]+/u)
        .map((item) => item.trim())
        .filter((item) => item.length >= 2 && item.length <= 24),
    );
  }
}
