import { Entity, PrimaryGeneratedColumn, Column, OneToMany } from 'typeorm';
import { DramaNovel } from './drama-novel.entity';

@Entity({ name: 'ai_short_drama_theme' })
export class AiShortDramaTheme {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: 'category_main', length: 100, nullable: true })
  categoryMain: string;

  @Column({ name: 'category_sub', length: 100, nullable: true })
  categorySub: string;

  @Column({ name: 'hot_level', type: 'int', nullable: true })
  hotLevel: number;

  @Column({ name: 'is_hot_track', type: 'tinyint', default: 0 })
  isHotTrack: number;

  @Column({ name: 'apply_scene', type: 'text', nullable: true })
  applyScene: string;

  @Column({ type: 'text', nullable: true })
  remarks: string;

  @OneToMany(() => DramaNovel, (novel) => novel.theme)
  novels: DramaNovel[];
}
