import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import { CreateSkeletonTopicDto } from './dto/create-skeleton-topic.dto';
import { UpdateSkeletonTopicDto } from './dto/update-skeleton-topic.dto';

export interface SkeletonTopicRow {
  id: number;
  novelId: number;
  topicKey: string;
  topicName: string;
  topicType: 'text' | 'list' | 'json';
  description: string | null;
  sortOrder: number;
  isEnabled: number;
  createdAt: string;
  updatedAt: string;
}

export interface SkeletonTopicItemRow {
  id: number;
  novelId: number;
  topicId: number;
  itemTitle: string | null;
  content: string | null;
  contentJson: unknown;
  sortOrder: number;
  sourceRef: string | null;
  createdAt: string;
  updatedAt: string;
}

@Injectable()
export class SkeletonTopicsService {
  constructor(private readonly dataSource: DataSource) {}

  async listByNovel(novelId: number): Promise<SkeletonTopicRow[]> {
    await this.assertNovelExists(novelId);
    const rows = await this.dataSource.query(
      `
      SELECT
        id,
        novel_id AS novelId,
        topic_key AS topicKey,
        topic_name AS topicName,
        topic_type AS topicType,
        description,
        sort_order AS sortOrder,
        is_enabled AS isEnabled,
        created_at AS createdAt,
        updated_at AS updatedAt
      FROM novel_skeleton_topics
      WHERE novel_id = ?
      ORDER BY sort_order ASC, id ASC
      `,
      [novelId],
    );
    return rows;
  }

  async create(novelId: number, dto: CreateSkeletonTopicDto): Promise<SkeletonTopicRow> {
    await this.assertNovelExists(novelId);

    try {
      const insertResult: any = await this.dataSource.query(
        `
        INSERT INTO novel_skeleton_topics (
          novel_id, topic_key, topic_name, topic_type, description, sort_order, is_enabled
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
        `,
        [
          novelId,
          dto.topicKey,
          dto.topicName,
          dto.topicType,
          dto.description ?? null,
          dto.sortOrder ?? 0,
          dto.isEnabled ?? 1,
        ],
      );

      return this.getTopicById(insertResult.insertId);
    } catch (error: any) {
      if (this.isDuplicateKeyError(error)) {
        throw new ConflictException(
          `Skeleton topic key '${dto.topicKey}' already exists for novel ${novelId}`,
        );
      }
      throw error;
    }
  }

  async update(id: number, dto: UpdateSkeletonTopicDto): Promise<SkeletonTopicRow> {
    const existing = await this.getTopicById(id);

    const fields: string[] = [];
    const values: any[] = [];

    if (dto.topicKey !== undefined) {
      fields.push('topic_key = ?');
      values.push(dto.topicKey);
    }
    if (dto.topicName !== undefined) {
      fields.push('topic_name = ?');
      values.push(dto.topicName);
    }
    if (dto.topicType !== undefined) {
      fields.push('topic_type = ?');
      values.push(dto.topicType);
    }
    if (dto.description !== undefined) {
      fields.push('description = ?');
      values.push(dto.description);
    }
    if (dto.sortOrder !== undefined) {
      fields.push('sort_order = ?');
      values.push(dto.sortOrder);
    }
    if (dto.isEnabled !== undefined) {
      fields.push('is_enabled = ?');
      values.push(dto.isEnabled);
    }

    if (fields.length === 0) {
      throw new BadRequestException('At least one updatable field is required');
    }

    values.push(id);

    try {
      await this.dataSource.query(
        `
        UPDATE novel_skeleton_topics
        SET ${fields.join(', ')}
        WHERE id = ?
        `,
        values,
      );
      return this.getTopicById(id);
    } catch (error: any) {
      if (this.isDuplicateKeyError(error)) {
        throw new ConflictException(
          `Skeleton topic key '${dto.topicKey}' already exists for novel ${existing.novelId}`,
        );
      }
      throw error;
    }
  }

  async remove(id: number): Promise<{ ok: true }> {
    await this.getTopicById(id);
    await this.dataSource.query('DELETE FROM novel_skeleton_topics WHERE id = ?', [id]);
    return { ok: true };
  }

  async listItemsByTopic(topicId: number): Promise<SkeletonTopicItemRow[]> {
    await this.getTopicById(topicId);
    const rows = await this.dataSource.query(
      `
      SELECT
        id,
        novel_id AS novelId,
        topic_id AS topicId,
        item_title AS itemTitle,
        content,
        content_json AS contentJson,
        sort_order AS sortOrder,
        source_ref AS sourceRef,
        created_at AS createdAt,
        updated_at AS updatedAt
      FROM novel_skeleton_topic_items
      WHERE topic_id = ?
      ORDER BY sort_order ASC, id ASC
      `,
      [topicId],
    );
    return rows;
  }

  private async assertNovelExists(novelId: number): Promise<void> {
    const rows = await this.dataSource.query(
      'SELECT id FROM drama_novels WHERE id = ? LIMIT 1',
      [novelId],
    );
    if (!rows.length) {
      throw new NotFoundException(`Novel ${novelId} not found`);
    }
  }

  private async getTopicById(id: number): Promise<SkeletonTopicRow> {
    const rows = await this.dataSource.query(
      `
      SELECT
        id,
        novel_id AS novelId,
        topic_key AS topicKey,
        topic_name AS topicName,
        topic_type AS topicType,
        description,
        sort_order AS sortOrder,
        is_enabled AS isEnabled,
        created_at AS createdAt,
        updated_at AS updatedAt
      FROM novel_skeleton_topics
      WHERE id = ?
      LIMIT 1
      `,
      [id],
    );

    if (!rows.length) {
      throw new NotFoundException(`Skeleton topic ${id} not found`);
    }

    return rows[0];
  }

  private isDuplicateKeyError(error: any): boolean {
    return error?.code === 'ER_DUP_ENTRY' || error?.errno === 1062;
  }
}
