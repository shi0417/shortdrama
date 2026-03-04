import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  OneToMany,
  JoinColumn,
} from 'typeorm';
import { AiShortDramaTheme } from './ai-short-drama-theme.entity';
import { DramaSourceText } from './drama-source-text.entity';

@Entity({ name: 'drama_novels' })
export class DramaNovel {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: 'novels_name', length: 255 })
  novelsName: string;

  @Column({ name: 'total_chapters', type: 'int', default: 0 })
  totalChapters: number;

  @Column({ name: 'power_up_interval', type: 'int', default: 0 })
  powerUpInterval: number;

  @Column({ length: 255, nullable: true })
  author: string;

  @Column({ type: 'text', nullable: true })
  description: string;

  @Column({ type: 'tinyint', default: 0, comment: '0=draft, 1=active, 2=archived' })
  status: number;

  @Column({ name: 'theme_id', type: 'int', nullable: true })
  themeId: number;

  @CreateDateColumn({ name: 'create_time' })
  createTime: Date;

  @ManyToOne(() => AiShortDramaTheme, { nullable: true })
  @JoinColumn({ name: 'theme_id' })
  theme: AiShortDramaTheme;

  @OneToMany(() => DramaSourceText, (sourceText) => sourceText.novel)
  sourceTexts: DramaSourceText[];
}
