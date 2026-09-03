import { SigningKeyService } from '@/keys/signing-key.service';
import { Global, Module } from '@nestjs/common';

@Global()
@Module({
    providers: [SigningKeyService],
    exports: [SigningKeyService],
})
export class KeysModule {}
