import { Controller } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { LoginService } from './login.service';
import type { IOAuthLoginResponseDTO, IOAuthUserDTO } from './DTO/login.DTO';

@Controller('login')
export class LoginController {
  constructor(private readonly loginService: LoginService) {}

  @MessagePattern('login_oauth')
  handleOAuthLogin(@Payload() user: IOAuthUserDTO): IOAuthLoginResponseDTO {
    return this.loginService.handleOAuthLogin(user);
  }
}
