import { Injectable } from '@nestjs/common';
import { MessagePattern } from '@nestjs/microservices';

@Injectable()
export class AppService {
  @MessagePattern('health')
  getHealth(): string {
    return 'Auth Service - microservice - Healthy';
  }
}
