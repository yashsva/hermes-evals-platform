import { Body, Controller, Get, HttpCode, Param, ParseIntPipe, Post, Put, Query } from '@nestjs/common';
import { Definition } from '@evals/shared';
import { DefinitionsService } from './definitions.service';

/** Generic CRUD for every kind in DEFINITION_KINDS: /api/definitions/task, /api/definitions/config, … */
@Controller('api/definitions')
export class DefinitionsController {
  constructor(private readonly service: DefinitionsService) {}

  @Get('by-id/:id')
  byId(@Param('id', ParseIntPipe) id: number): Promise<Definition> {
    return this.service.getById(id);
  }

  @Get(':kind')
  list(@Param('kind') kind: string, @Query('archived') archived?: string): Promise<Definition[]> {
    return this.service.list(this.service.kind(kind), archived === 'true');
  }

  @Get(':kind/:key')
  get(@Param('kind') kind: string, @Param('key') key: string) {
    return this.service.get(this.service.kind(kind), key);
  }

  @Post(':kind')
  create(@Param('kind') kind: string, @Body() body: unknown): Promise<Definition> {
    return this.service.create(this.service.kind(kind), body);
  }

  @Put(':kind/:key')
  update(@Param('kind') kind: string, @Param('key') key: string, @Body() body: unknown): Promise<Definition> {
    return this.service.update(this.service.kind(kind), key, body);
  }

  @Post(':kind/:key/archive')
  @HttpCode(204)
  archive(@Param('kind') kind: string, @Param('key') key: string, @Body() body: { archived?: boolean }): Promise<void> {
    return this.service.setArchived(this.service.kind(kind), key, body?.archived !== false);
  }
}
