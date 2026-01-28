import { Controller, Get } from '@nestjs/common';
import { MessagePattern } from '@nestjs/microservices';
import { AppService } from '@/app.service';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @MessagePattern('health')
  getHealth(): string {
    return this.appService.getHealth();
  }

  @Get('health')
  getHealthHttp(): string {
    return this.appService.getHealth();
  }
}
