import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { DramaSourceText } from '../entities/drama-source-text.entity';
import { CreateSourceTextDto } from './dto/create-source-text.dto';
import { UpdateSourceTextDto } from './dto/update-source-text.dto';

@Injectable()
export class SourceTextsService {
  constructor(
    @InjectRepository(DramaSourceText)
    private sourceTextsRepository: Repository<DramaSourceText>,
  ) {}

  async findByNovelId(novelId: number) {
    const results = await this.sourceTextsRepository
      .createQueryBuilder('st')
      .select([
        'st.id',
        'st.novelsId',
        'st.updateTime',
        'LENGTH(st.sourceText) as contentLength',
      ])
      .where('st.novelsId = :novelId', { novelId })
      .orderBy('st.updateTime', 'DESC')
      .getRawMany();

    return results.map((r) => ({
      id: r.st_id,
      novelsId: r.st_novelsId,
      updateTime: r.st_updateTime,
      contentLength: parseInt(r.contentLength) || 0,
    }));
  }

  async findOne(id: number, mode?: string, offset?: number, limit?: number) {
    const sourceText = await this.sourceTextsRepository.findOne({
      where: { id },
    });

    if (!sourceText) {
      throw new NotFoundException(`Source text with ID ${id} not found`);
    }

    const totalLength = sourceText.sourceText?.length || 0;

    if (mode === 'range') {
      const start = offset || 0;
      const end = start + (limit || 5000);
      const text = sourceText.sourceText?.substring(start, end) || '';

      return {
        id: sourceText.id,
        offset: start,
        limit: limit || 5000,
        totalLength,
        text,
      };
    }

    return sourceText;
  }

  async create(novelId: number, createDto: CreateSourceTextDto) {
    const sourceText = this.sourceTextsRepository.create({
      novelsId: novelId,
      sourceText: createDto.sourceText || '',
    });
    return this.sourceTextsRepository.save(sourceText);
  }

  async update(id: number, updateDto: UpdateSourceTextDto) {
    const sourceText = await this.sourceTextsRepository.findOne({
      where: { id },
    });

    if (!sourceText) {
      throw new NotFoundException(`Source text with ID ${id} not found`);
    }

    sourceText.sourceText = updateDto.sourceText;
    return this.sourceTextsRepository.save(sourceText);
  }

  async remove(id: number) {
    const sourceText = await this.sourceTextsRepository.findOne({
      where: { id },
    });

    if (!sourceText) {
      throw new NotFoundException(`Source text with ID ${id} not found`);
    }

    await this.sourceTextsRepository.remove(sourceText);
    return { message: 'Source text deleted successfully' };
  }
}
