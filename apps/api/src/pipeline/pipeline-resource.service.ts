import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import { PipelineResourceName } from './dto/pipeline-resource.dto';

type RowRecord = Record<string, unknown>;

type ResourceConfig = {
  tableName: string;
  selectableFields: string[];
  editableFields: string[];
  numericFields?: string[];
  jsonFields?: string[];
  booleanFields?: string[];
  orderBy: string;
};

const RESOURCE_CONFIG: Record<PipelineResourceName, ResourceConfig> = {
  timelines: {
    tableName: 'novel_timelines',
    selectableFields: [
      'id',
      'novel_id',
      'time_node',
      'event',
      'sort_order',
      'revision_notes_json',
      'created_at',
    ],
    editableFields: ['time_node', 'event', 'sort_order'],
    numericFields: ['sort_order'],
    orderBy: 'sort_order ASC, id ASC',
  },
  characters: {
    tableName: 'novel_characters',
    selectableFields: [
      'id',
      'novel_id',
      'name',
      'faction',
      'description',
      'personality',
      'setting_words',
      'image_path',
      'sort_order',
      'revision_notes_json',
      'created_at',
    ],
    editableFields: [
      'name',
      'faction',
      'description',
      'personality',
      'setting_words',
      'image_path',
      'sort_order',
    ],
    numericFields: ['sort_order'],
    orderBy: 'sort_order ASC, id ASC',
  },
  'key-nodes': {
    tableName: 'novel_key_nodes',
    selectableFields: [
      'id',
      'novel_id',
      'timeline_id',
      'category',
      'title',
      'description',
      'sort_order',
      'revision_notes_json',
      'created_at',
    ],
    editableFields: ['category', 'title', 'description', 'timeline_id', 'sort_order'],
    numericFields: ['timeline_id', 'sort_order'],
    orderBy: 'sort_order ASC, id ASC',
  },
  explosions: {
    tableName: 'novel_explosions',
    selectableFields: [
      'id',
      'novel_id',
      'timeline_id',
      'explosion_type',
      'title',
      'subtitle',
      'scene_restoration',
      'dramatic_quality',
      'adaptability',
      'sort_order',
      'revision_notes_json',
      'created_at',
    ],
    editableFields: [
      'explosion_type',
      'title',
      'subtitle',
      'scene_restoration',
      'dramatic_quality',
      'adaptability',
      'timeline_id',
      'sort_order',
    ],
    numericFields: ['timeline_id', 'sort_order'],
    orderBy: 'sort_order ASC, id ASC',
  },
  'skeleton-topics': {
    tableName: 'novel_skeleton_topics',
    selectableFields: [
      'id',
      'novel_id',
      'topic_key',
      'topic_name',
      'topic_type',
      'description',
      'sort_order',
      'is_enabled',
      'created_at',
      'updated_at',
    ],
    editableFields: [
      'topic_key',
      'topic_name',
      'topic_type',
      'description',
      'sort_order',
      'is_enabled',
    ],
    numericFields: ['sort_order'],
    booleanFields: ['is_enabled'],
    orderBy: 'sort_order ASC, id ASC',
  },
  'skeleton-topic-items': {
    tableName: 'novel_skeleton_topic_items',
    selectableFields: [
      'id',
      'novel_id',
      'topic_id',
      'item_title',
      'content',
      'content_json',
      'source_ref',
      'sort_order',
      'revision_notes_json',
      'created_at',
      'updated_at',
    ],
    editableFields: [
      'topic_id',
      'item_title',
      'content',
      'content_json',
      'source_ref',
      'sort_order',
    ],
    numericFields: ['topic_id', 'sort_order'],
    jsonFields: ['content_json'],
    orderBy: 'sort_order ASC, id ASC',
  },
  'payoff-arch': {
    tableName: 'set_payoff_arch',
    selectableFields: [
      'id',
      'novel_id',
      'name',
      'notes',
      'version',
      'is_active',
      'created_at',
      'updated_at',
    ],
    editableFields: ['name', 'notes', 'version', 'is_active'],
    numericFields: ['version'],
    booleanFields: ['is_active'],
    orderBy: 'id ASC',
  },
  'payoff-lines': {
    tableName: 'set_payoff_lines',
    selectableFields: [
      'id',
      'novel_id',
      'payoff_arch_id',
      'line_key',
      'line_name',
      'line_content',
      'start_ep',
      'end_ep',
      'stage_text',
      'sort_order',
      'created_at',
      'updated_at',
    ],
    editableFields: [
      'payoff_arch_id',
      'line_key',
      'line_name',
      'line_content',
      'start_ep',
      'end_ep',
      'stage_text',
      'sort_order',
    ],
    numericFields: ['payoff_arch_id', 'start_ep', 'end_ep', 'sort_order'],
    orderBy: 'sort_order ASC, id ASC',
  },
  'opponent-matrix': {
    tableName: 'set_opponent_matrix',
    selectableFields: [
      'id',
      'novel_id',
      'name',
      'description',
      'version',
      'is_active',
      'created_at',
      'updated_at',
    ],
    editableFields: ['name', 'description', 'version', 'is_active'],
    numericFields: ['version'],
    booleanFields: ['is_active'],
    orderBy: 'id ASC',
  },
  opponents: {
    tableName: 'set_opponents',
    selectableFields: [
      'id',
      'novel_id',
      'opponent_matrix_id',
      'level_name',
      'opponent_name',
      'threat_type',
      'detailed_desc',
      'sort_order',
      'created_at',
    ],
    editableFields: [
      'opponent_matrix_id',
      'level_name',
      'opponent_name',
      'threat_type',
      'detailed_desc',
      'sort_order',
    ],
    numericFields: ['opponent_matrix_id', 'sort_order'],
    orderBy: 'sort_order ASC, id ASC',
  },
  'power-ladder': {
    tableName: 'set_power_ladder',
    selectableFields: [
      'id',
      'novel_id',
      'level_no',
      'level_title',
      'identity_desc',
      'ability_boundary',
      'start_ep',
      'end_ep',
      'sort_order',
      'created_at',
    ],
    editableFields: [
      'level_no',
      'level_title',
      'identity_desc',
      'ability_boundary',
      'start_ep',
      'end_ep',
      'sort_order',
    ],
    numericFields: ['level_no', 'start_ep', 'end_ep', 'sort_order'],
    orderBy: 'sort_order ASC, id ASC',
  },
  'traitor-system': {
    tableName: 'set_traitor_system',
    selectableFields: [
      'id',
      'novel_id',
      'name',
      'description',
      'version',
      'is_active',
      'created_at',
    ],
    editableFields: ['name', 'description', 'version', 'is_active'],
    numericFields: ['version'],
    booleanFields: ['is_active'],
    orderBy: 'id ASC',
  },
  traitors: {
    tableName: 'set_traitors',
    selectableFields: [
      'id',
      'novel_id',
      'traitor_system_id',
      'name',
      'public_identity',
      'real_identity',
      'mission',
      'threat_desc',
      'sort_order',
      'created_at',
    ],
    editableFields: [
      'traitor_system_id',
      'name',
      'public_identity',
      'real_identity',
      'mission',
      'threat_desc',
      'sort_order',
    ],
    numericFields: ['traitor_system_id', 'sort_order'],
    orderBy: 'sort_order ASC, id ASC',
  },
  'traitor-stages': {
    tableName: 'set_traitor_stages',
    selectableFields: [
      'id',
      'novel_id',
      'traitor_system_id',
      'stage_title',
      'stage_desc',
      'start_ep',
      'end_ep',
      'sort_order',
      'created_at',
    ],
    editableFields: [
      'traitor_system_id',
      'stage_title',
      'stage_desc',
      'start_ep',
      'end_ep',
      'sort_order',
    ],
    numericFields: ['traitor_system_id', 'start_ep', 'end_ep', 'sort_order'],
    orderBy: 'sort_order ASC, id ASC',
  },
  'story-phases': {
    tableName: 'set_story_phases',
    selectableFields: [
      'id',
      'novel_id',
      'phase_name',
      'start_ep',
      'end_ep',
      'historical_path',
      'rewrite_path',
      'sort_order',
      'created_at',
    ],
    editableFields: [
      'phase_name',
      'start_ep',
      'end_ep',
      'historical_path',
      'rewrite_path',
      'sort_order',
    ],
    numericFields: ['start_ep', 'end_ep', 'sort_order'],
    orderBy: 'sort_order ASC, id ASC',
  },
};

@Injectable()
export class PipelineResourceService {
  constructor(private readonly dataSource: DataSource) {}

  async listByNovel(
    novelId: number,
    resource: PipelineResourceName,
    topicId?: number,
  ): Promise<RowRecord[]> {
    await this.assertNovelExists(novelId);
    const config = this.getConfig(resource);

    if (resource === 'skeleton-topic-items' && topicId) {
      await this.assertTopicBelongsToNovel(topicId, novelId);
    }

    const fields = config.selectableFields.join(', ');
    const params: Array<number> = [novelId];
    let whereClause = 'novel_id = ?';
    if (resource === 'skeleton-topic-items' && topicId) {
      whereClause += ' AND topic_id = ?';
      params.push(topicId);
    }

    return this.dataSource.query(
      `
      SELECT ${fields}
      FROM ${config.tableName}
      WHERE ${whereClause}
      ORDER BY ${config.orderBy}
      `,
      params,
    );
  }

  async getOne(resource: PipelineResourceName, id: number): Promise<RowRecord> {
    const config = this.getConfig(resource);
    const row = await this.getRowById(config, id);
    if (!row) {
      throw new NotFoundException(`${resource} record ${id} not found`);
    }
    return row;
  }

  async create(
    novelId: number,
    resource: PipelineResourceName,
    payload: RowRecord,
  ): Promise<RowRecord> {
    await this.assertNovelExists(novelId);
    const config = this.getConfig(resource);
    const normalized = this.normalizeWritablePayload(config, payload, {
      novelId,
      resource,
    });

    if (resource === 'skeleton-topic-items') {
      const topicId = normalized.topic_id as number | null | undefined;
      if (!topicId) {
        throw new BadRequestException('topic_id is required for skeleton-topic-items');
      }
      await this.assertTopicBelongsToNovel(topicId, novelId);
    }

    if (resource === 'key-nodes' || resource === 'explosions') {
      const timelineId = normalized.timeline_id as number | null | undefined;
      if (timelineId) {
        await this.assertTimelineBelongsToNovel(timelineId, novelId);
      }
    }
    if (resource === 'payoff-lines') {
      const payoffArchId = normalized.payoff_arch_id as number | null | undefined;
      if (!payoffArchId) {
        throw new BadRequestException('payoff_arch_id is required for payoff-lines');
      }
      await this.assertPayoffArchBelongsToNovel(payoffArchId, novelId);
    }
    if (resource === 'opponents') {
      const matrixId = normalized.opponent_matrix_id as number | null | undefined;
      if (!matrixId) {
        throw new BadRequestException('opponent_matrix_id is required for opponents');
      }
      await this.assertOpponentMatrixBelongsToNovel(matrixId, novelId);
    }
    if (resource === 'traitors' || resource === 'traitor-stages') {
      const traitorSystemId = normalized.traitor_system_id as number | null | undefined;
      if (!traitorSystemId) {
        throw new BadRequestException(
          'traitor_system_id is required for traitors/traitor-stages',
        );
      }
      await this.assertTraitorSystemBelongsToNovel(traitorSystemId, novelId);
    }

    if ('sort_order' in this.fieldsToObject(config.editableFields) && normalized.sort_order === undefined) {
      normalized.sort_order = 0;
    }

    const columns = ['novel_id', ...Object.keys(normalized)];
    const values = [novelId, ...columns.slice(1).map((field) => normalized[field])];
    const placeholders = columns.map(() => '?').join(', ');

    const result: any = await this.dataSource.query(
      `
      INSERT INTO ${config.tableName} (${columns.join(', ')})
      VALUES (${placeholders})
      `,
      values,
    );

    return this.getOne(resource, Number(result.insertId));
  }

  async update(
    resource: PipelineResourceName,
    id: number,
    payload: RowRecord,
  ): Promise<RowRecord> {
    const config = this.getConfig(resource);
    const existing = await this.getRowById(config, id);
    if (!existing) {
      throw new NotFoundException(`${resource} record ${id} not found`);
    }

    const novelId = Number(existing.novel_id);
    const normalized = this.normalizeWritablePayload(config, payload, {
      novelId,
      resource,
      partial: true,
    });
    const fields = Object.keys(normalized);

    if (!fields.length) {
      throw new BadRequestException('No updatable fields provided');
    }

    if (resource === 'skeleton-topic-items' && fields.includes('topic_id')) {
      const topicId = normalized.topic_id as number | null | undefined;
      if (!topicId) {
        throw new BadRequestException('topic_id is required for skeleton-topic-items');
      }
      await this.assertTopicBelongsToNovel(topicId, novelId);
    }

    if (
      (resource === 'key-nodes' || resource === 'explosions') &&
      fields.includes('timeline_id')
    ) {
      const timelineId = normalized.timeline_id as number | null | undefined;
      if (timelineId) {
        await this.assertTimelineBelongsToNovel(timelineId, novelId);
      }
    }
    if (resource === 'payoff-lines' && fields.includes('payoff_arch_id')) {
      const payoffArchId = normalized.payoff_arch_id as number | null | undefined;
      if (!payoffArchId) {
        throw new BadRequestException('payoff_arch_id is required for payoff-lines');
      }
      await this.assertPayoffArchBelongsToNovel(payoffArchId, novelId);
    }
    if (resource === 'opponents' && fields.includes('opponent_matrix_id')) {
      const matrixId = normalized.opponent_matrix_id as number | null | undefined;
      if (!matrixId) {
        throw new BadRequestException('opponent_matrix_id is required for opponents');
      }
      await this.assertOpponentMatrixBelongsToNovel(matrixId, novelId);
    }
    if (
      (resource === 'traitors' || resource === 'traitor-stages') &&
      fields.includes('traitor_system_id')
    ) {
      const traitorSystemId = normalized.traitor_system_id as number | null | undefined;
      if (!traitorSystemId) {
        throw new BadRequestException(
          'traitor_system_id is required for traitors/traitor-stages',
        );
      }
      await this.assertTraitorSystemBelongsToNovel(traitorSystemId, novelId);
    }

    const assignments = fields.map((field) => `${field} = ?`).join(', ');
    const params = [...fields.map((field) => normalized[field]), id];
    await this.dataSource.query(
      `
      UPDATE ${config.tableName}
      SET ${assignments}
      WHERE id = ?
      `,
      params,
    );

    return this.getOne(resource, id);
  }

  async remove(resource: PipelineResourceName, id: number): Promise<{ ok: true }> {
    const config = this.getConfig(resource);
    const existing = await this.getRowById(config, id);
    if (!existing) {
      throw new NotFoundException(`${resource} record ${id} not found`);
    }

    await this.dataSource.query(`DELETE FROM ${config.tableName} WHERE id = ?`, [id]);
    return { ok: true };
  }

  private getConfig(resource: PipelineResourceName): ResourceConfig {
    const config = RESOURCE_CONFIG[resource];
    if (!config) {
      throw new BadRequestException(`Unsupported pipeline resource: ${resource}`);
    }
    return config;
  }

  private async getRowById(
    config: ResourceConfig,
    id: number,
  ): Promise<RowRecord | null> {
    const rows = await this.dataSource.query(
      `
      SELECT ${config.selectableFields.join(', ')}
      FROM ${config.tableName}
      WHERE id = ?
      LIMIT 1
      `,
      [id],
    );
    return rows[0] ?? null;
  }

  private normalizeWritablePayload(
    config: ResourceConfig,
    payload: RowRecord,
    options: { novelId: number; resource: PipelineResourceName; partial?: boolean },
  ): Record<string, unknown> {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw new BadRequestException('Payload must be an object');
    }

    const normalized: Record<string, unknown> = {};
    for (const field of config.editableFields) {
      if (!(field in payload)) {
        continue;
      }
      const value = payload[field];
      normalized[field] = this.normalizeFieldValue(config, field, value);
    }

    if (!options.partial && !Object.keys(normalized).length) {
      throw new BadRequestException(`No writable fields provided for ${options.resource}`);
    }

    return normalized;
  }

  private normalizeFieldValue(
    config: ResourceConfig,
    field: string,
    value: unknown,
  ): unknown {
    if (config.jsonFields?.includes(field)) {
      return this.normalizeJsonField(value, field);
    }

    if (config.numericFields?.includes(field)) {
      if (value === null || value === undefined || value === '') {
        return null;
      }
      const numericValue = Number(value);
      if (!Number.isFinite(numericValue)) {
        throw new BadRequestException(`${field} must be a valid number`);
      }
      return numericValue;
    }

    if (config.booleanFields?.includes(field)) {
      if (value === null || value === undefined || value === '') {
        return 0;
      }
      if (value === true || value === '1' || value === 1) {
        return 1;
      }
      if (value === false || value === '0' || value === 0) {
        return 0;
      }
      throw new BadRequestException(`${field} must be 0 or 1`);
    }

    if (value === null || value === undefined || value === '') {
      return null;
    }
    if (typeof value !== 'string') {
      return String(value);
    }
    return value.trim();
  }

  private normalizeJsonField(value: unknown, field: string): string | null {
    if (value === null || value === undefined || value === '') {
      return null;
    }

    if (typeof value === 'string') {
      try {
        const parsed = JSON.parse(value);
        return JSON.stringify(parsed);
      } catch {
        throw new BadRequestException(`${field} must be valid JSON`);
      }
    }

    if (typeof value === 'object') {
      return JSON.stringify(value);
    }

    throw new BadRequestException(`${field} must be valid JSON`);
  }

  private async assertNovelExists(novelId: number): Promise<void> {
    const rows = await this.dataSource.query(
      `SELECT id FROM drama_novels WHERE id = ? LIMIT 1`,
      [novelId],
    );
    if (!rows.length) {
      throw new NotFoundException(`Novel ${novelId} not found`);
    }
  }

  private async assertTopicBelongsToNovel(topicId: number, novelId: number): Promise<void> {
    const rows = await this.dataSource.query(
      `SELECT id FROM novel_skeleton_topics WHERE id = ? AND novel_id = ? LIMIT 1`,
      [topicId, novelId],
    );
    if (!rows.length) {
      throw new NotFoundException(
        `Skeleton topic ${topicId} does not belong to novel ${novelId}`,
      );
    }
  }

  private async assertTimelineBelongsToNovel(
    timelineId: number,
    novelId: number,
  ): Promise<void> {
    const rows = await this.dataSource.query(
      `SELECT id FROM novel_timelines WHERE id = ? AND novel_id = ? LIMIT 1`,
      [timelineId, novelId],
    );
    if (!rows.length) {
      throw new NotFoundException(
        `Timeline ${timelineId} does not belong to novel ${novelId}`,
      );
    }
  }

  private async assertPayoffArchBelongsToNovel(
    payoffArchId: number,
    novelId: number,
  ): Promise<void> {
    const rows = await this.dataSource.query(
      `SELECT id FROM set_payoff_arch WHERE id = ? AND novel_id = ? LIMIT 1`,
      [payoffArchId, novelId],
    );
    if (!rows.length) {
      throw new NotFoundException(
        `Payoff arch ${payoffArchId} does not belong to novel ${novelId}`,
      );
    }
  }

  private async assertOpponentMatrixBelongsToNovel(
    opponentMatrixId: number,
    novelId: number,
  ): Promise<void> {
    const rows = await this.dataSource.query(
      `SELECT id FROM set_opponent_matrix WHERE id = ? AND novel_id = ? LIMIT 1`,
      [opponentMatrixId, novelId],
    );
    if (!rows.length) {
      throw new NotFoundException(
        `Opponent matrix ${opponentMatrixId} does not belong to novel ${novelId}`,
      );
    }
  }

  private async assertTraitorSystemBelongsToNovel(
    traitorSystemId: number,
    novelId: number,
  ): Promise<void> {
    const rows = await this.dataSource.query(
      `SELECT id FROM set_traitor_system WHERE id = ? AND novel_id = ? LIMIT 1`,
      [traitorSystemId, novelId],
    );
    if (!rows.length) {
      throw new NotFoundException(
        `Traitor system ${traitorSystemId} does not belong to novel ${novelId}`,
      );
    }
  }

  private fieldsToObject(fields: string[]): Record<string, true> {
    return Object.fromEntries(fields.map((field) => [field, true])) as Record<string, true>;
  }
}
