import { AuthService } from '@/auth/auth.service';
import {
  IOAuthLoginResponseDTO,
  IOAuthUserDTO,
  JwtAuthPayload,
} from '@/auth/dto/auth.dto';
import { InternalServiceGuard } from '@/guard/internal-service/internal-service.guard';
import { Controller, Post, UseGuards } from '@nestjs/common';
import { Payload } from '@nestjs/microservices';

@Controller('auth')
@UseGuards(InternalServiceGuard)
export class AuthController {
  constructor(private readonly loginService: AuthService) {}

  @Post('login-oauth')
  async handleOAuthLogin(
    @Payload()
    {
      user,
      userIpAddress,
    }: {
      user: IOAuthUserDTO;
      userIpAddress: string | undefined;
    },
  ): Promise<IOAuthLoginResponseDTO> {
    const response = await this.loginService.handleOAuthLogin(
      user,
      userIpAddress,
    );
    return response;
  }

  @Post('refresh-token')
  async handleRefreshToken(
    @Payload()
    {
      jwtPayload,
      userIpAddress,
    }: {
      jwtPayload: JwtAuthPayload;
      userIpAddress: string | undefined;
    },
  ): Promise<IOAuthLoginResponseDTO> {
    return this.loginService.handleRefreshToken({ jwtPayload, userIpAddress });
  }

  @Post('logout')
  handleLogout(
    @Payload()
    {
      user,
      isLoggedOutFromAllDevices,
    }: {
      user: JwtAuthPayload;
      isLoggedOutFromAllDevices: boolean;
    },
  ): Promise<{ success: boolean }> {
    return this.loginService.handleLogout(user, isLoggedOutFromAllDevices);
  }
}
