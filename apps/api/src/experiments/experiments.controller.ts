import { Body, Controller, Get, HttpCode, Param, ParseIntPipe, Post } from '@nestjs/common';
import { CostEstimate, ExperimentDetail, ExperimentSummary, TrialDetail } from '@evals/shared';
import { ExperimentsService } from './experiments.service';

@Controller('api')
export class ExperimentsController {
  constructor(private readonly service: ExperimentsService) {}

  @Get('experiments')
  list(): Promise<ExperimentSummary[]> {
    return this.service.list();
  }

  /** Dry run: validates the selection and returns the cost estimate without creating anything. */
  @Post('experiments/estimate')
  @HttpCode(200)
  estimate(@Body() body: unknown): Promise<CostEstimate> {
    return this.service.estimate(body);
  }

  @Post('experiments')
  create(@Body() body: unknown): Promise<{ id: number }> {
    return this.service.create(body);
  }

  @Get('experiments/:id')
  detail(@Param('id', ParseIntPipe) id: number): Promise<ExperimentDetail> {
    return this.service.detail(id);
  }

  @Post('experiments/:id/cancel')
  @HttpCode(204)
  cancel(@Param('id', ParseIntPipe) id: number): Promise<void> {
    return this.service.cancel(id);
  }

  @Get('trials/:id')
  trial(@Param('id', ParseIntPipe) id: number): Promise<TrialDetail> {
    return this.service.trial(id);
  }
}
