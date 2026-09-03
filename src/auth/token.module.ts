import { TokenService } from '@/auth/token.service';
import { Global, Module } from '@nestjs/common';

/**
 * Global because the access guard is global: every route's entry check needs to
 * be able to verify a token, not just the auth feature.
 */
@Global()
@Module({
    providers: [TokenService],
    exports: [TokenService],
})
export class TokenModule {}
