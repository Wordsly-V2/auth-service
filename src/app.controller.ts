import { AppService } from '@/app.service';
import { Public } from '@/common/decorators/public.decorator';
import { Controller, Get } from '@nestjs/common';

@Controller()
export class AppController {
    constructor(private readonly appService: AppService) {}

    @Public()
    @Get('ping')
    ping(): string {
        return this.appService.getHealth();
    }

    @Public()
    @Get('health')
    getHealth(): string {
        return this.appService.getHealth();
    }
}
