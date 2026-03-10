import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import {
  allowedPipelineResources,
  PipelineResourceListQueryDto,
  PipelineResourceName,
} from './dto/pipeline-resource.dto';
import { PipelineResourceService } from './pipeline-resource.service';

@Controller()
@UseGuards(JwtAuthGuard)
export class PipelineResourceController {
  constructor(private readonly pipelineResourceService: PipelineResourceService) {}

  @Get('novels/:novelId/pipeline-resources/:resource')
  listResourceByNovel(
    @Param('novelId', ParseIntPipe) novelId: number,
    @Param('resource') resource: string,
    @Query() query: PipelineResourceListQueryDto,
  ) {
    return this.pipelineResourceService.listByNovel(
      novelId,
      this.parseResource(resource),
      query.topicId,
    );
  }

  @Get('pipeline-resources/:resource/:id')
  getResourceOne(
    @Param('resource') resource: string,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.pipelineResourceService.getOne(this.parseResource(resource), id);
  }

  @Post('novels/:novelId/pipeline-resources/:resource')
  createResource(
    @Param('novelId', ParseIntPipe) novelId: number,
    @Param('resource') resource: string,
    @Body() body: Record<string, unknown>,
  ) {
    return this.pipelineResourceService.create(
      novelId,
      this.parseResource(resource),
      body,
    );
  }

  @Patch('pipeline-resources/:resource/:id')
  updateResource(
    @Param('resource') resource: string,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: Record<string, unknown>,
  ) {
    return this.pipelineResourceService.update(this.parseResource(resource), id, body);
  }

  @Delete('pipeline-resources/:resource/:id')
  removeResource(
    @Param('resource') resource: string,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.pipelineResourceService.remove(this.parseResource(resource), id);
  }

  private parseResource(resource: string): PipelineResourceName {
    if ((allowedPipelineResources as readonly string[]).includes(resource)) {
      return resource as PipelineResourceName;
    }
    throw new BadRequestException(
      `Unsupported pipeline resource: ${resource}. Allowed resources: ${allowedPipelineResources.join(', ')}`,
    );
  }
}
