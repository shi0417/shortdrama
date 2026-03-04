import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ThemesService } from './themes.service';
import { QueryThemeDto } from './dto/query-theme.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('themes')
@UseGuards(JwtAuthGuard)
export class ThemesController {
  constructor(private readonly themesService: ThemesService) {}

  @Get()
  findAll(@Query() query: QueryThemeDto) {
    return this.themesService.findAll(query);
  }
}
