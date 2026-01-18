import { Controller } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { LoginService } from '@/login/login.service';
import type {
  IOAuthLoginResponseDTO,
  IOAuthUserDTO,
} from '@/login/DTO/login.DTO';

@Controller('login')
export class LoginController {
  constructor(private readonly loginService: LoginService) {}

  @MessagePattern('login_oauth')
  async handleOAuthLogin(
    @Payload() user: IOAuthUserDTO,
  ): Promise<IOAuthLoginResponseDTO> {
    return this.loginService.handleOAuthLogin(user);
  }
}
