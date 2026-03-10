export type WorldviewQueryModuleKey =
  | 'payoff'
  | 'opponents'
  | 'power'
  | 'traitor'
  | 'story_phase';

export type WorldviewQueryBundle = {
  moduleKey: WorldviewQueryModuleKey;
  terms: string[];
  phrases: string[];
};

export type WorldviewQueryContext = {
  setCore?: Record<string, unknown> | null;
  timelines: Array<Record<string, unknown>>;
  characters: Array<Record<string, unknown>>;
  keyNodes: Array<Record<string, unknown>>;
  explosions: Array<Record<string, unknown>>;
  skeletonTopics: Array<Record<string, unknown>>;
  skeletonTopicItems: Array<Record<string, unknown>>;
};

const MODULE_HINT_TERMS: Record<WorldviewQueryModuleKey, string[]> = {
  payoff: [
    '爽点',
    '反转',
    '爆点',
    '关键节点',
    '命运转折',
    '主角反击',
    '身份反差',
    '弱者翻盘',
    '绝境反击',
    '逆转',
    '反杀',
    '布局反转',
    '揭穿',
    '借力打力',
    '暗中操盘',
    '历史改写关键时刻',
  ],
  opponents: ['对手', '阵营', '威胁', '情报对抗', '军事对抗', '削藩', '靖难'],
  power: [
    '身份',
    '权力',
    '决策影响',
    '布局',
    '权力成长',
    '皇权',
    '女官身份',
    '身份卑微',
    '无法公开发言',
    '私下进言',
    '获取信任',
    '间接影响',
    '借力他人',
    '渗透情报',
    '调动忠臣',
    '影响军政决策',
  ],
  traitor: [
    '内鬼',
    '内奸',
    '叛徒',
    '潜伏',
    '渗透',
    '暗线',
    '可疑',
    '背叛',
    '里应外合',
    '开城门',
    '金川门',
    '李景隆',
    '伪装忠诚',
    '暗中通敌',
    '密报',
  ],
  story_phase: [
    '历史阶段',
    '战争节点',
    '政治变化',
    '历史事件',
    '改写历史',
    '朱元璋驾崩',
    '建文即位',
    '削藩',
    '朱棣装疯',
    '起兵',
    '南京危机',
    '金川门',
    '靖难结局',
    '1398',
    '1399',
    '1400',
    '1401',
    '1402',
    '干预',
    '改写',
    '反制',
    '放缓削藩',
    '阻止李景隆',
    '渗透燕王府',
    '改变军权走向',
    '守住南京',
  ],
};

const CORE_ENTITY_TERMS = [
  '沈昭',
  '朱棣',
  '建文帝',
  '李景隆',
  '姚广孝',
  '金川门',
  '削藩',
  '靖难',
];

export class WorldviewQueryBuilder {
  build(context: WorldviewQueryContext): WorldviewQueryBundle[] {
    return [
      this.buildPayoffBundle(context),
      this.buildOpponentsBundle(context),
      this.buildPowerBundle(context),
      this.buildTraitorBundle(context),
      this.buildStoryPhaseBundle(context),
    ];
  }

  private buildPayoffBundle(context: WorldviewQueryContext): WorldviewQueryBundle {
    const phrases = this.collectPhrases([
      context.setCore?.title,
      context.setCore?.rewrite_goal,
      context.setCore?.target_story,
      context.setCore?.constraint_text,
      ...context.explosions.slice(0, 8).flatMap((row) => [
        row.title,
        row.subtitle,
        row.explosion_type,
        this.limitText(row.scene_restoration, 40),
      ]),
      ...context.keyNodes
        .slice(0, 10)
        .flatMap((row) => [row.title, row.category, this.limitText(row.description, 40)]),
      ...context.skeletonTopicItems
        .slice(0, 10)
        .flatMap((row) => [row.item_title, this.limitText(row.content, 40)]),
      ...context.timelines.slice(0, 10).flatMap((row) => [row.time_node, row.event]),
    ]);

    return {
      moduleKey: 'payoff',
      terms: this.collectTerms([
        ...MODULE_HINT_TERMS.payoff,
        ...CORE_ENTITY_TERMS,
        ...phrases,
      ]),
      phrases,
    };
  }

  private buildOpponentsBundle(context: WorldviewQueryContext): WorldviewQueryBundle {
    const phrases = this.collectPhrases([
      context.setCore?.constraint_text,
      context.setCore?.core_text,
      ...context.characters.slice(0, 16).flatMap((row) => [
        row.name,
        row.faction,
        this.limitText(row.description, 50),
      ]),
      ...context.keyNodes.slice(0, 10).flatMap((row) => [row.title, row.description]),
      ...context.skeletonTopicItems
        .slice(0, 8)
        .flatMap((row) => [row.item_title, this.limitText(row.content, 40)]),
    ]);

    return {
      moduleKey: 'opponents',
      terms: this.collectTerms([
        ...MODULE_HINT_TERMS.opponents,
        ...CORE_ENTITY_TERMS,
        ...phrases,
      ]),
      phrases,
    };
  }

  private buildPowerBundle(context: WorldviewQueryContext): WorldviewQueryBundle {
    const phrases = this.collectPhrases([
      context.setCore?.protagonist_identity,
      context.setCore?.rewrite_goal,
      context.setCore?.constraint_text,
      ...context.timelines.slice(0, 12).flatMap((row) => [row.time_node, row.event]),
      ...context.keyNodes.slice(0, 10).flatMap((row) => [row.title, row.description]),
      ...context.characters
        .slice(0, 10)
        .flatMap((row) => [row.name, row.faction, row.personality]),
    ]);

    return {
      moduleKey: 'power',
      terms: this.collectTerms([
        ...MODULE_HINT_TERMS.power,
        ...CORE_ENTITY_TERMS,
        ...phrases,
      ]),
      phrases,
    };
  }

  private buildTraitorBundle(context: WorldviewQueryContext): WorldviewQueryBundle {
    const phrases = this.collectPhrases([
      context.setCore?.constraint_text,
      context.setCore?.rewrite_goal,
      ...context.characters.slice(0, 16).flatMap((row) => [
        row.name,
        row.faction,
        this.limitText(row.description, 50),
      ]),
      ...context.keyNodes.slice(0, 8).flatMap((row) => [row.title, row.description]),
      ...context.skeletonTopicItems
        .slice(0, 10)
        .flatMap((row) => [row.item_title, this.limitText(row.content, 40)]),
    ]);

    return {
      moduleKey: 'traitor',
      terms: this.collectTerms([
        ...MODULE_HINT_TERMS.traitor,
        ...CORE_ENTITY_TERMS,
        ...phrases,
      ]),
      phrases,
    };
  }

  private buildStoryPhaseBundle(context: WorldviewQueryContext): WorldviewQueryBundle {
    const phrases = this.collectPhrases([
      context.setCore?.target_story,
      context.setCore?.rewrite_goal,
      context.setCore?.constraint_text,
      ...context.timelines.slice(0, 14).flatMap((row) => [row.time_node, row.event]),
      ...context.keyNodes.slice(0, 10).flatMap((row) => [row.title, row.description]),
      ...context.skeletonTopicItems
        .slice(0, 10)
        .flatMap((row) => [row.item_title, this.limitText(row.content, 40)]),
      '朱元璋驾崩',
      '建文即位',
      '削藩',
      '朱棣装疯',
      '起兵',
      '南京危机',
      '金川门',
      '靖难结局',
      '放缓削藩',
      '阻止李景隆',
      '渗透燕王府',
      '守住南京',
    ]);

    return {
      moduleKey: 'story_phase',
      terms: this.collectTerms([
        ...MODULE_HINT_TERMS.story_phase,
        ...CORE_ENTITY_TERMS,
        ...phrases,
      ]),
      phrases,
    };
  }

  private collectPhrases(values: unknown[]): string[] {
    const phrases = values
      .map((item) => this.normalizeText(item))
      .filter(Boolean)
      .map((item) => this.limitText(item, 80))
      .filter((item) => item.length >= 2);
    return [...new Set(phrases)].slice(0, 18);
  }

  private collectTerms(values: string[]): string[] {
    const tokens = values.flatMap((item) => this.extractTerms(item));
    return [...new Set(tokens)].slice(0, 60);
  }

  private extractTerms(value: string): string[] {
    const text = this.normalizeText(value);
    if (!text) return [];
    const direct = text.length <= 20 ? [text] : [];
    const split = text
      .split(/[\s,，。！？；：、（）()《》“”"'‘’【】\[\]<>…—\-]+/u)
      .map((item) => item.trim())
      .filter(
        (item) =>
          item.length >= 2 &&
          item.length <= 20 &&
          !/^\d+$/u.test(item) &&
          !['我们', '他们', '这个', '一个', '没有', '以及', '因为', '所以'].includes(item),
      );
    return [...new Set([...direct, ...split])];
  }

  private normalizeText(value: unknown): string {
    if (typeof value === 'string') return value.trim();
    if (typeof value === 'number' || typeof value === 'boolean') return String(value).trim();
    return '';
  }

  private limitText(value: unknown, maxLength: number): string {
    const text = this.normalizeText(value);
    if (!text) return '';
    return text.length <= maxLength ? text : text.slice(0, maxLength);
  }
}
