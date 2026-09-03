import { isValidInternalToken } from '@/common/internal-token';
import {
    CanActivate,
    ExecutionContext,
    Injectable,
    UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';

@Injectable()
export class InternalServiceGuard implements CanActivate {
    constructor(private readonly configService: ConfigService) {}

    canActivate(context: ExecutionContext): boolean | Promise<boolean> {
        const request = context
            .switchToHttp()
            .getRequest<
                Request & { headers: { 'x-service-token': string | undefined } }
            >();

        const presented = request.headers['x-service-token'];
        const expected = this.configService.get<string>(
            'internalServiceToServiceToken',
        );

        if (!isValidInternalToken(presented, expected)) {
            throw new UnauthorizedException();
        }

        return true;
    }
}
