import { AppService } from '@/app.service';
import { Controller, Get } from '@nestjs/common';

@Controller()
export class AppController {
    constructor(private readonly appService: AppService) {}

    @Get('ping')
    ping(): string {
        return this.appService.getHealth();
    }

    @Get('health')
    getHealth(): string {
        return this.appService.getHealth();
    }
}
