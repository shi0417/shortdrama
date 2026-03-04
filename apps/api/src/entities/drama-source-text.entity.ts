import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { DramaNovel } from './drama-novel.entity';

@Entity({ name: 'drama_source_text' })
export class DramaSourceText {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: 'novels_id', type: 'int' })
  novelsId: number;

  @Column({ name: 'source_text', type: 'longtext', nullable: true })
  sourceText: string;

  @UpdateDateColumn({ name: 'update_time' })
  updateTime: Date;

  @ManyToOne(() => DramaNovel, (novel) => novel.sourceTexts)
  @JoinColumn({ name: 'novels_id' })
  novel: DramaNovel;
}
