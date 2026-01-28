import { Controller } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { AuthService } from '@/auth/auth.service';
import {
  IOAuthLoginResponseDTO,
  IOAuthUserDTO,
  JwtAuthPayload,
} from '@/auth/DTO/auth.dto';

@Controller('login')
export class AuthController {
  constructor(private readonly loginService: AuthService) {}

  @MessagePattern('login_oauth')
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
    return this.loginService.handleOAuthLogin(user, userIpAddress);
  }

  @MessagePattern('refresh_token')
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

  @MessagePattern('logout')
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
