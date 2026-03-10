import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity({ name: 'novel_source_segments' })
@Index('idx_nss_novel_active_segment', ['novelId', 'isActive', 'segmentIndex'])
@Index('idx_nss_source_active_segment', ['sourceTextId', 'isActive', 'segmentIndex'])
@Index('idx_nss_novel_active_chapter', ['novelId', 'isActive', 'chapterLabel'])
export class NovelSourceSegment {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: 'novel_id', type: 'int' })
  novelId: number;

  @Column({ name: 'source_text_id', type: 'int' })
  sourceTextId: number;

  @Column({ name: 'segment_index', type: 'int' })
  segmentIndex: number;

  @Column({ name: 'chapter_label', type: 'varchar', length: 128, nullable: true })
  chapterLabel: string | null;

  @Column({ name: 'title_hint', type: 'varchar', length: 255, nullable: true })
  titleHint: string | null;

  @Column({ name: 'start_offset', type: 'int' })
  startOffset: number;

  @Column({ name: 'end_offset', type: 'int' })
  endOffset: number;

  @Column({ name: 'char_length', type: 'int' })
  charLength: number;

  @Column({ name: 'content_text', type: 'longtext' })
  contentText: string;

  @Column({ name: 'keyword_text', type: 'text', nullable: true })
  keywordText: string | null;

  @Column({ name: 'is_active', type: 'tinyint', default: () => '1' })
  isActive: number;

  @Column({ type: 'int', default: () => '1' })
  version: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
