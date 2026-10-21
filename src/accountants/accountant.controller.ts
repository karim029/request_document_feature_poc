import { Controller, Get, Param, ParseIntPipe } from '@nestjs/common';
import { DashboardService } from './accountant.service';
@Controller('accountants')
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @Get(':id/dashboard')
  getDashboard(@Param('id', ParseIntPipe) id: number) {
    return this.dashboardService.getDashboard(id);
  }
}