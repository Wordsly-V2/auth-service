import { Controller } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { AuthService } from '@/auth/auth.service';
import type {
  IOAuthLoginResponseDTO,
  IOAuthUserDTO,
} from '@/auth/DTO/auth.dto';

@Controller('login')
export class AuthController {
  constructor(private readonly loginService: AuthService) {}

  @MessagePattern('login_oauth')
  async handleOAuthLogin(
    @Payload() user: IOAuthUserDTO,
  ): Promise<IOAuthLoginResponseDTO> {
    return this.loginService.handleOAuthLogin(user);
  }
}
