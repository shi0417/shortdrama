import {
  WorldviewValidationIssue,
  WorldviewValidationSeverity,
} from './worldview-closure.types';

type DraftLike = {
  setPayoffArch: {
    lines: Array<{ line_name: string; line_content: string }>;
  };
  setOpponentMatrix: {
    opponents: Array<{
      level_name: string;
      opponent_name: string;
      threat_type: string | null;
      detailed_desc: string | null;
    }>;
  };
  setPowerLadder: Array<{
    identity_desc: string;
    ability_boundary: string;
  }>;
  setTraitorSystem: {
    traitors: Array<{
      name: string;
      public_identity: string | null;
      real_identity: string | null;
      mission: string | null;
      threat_desc: string | null;
    }>;
    stages: Array<{
      stage_title: string;
      stage_desc: string;
    }>;
  };
  setStoryPhases: Array<{
    historical_path: string | null;
    rewrite_path: string | null;
  }>;
};

const OPPONENT_PLACEHOLDERS = [/^(对手|角色)\d+$/u, /^(opponent|enemy)\s*\d+$/iu];
const LEVEL_PLACEHOLDERS = [/^(层级|分类)\d+$/u, /^(level)\s*\d+$/iu];
const STAGE_PLACEHOLDERS = [/^阶段\d+$/u, /^stage\s*\d+$/iu];
const FRIENDLY_NAMES = ['盛庸', '耿炳文', '铁铉', '忠臣', '友军'];
const TRAITOR_STRONG_HINT = /(内鬼|内应|通敌|背叛|渗透|潜伏|里应外合|开城门|策反)/u;

export class WorldviewSemanticValidator {
  validate(draft: DraftLike): WorldviewValidationIssue[] {
    const issues: WorldviewValidationIssue[] = [];
    const push = (
      moduleKey: WorldviewValidationIssue['moduleKey'],
      path: string,
      severity: WorldviewValidationSeverity,
      reason: string,
      repairStrategy: WorldviewValidationIssue['repairStrategy'] = 'fix_in_place',
    ) => {
      issues.push({
        moduleKey,
        path,
        severity,
        reason,
        repairStrategy,
        source: 'semantic',
      });
    };

    draft.setOpponentMatrix.opponents.forEach((item, index) => {
      const opponentName = this.normalize(item.opponent_name);
      const levelName = this.normalize(item.level_name);
      const threatType = this.normalize(item.threat_type);
      const desc = this.normalize(item.detailed_desc);
      const full = `${opponentName} ${threatType} ${desc}`;

      if (OPPONENT_PLACEHOLDERS.some((reg) => reg.test(opponentName))) {
        push(
          'opponents',
          `setOpponentMatrix.opponents[${index}].opponent_name`,
          'major',
          'opponent_name 仍为占位值',
          'regenerate_module',
        );
      }
      if (LEVEL_PLACEHOLDERS.some((reg) => reg.test(levelName))) {
        push(
          'opponents',
          `setOpponentMatrix.opponents[${index}].level_name`,
          'major',
          'level_name 仍为占位值',
          'fix_in_place',
        );
      }
      if (!threatType) {
        push(
          'opponents',
          `setOpponentMatrix.opponents[${index}].threat_type`,
          'major',
          'threat_type 为空',
          'fix_in_place',
        );
      }
      if (!desc || desc.length < 24) {
        push(
          'opponents',
          `setOpponentMatrix.opponents[${index}].detailed_desc`,
          'minor',
          'detailed_desc 过短，威胁方式不清晰',
          'regenerate_module',
        );
      }
      if (FRIENDLY_NAMES.some((name) => full.includes(name))) {
        push(
          'opponents',
          `setOpponentMatrix.opponents[${index}]`,
          'major',
          '疑似将友军/中性角色写入对手矩阵',
          'regenerate_module',
        );
      }
    });

    draft.setTraitorSystem.traitors.forEach((item, index) => {
      const publicIdentity = this.normalize(item.public_identity);
      const realIdentity = this.normalize(item.real_identity);
      const mission = this.normalize(item.mission);
      const threatDesc = this.normalize(item.threat_desc);
      const full = `${item.name} ${publicIdentity} ${realIdentity} ${mission} ${threatDesc}`;

      if (!publicIdentity || !realIdentity) {
        push(
          'traitor',
          `setTraitorSystem.traitors[${index}]`,
          'major',
          'public_identity / real_identity 缺失',
          'fix_in_place',
        );
      } else if (this.similar(publicIdentity, realIdentity) > 0.9) {
        push(
          'traitor',
          `setTraitorSystem.traitors[${index}]`,
          'major',
          'public_identity 与 real_identity 近乎同义复读',
          'fix_in_place',
        );
      }

      if (!mission) {
        push(
          'traitor',
          `setTraitorSystem.traitors[${index}].mission`,
          'major',
          'mission 为空',
          'regenerate_module',
        );
      }
      if (!threatDesc) {
        push(
          'traitor',
          `setTraitorSystem.traitors[${index}].threat_desc`,
          'major',
          'threat_desc 为空',
          'regenerate_module',
        );
      }

      if (!TRAITOR_STRONG_HINT.test(full) && /(情报|传话|协助|联络)/u.test(full)) {
        push(
          'traitor',
          `setTraitorSystem.traitors[${index}]`,
          'major',
          '疑似将普通情报协助角色泛化为主内鬼角色',
          'regenerate_module',
        );
      }
    });

    draft.setTraitorSystem.stages.forEach((item, index) => {
      const stageTitle = this.normalize(item.stage_title);
      const stageDesc = this.normalize(item.stage_desc);
      if (STAGE_PLACEHOLDERS.some((reg) => reg.test(stageTitle))) {
        push(
          'traitor',
          `setTraitorSystem.stages[${index}].stage_title`,
          'minor',
          'stage_title 模板化，建议语义化命名',
          'fix_in_place',
        );
      }
      if (!stageDesc || stageDesc.length < 22) {
        push(
          'traitor',
          `setTraitorSystem.stages[${index}].stage_desc`,
          'major',
          'stage_desc 过短，无法体现阶段推进',
          'regenerate_module',
        );
      }
    });

    draft.setStoryPhases.forEach((item, index) => {
      const historicalPath = this.normalize(item.historical_path);
      const rewritePath = this.normalize(item.rewrite_path);
      if (historicalPath && rewritePath && this.similar(historicalPath, rewritePath) > 0.88) {
        push(
          'story_phase',
          `setStoryPhases[${index}]`,
          'major',
          'historical_path 与 rewrite_path 过于相似',
          'regenerate_module',
        );
      }
      if (!/(介入|改写|阻止|引导|布局|反制|渗透|调动|扭转|设局|破局)/u.test(rewritePath)) {
        push(
          'story_phase',
          `setStoryPhases[${index}].rewrite_path`,
          'minor',
          'rewrite_path 缺少主角动作化改写描述',
          'regenerate_module',
        );
      }
    });

    draft.setPayoffArch.lines.forEach((item, index) => {
      const content = this.normalize(item.line_content);
      const lineName = this.normalize(item.line_name);
      if (!content || content.length < 30 || this.similar(content, lineName) > 0.86) {
        push(
          'payoff',
          `setPayoffArch.lines[${index}].line_content`,
          'minor',
          'line_content 更像定义说明，缺少推进/升级/释放逻辑',
          'regenerate_module',
        );
      }
    });

    draft.setPowerLadder.forEach((item, index) => {
      const identityDesc = this.normalize(item.identity_desc);
      const abilityBoundary = this.normalize(item.ability_boundary);
      if (!/(身份|位置|权力|可见|朝堂|阵营|军政|决策)/u.test(identityDesc)) {
        push(
          'power',
          `setPowerLadder[${index}].identity_desc`,
          'minor',
          'identity_desc 未体现权力结构位置',
          'regenerate_module',
        );
      }
      if (!/(资源|影响|边界|限制|不能|可动用|触达|调度)/u.test(abilityBoundary)) {
        push(
          'power',
          `setPowerLadder[${index}].ability_boundary`,
          'minor',
          'ability_boundary 未体现资源/影响对象/限制',
          'regenerate_module',
        );
      }
    });

    return issues;
  }

  private normalize(value: unknown): string {
    if (value === null || value === undefined) return '';
    return String(value).trim();
  }

  private similar(left: string, right: string): number {
    const a = this.tokenize(left);
    const b = this.tokenize(right);
    if (!a.size || !b.size) return 0;
    let inter = 0;
    a.forEach((token) => {
      if (b.has(token)) inter += 1;
    });
    const union = new Set([...a, ...b]).size;
    return union ? inter / union : 0;
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

