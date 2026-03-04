import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

type RowRecord = Record<string, any>;

export interface PipelineOverviewDto {
  timelines: RowRecord[];
  characters: RowRecord[];
  keyNodes: RowRecord[];
  explosions: RowRecord[];
  skeletonTopics: Array<RowRecord & { items: RowRecord[] }>;
  worldview: {
    core: RowRecord[];
    payoffArch: RowRecord[];
    opponents: RowRecord[];
    powerLadder: RowRecord[];
    traitors: RowRecord[];
    storyPhases: RowRecord[];
  };
}

@Injectable()
export class PipelineService {
  constructor(private readonly dataSource: DataSource) {}

  async getOverview(novelId: number): Promise<PipelineOverviewDto> {
    const timelines = await this.selectByNovel('novel_timelines', 't', novelId);
    const characters = await this.selectByNovel('novel_characters', 'c', novelId);
    const keyNodes = await this.selectByNovel('novel_key_nodes', 'k', novelId);
    const explosions = await this.selectByNovel('novel_explosions', 'e', novelId);

    const topics = await this.selectByNovel('novel_skeleton_topics', 'st', novelId, {
      orderBy: 'st.sort_order',
    });
    const topicItems = await this.selectByNovel('novel_skeleton_topic_items', 'si', novelId, {
      orderBy: 'si.sort_order',
    });
    const itemsByTopicId = new Map<number, RowRecord[]>();
    for (const item of topicItems) {
      const topicId = Number(item.topic_id ?? item.topicId);
      if (!itemsByTopicId.has(topicId)) {
        itemsByTopicId.set(topicId, []);
      }
      itemsByTopicId.get(topicId)!.push(item);
    }
    const skeletonTopics = topics.map((topic) => {
      const topicId = Number(topic.id);
      return {
        ...topic,
        items: itemsByTopicId.get(topicId) ?? [],
      };
    });

    const core = await this.selectByNovel('set_core', 'sc', novelId, {
      orderBy: 'sc.updated_at',
    });
    const payoffArch = await this.loadPayoffArch(novelId);
    const opponents = await this.loadOpponents(novelId);
    const powerLadder = await this.selectByNovel('set_power_ladder', 'pl', novelId, {
      orderBy: 'pl.sort_order',
    });
    const traitors = await this.loadTraitors(novelId);
    const storyPhases = await this.selectByNovel('set_story_phases', 'sp', novelId, {
      orderBy: 'sp.sort_order',
    });

    return {
      timelines,
      characters,
      keyNodes,
      explosions,
      skeletonTopics,
      worldview: {
        core,
        payoffArch,
        opponents,
        powerLadder,
        traitors,
        storyPhases,
      },
    };
  }

  private async hasTable(tableName: string): Promise<boolean> {
    const rows = await this.dataSource.query(
      'SELECT 1 FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? LIMIT 1',
      [tableName],
    );
    return Array.isArray(rows) && rows.length > 0;
  }

  private async selectByNovel(
    tableName: string,
    alias: string,
    novelId: number,
    options?: { orderBy?: string },
  ): Promise<RowRecord[]> {
    const tableExists = await this.hasTable(tableName);
    if (!tableExists) {
      return [];
    }

    const qb = this.dataSource
      .createQueryBuilder()
      .select(`${alias}.*`)
      .from(tableName, alias)
      .where(`${alias}.novel_id = :novelId`, { novelId });

    if (options?.orderBy) {
      qb.orderBy(options.orderBy, 'ASC');
    }

    return qb.getRawMany();
  }

  private async loadPayoffArch(novelId: number): Promise<RowRecord[]> {
    const archTableExists = await this.hasTable('set_payoff_arch');
    if (!archTableExists) {
      return [];
    }

    const lineTableExists = await this.hasTable('set_payoff_lines');
    const archRows = await this.selectByNovel('set_payoff_arch', 'pa', novelId, {
      orderBy: 'pa.updated_at',
    });

    if (!lineTableExists || archRows.length === 0) {
      return archRows;
    }

    const lineRows = await this.selectByNovel('set_payoff_lines', 'pl', novelId, {
      orderBy: 'pl.sort_order',
    });
    const linesByArchId = new Map<number, RowRecord[]>();

    for (const row of lineRows) {
      const archId = Number(row.payoff_arch_id ?? row.payoffArchId);
      if (!linesByArchId.has(archId)) {
        linesByArchId.set(archId, []);
      }
      linesByArchId.get(archId)!.push(row);
    }

    return archRows.map((arch) => ({
      ...arch,
      lines: linesByArchId.get(Number(arch.id)) ?? [],
    }));
  }

  private async loadOpponents(novelId: number): Promise<RowRecord[]> {
    const matrixTableExists = await this.hasTable('set_opponent_matrix');
    if (!matrixTableExists) {
      return [];
    }

    const opponentsTableExists = await this.hasTable('set_opponents');
    const matrixRows = await this.selectByNovel('set_opponent_matrix', 'om', novelId, {
      orderBy: 'om.updated_at',
    });

    if (!opponentsTableExists || matrixRows.length === 0) {
      return matrixRows;
    }

    const opponentRows = await this.selectByNovel('set_opponents', 'op', novelId, {
      orderBy: 'op.sort_order',
    });
    const opponentsByMatrixId = new Map<number, RowRecord[]>();

    for (const row of opponentRows) {
      const matrixId = Number(row.opponent_matrix_id ?? row.opponentMatrixId);
      if (!opponentsByMatrixId.has(matrixId)) {
        opponentsByMatrixId.set(matrixId, []);
      }
      opponentsByMatrixId.get(matrixId)!.push(row);
    }

    return matrixRows.map((matrix) => ({
      ...matrix,
      opponents: opponentsByMatrixId.get(Number(matrix.id)) ?? [],
    }));
  }

  private async loadTraitors(novelId: number): Promise<RowRecord[]> {
    const systemTableExists = await this.hasTable('set_traitor_system');
    if (!systemTableExists) {
      return [];
    }

    const traitorsTableExists = await this.hasTable('set_traitors');
    const stagesTableExists = await this.hasTable('set_traitor_stages');
    const systemRows = await this.selectByNovel('set_traitor_system', 'ts', novelId, {
      orderBy: 'ts.id',
    });

    if (systemRows.length === 0 || (!traitorsTableExists && !stagesTableExists)) {
      return systemRows;
    }

    const traitorRows = traitorsTableExists
      ? await this.selectByNovel('set_traitors', 'tr', novelId, { orderBy: 'tr.sort_order' })
      : [];
    const stageRows = stagesTableExists
      ? await this.selectByNovel('set_traitor_stages', 'st', novelId, { orderBy: 'st.sort_order' })
      : [];

    const traitorsBySystemId = new Map<number, RowRecord[]>();
    for (const row of traitorRows) {
      const systemId = Number(row.traitor_system_id ?? row.traitorSystemId);
      if (!traitorsBySystemId.has(systemId)) {
        traitorsBySystemId.set(systemId, []);
      }
      traitorsBySystemId.get(systemId)!.push(row);
    }

    const stagesBySystemId = new Map<number, RowRecord[]>();
    for (const row of stageRows) {
      const systemId = Number(row.traitor_system_id ?? row.traitorSystemId);
      if (!stagesBySystemId.has(systemId)) {
        stagesBySystemId.set(systemId, []);
      }
      stagesBySystemId.get(systemId)!.push(row);
    }

    return systemRows.map((system) => ({
      ...system,
      traitors: traitorsBySystemId.get(Number(system.id)) ?? [],
      stages: stagesBySystemId.get(Number(system.id)) ?? [],
    }));
  }
}
