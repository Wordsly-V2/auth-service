import { Module } from '@nestjs/common';
import { AppController } from '@/app.controller';
import { AppService } from '@/app.service';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { LoginModule } from '@/login/login.module';
import { PrismaModule } from '@/prisma/prisma.module';
import configuration from '@/config/configuration';
import { JwtModule, JwtSignOptions } from '@nestjs/jwt';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
    }),
    JwtModule.registerAsync({
      global: true,
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const secret = config.get('jwt.secret') as string;
        const expiresIn = config.get(
          'jwt.expiresIn',
        ) as JwtSignOptions['expiresIn'];

        return {
          secret,
          signOptions: {
            expiresIn: expiresIn,
            algorithm: 'RS256',
            issuer: 'auth-service',
          },
        };
      },
    }),

    LoginModule,
    PrismaModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
