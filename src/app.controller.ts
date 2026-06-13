import { AppService } from '@/app.service';
import { Controller, Get } from '@nestjs/common';

@Controller()
export class AppController {
    constructor(private readonly appService: AppService) {}

    @Get('ping')
    getHealth(): string {
        return this.appService.getHealth();
    }
}
