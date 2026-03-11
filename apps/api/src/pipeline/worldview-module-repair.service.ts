import {
  WorldviewClosureModuleKey,
  WorldviewRepairPlan,
  WorldviewValidationIssue,
} from './worldview-closure.types';

type DraftLike = Record<string, any>;

type ModuleRepairParams = {
  draft: DraftLike;
  plan: WorldviewRepairPlan;
  issues: WorldviewValidationIssue[];
  usedModelKey: string;
  promptPreview: string;
  evidenceBlock: string;
  aiGenerateJson: (modelKey: string, prompt: string) => Promise<Record<string, unknown>>;
};

const MODULE_TO_TOP_KEY: Record<
  Exclude<WorldviewClosureModuleKey, 'evidence'>,
  keyof DraftLike
> = {
  payoff: 'setPayoffArch',
  opponents: 'setOpponentMatrix',
  power: 'setPowerLadder',
  traitor: 'setTraitorSystem',
  story_phase: 'setStoryPhases',
};

export class WorldviewModuleRepairService {
  async apply(params: ModuleRepairParams): Promise<DraftLike> {
    let next = this.fixInPlace(params.draft, params.issues);
    if (params.plan.actionType !== 'regenerate_modules' || !params.plan.targetModules.length) {
      return next;
    }
    return this.regenerateModules(next, params);
  }

  private fixInPlace(draft: DraftLike, issues: WorldviewValidationIssue[]): DraftLike {
    const next = JSON.parse(JSON.stringify(draft)) as DraftLike;
    next.setTraitorSystem = next.setTraitorSystem || { traitors: [], stages: [] };
    next.setOpponentMatrix = next.setOpponentMatrix || { opponents: [] };

    if (Array.isArray(next.setTraitorSystem?.traitors)) {
      next.setTraitorSystem.traitors = next.setTraitorSystem.traitors.map(
        (item: any, index: number) => {
          const name = this.normalize(item.name) || `内鬼${index + 1}`;
          let publicIdentity = this.normalize(item.public_identity);
          let realIdentity = this.normalize(item.real_identity);
          if (!publicIdentity) publicIdentity = '表面忠臣/关键角色';
          if (!realIdentity) realIdentity = '隐藏立场角色';
          if (publicIdentity === realIdentity) realIdentity = `${realIdentity}（隐藏）`;
          return {
            ...item,
            name,
            public_identity: publicIdentity,
            real_identity: realIdentity,
            mission:
              this.normalize(item.mission) ||
              `围绕关键节点执行潜伏/误导任务，影响主线决策（角色：${name}）`,
            threat_desc:
              this.normalize(item.threat_desc) ||
              `${name} 在关键阶段制造情报偏差与决策风险，形成对主角改写路径的破坏`,
          };
        },
      );
    }

    if (Array.isArray(next.setTraitorSystem?.stages)) {
      next.setTraitorSystem.stages = next.setTraitorSystem.stages.map(
        (item: any, index: number) => {
          const title = this.normalize(item.stage_title);
          const semanticTitle = this.replaceStageTitle(title, index);
          return {
            ...item,
            stage_title: semanticTitle,
            stage_desc:
              this.normalize(item.stage_desc) ||
              `在“${semanticTitle}”阶段推进内鬼线：线索暴露 -> 定位嫌疑 -> 反制布局。`,
          };
        },
      );
    }

    if (Array.isArray(next.setOpponentMatrix?.opponents)) {
      next.setOpponentMatrix.opponents = next.setOpponentMatrix.opponents.map(
        (item: any, index: number) => {
          const currentName = this.normalize(item.opponent_name);
          const currentLevel = this.normalize(item.level_name);
          const desc = this.normalize(item.detailed_desc);
          const threat = this.normalize(item.threat_type);
          return {
            ...item,
            level_name:
              /^(层级|分类)\d+$/u.test(currentLevel) || !currentLevel
                ? this.inferLevel(desc, threat) || `威胁层${index + 1}`
                : currentLevel,
            opponent_name:
              /^(对手|角色)\d+$/u.test(currentName) || !currentName
                ? this.inferOpponent(desc, threat) || `关键威胁角色${index + 1}`
                : currentName,
            threat_type: threat || this.inferThreat(desc) || '复合威胁',
          };
        },
      );
    }

    if (Array.isArray(next.setStoryPhases)) {
      next.setStoryPhases = next.setStoryPhases.map((item: any) => {
        const rewritePath = this.normalize(item.rewrite_path);
        if (/(改写|介入|反制|布局|阻止|扭转)/u.test(rewritePath)) return item;
        return {
          ...item,
          rewrite_path: rewritePath
            ? `沈昭介入并采取布局动作：${rewritePath}`
            : '沈昭主动介入关键节点，重排情报与决策链，扭转原历史走向',
        };
      });
    }

    issues.forEach((issue) => {
      if (!issue.path) return;
      if (issue.path.includes('start_ep') || issue.path.includes('end_ep')) {
        // interval 修复已在 v5 inference 层执行，这里仅保留占位。
      }
    });

    return next;
  }

  private async regenerateModules(
    draft: DraftLike,
    params: ModuleRepairParams,
  ): Promise<DraftLike> {
    const moduleKeys = params.plan.targetModules.filter(
      (item): item is Exclude<WorldviewClosureModuleKey, 'evidence'> => item !== 'evidence',
    );
    if (!moduleKeys.length) return draft;

    const prompt = this.buildRepairPrompt({
      draft,
      moduleKeys,
      issues: params.issues,
      evidenceBlock: params.evidenceBlock,
      basePrompt: params.promptPreview,
    });

    const repairedPart = await params.aiGenerateJson(params.usedModelKey, prompt);
    const merged = JSON.parse(JSON.stringify(draft));
    moduleKeys.forEach((moduleKey) => {
      const topKey = MODULE_TO_TOP_KEY[moduleKey];
      if (repairedPart[topKey] !== undefined) {
        merged[topKey] = repairedPart[topKey];
      }
    });
    return merged;
  }

  private buildRepairPrompt(input: {
    draft: DraftLike;
    moduleKeys: Array<Exclude<WorldviewClosureModuleKey, 'evidence'>>;
    issues: WorldviewValidationIssue[];
    evidenceBlock: string;
    basePrompt: string;
  }): string {
    const moduleTopKeys = input.moduleKeys.map((item) => MODULE_TO_TOP_KEY[item]);
    const issueLines = input.issues
      .filter((item) => input.moduleKeys.includes(item.moduleKey as any))
      .slice(0, 20)
      .map((item) => `- [${item.moduleKey}] ${item.path}: ${item.reason}`)
      .join('\n');

    return [
      '你是短剧世界观修复助手。你只允许修复指定模块，不得改动其他模块。',
      '',
      '【修复目标模块】',
      moduleTopKeys.join(', '),
      '',
      '【当前问题】',
      issueLines || '- 无（按目标模块增强语义质量）',
      '',
      '【证据片段】',
      input.evidenceBlock || '无额外证据，需基于现有草稿尽力修复',
      '',
      '【当前完整草稿】',
      JSON.stringify(input.draft),
      '',
      '【输出要求】',
      `1) 只返回 JSON 对象，且仅包含以下 key：${moduleTopKeys.join(', ')}`,
      '2) 不要返回任何解释、markdown、注释',
      '3) 不要修改未列出的模块',
      '4) 优先修复 issue 指出的字段语义问题',
    ].join('\n');
  }

  private replaceStageTitle(title: string, index: number): string {
    if (!/^(阶段\d+|stage\s*\d+)$/iu.test(title)) return title || `阶段${index + 1}`;
    const fallback = ['可疑浮现', '潜伏渗透', '暗线布局', '暴露对抗', '反向利用'];
    return fallback[index] || `推进阶段${index + 1}`;
  }

  private inferOpponent(textA: string, textB: string): string | null {
    const text = `${textA} ${textB}`;
    const names = ['朱棣', '姚广孝', '李景隆', '黄子澄', '齐泰', '燕王府', '保守朝臣集团'];
    return names.find((name) => text.includes(name)) || null;
  }

  private inferLevel(desc: string, threat: string): string | null {
    const text = `${desc} ${threat}`;
    if (/军事|战场|兵权/u.test(text)) return '军事威胁层';
    if (/情报|渗透|泄密|内应/u.test(text)) return '情报渗透层';
    if (/朝堂|决策|政治/u.test(text)) return '政治决策层';
    if (/身份|暴露|信任/u.test(text)) return '身份危机层';
    return null;
  }

  private inferThreat(text: string): string | null {
    if (/军事|兵权|战场/u.test(text)) return '军事威胁';
    if (/情报|渗透|泄密|暗线/u.test(text)) return '情报威胁';
    if (/决策|误导|掣肘/u.test(text)) return '决策干扰';
    if (/身份|暴露/u.test(text)) return '身份危机';
    return null;
  }

  private normalize(value: unknown): string {
    if (value === null || value === undefined) return '';
    return String(value).trim();
  }
}

