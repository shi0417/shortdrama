import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { DramaNovel } from './drama-novel.entity';
import { DramaStructureTemplate } from './drama-structure-template.entity';

@Entity({ name: 'novel_episodes' })
export class Episode {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: 'novel_id', type: 'int' })
  novelId: number;

  @Column({ name: 'episode_number', type: 'int' })
  episodeNumber: number;

  @Column({ name: 'episode_title', type: 'varchar', length: 255 })
  episodeTitle: string;

  @Column({ type: 'varchar', length: 100, nullable: true })
  arc?: string;

  @Column({ type: 'text', nullable: true })
  opening?: string;

  @Column({ name: 'core_conflict', type: 'text', nullable: true })
  coreConflict?: string;

  @Column({ type: 'text', nullable: true })
  hooks?: string;

  @Column({ type: 'text', nullable: true })
  cliffhanger?: string;

  @Column({ name: 'full_content', type: 'longtext', nullable: true })
  fullContent?: string;

  @Column({ name: 'outline_content', type: 'longtext', nullable: true })
  outlineContent?: string;

  @Column({ name: 'history_outline', type: 'text', nullable: true })
  historyOutline?: string;

  @Column({ name: 'rewrite_diff', type: 'longtext', nullable: true })
  rewriteDiff?: string;

  @Column({ name: 'structure_template_id', type: 'int', nullable: true })
  structureTemplateId?: number;

  @Column({ name: 'sort_order', type: 'int', nullable: true, default: 0 })
  sortOrder?: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @ManyToOne(() => DramaNovel, { nullable: false })
  @JoinColumn({ name: 'novel_id' })
  novel: DramaNovel;

  @ManyToOne(() => DramaStructureTemplate, { nullable: true })
  @JoinColumn({ name: 'structure_template_id' })
  structureTemplate?: DramaStructureTemplate;
}
