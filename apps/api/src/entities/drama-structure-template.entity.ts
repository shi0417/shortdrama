import { Column, Entity, ManyToOne, OneToMany, PrimaryGeneratedColumn, JoinColumn } from 'typeorm';
import { DramaNovel } from './drama-novel.entity';
import { Episode } from './episode.entity';

@Entity({ name: 'drama_structure_template' })
export class DramaStructureTemplate {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: 'novels_id', type: 'int' })
  novelsId: number;

  @Column({ name: 'chapter_id', type: 'int' })
  chapterId: number;

  @Column({ name: 'power_level', type: 'int', default: 1 })
  powerLevel: number;

  @Column({ name: 'is_power_up_chapter', type: 'tinyint', default: 0 })
  isPowerUpChapter: number;

  @Column({ name: 'power_up_content', type: 'varchar', length: 300, nullable: true })
  powerUpContent?: string;

  @Column({ name: 'theme_type', type: 'varchar', length: 50 })
  themeType: string;

  @Column({ name: 'structure_name', type: 'varchar', length: 100 })
  structureName: string;

  @Column({ name: 'identity_gap', type: 'varchar', length: 200, nullable: true })
  identityGap?: string;

  @Column({ name: 'pressure_source', type: 'varchar', length: 200, nullable: true })
  pressureSource?: string;

  @Column({ name: 'first_reverse', type: 'varchar', length: 200, nullable: true })
  firstReverse?: string;

  @Column({ name: 'continuous_upgrade', type: 'varchar', length: 200, nullable: true })
  continuousUpgrade?: string;

  @Column({ name: 'suspense_hook', type: 'varchar', length: 200, nullable: true })
  suspenseHook?: string;

  @Column({ name: 'typical_opening', type: 'varchar', length: 500, nullable: true })
  typicalOpening?: string;

  @Column({ name: 'suitable_theme', type: 'varchar', length: 200, nullable: true })
  suitableTheme?: string;

  @Column({ name: 'hot_level', type: 'tinyint', default: 3 })
  hotLevel: number;

  @Column({ type: 'varchar', length: 500, nullable: true })
  remarks?: string;

  @Column({ name: 'create_time', type: 'datetime', default: () => 'CURRENT_TIMESTAMP' })
  createTime: Date;

  @ManyToOne(() => DramaNovel, { nullable: false })
  @JoinColumn({ name: 'novels_id' })
  novel: DramaNovel;

  @OneToMany(() => Episode, (episode) => episode.structureTemplate)
  episodes: Episode[];
}
