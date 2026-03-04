import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Like } from 'typeorm';
import { DramaNovel } from '../entities/drama-novel.entity';
import { CreateNovelDto } from './dto/create-novel.dto';
import { UpdateNovelDto } from './dto/update-novel.dto';
import { QueryNovelDto } from './dto/query-novel.dto';

@Injectable()
export class NovelsService {
  constructor(
    @InjectRepository(DramaNovel)
    private novelsRepository: Repository<DramaNovel>,
  ) {}

  async findAll(query: QueryNovelDto) {
    const where: any = {};

    if (query.keyword) {
      where.novelsName = Like(`%${query.keyword}%`);
    }

    if (query.status !== undefined) {
      where.status = query.status;
    }

    if (query.themeId !== undefined) {
      where.themeId = query.themeId;
    }

    return this.novelsRepository.find({
      where,
      relations: ['theme'],
      order: { createTime: 'DESC' },
    });
  }

  async findOne(id: number) {
    const novel = await this.novelsRepository.findOne({
      where: { id },
      relations: ['theme'],
    });

    if (!novel) {
      throw new NotFoundException(`Novel with ID ${id} not found`);
    }

    return novel;
  }

  async create(createNovelDto: CreateNovelDto) {
    const novel = this.novelsRepository.create(createNovelDto);
    return this.novelsRepository.save(novel);
  }

  async update(id: number, updateNovelDto: UpdateNovelDto) {
    const novel = await this.findOne(id);
    Object.assign(novel, updateNovelDto);
    return this.novelsRepository.save(novel);
  }

  async remove(id: number) {
    const novel = await this.findOne(id);
    await this.novelsRepository.remove(novel);
    return { message: 'Novel deleted successfully' };
  }
}
