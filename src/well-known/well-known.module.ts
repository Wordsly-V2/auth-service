import { WellKnownController } from '@/well-known/well-known.controller';
import { Module } from '@nestjs/common';

@Module({
    controllers: [WellKnownController],
})
export class WellKnownModule {}
