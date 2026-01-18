import { Injectable } from '@nestjs/common';
import { IOAuthLoginResponseDTO, IOAuthUserDTO } from './DTO/login.DTO';

@Injectable()
export class LoginService {
  handleOAuthLogin(user: IOAuthUserDTO): IOAuthLoginResponseDTO {
    console.log('handleOAuthLogin', user);
    return {
      accessToken: 'accessToken',
      refreshToken: 'refreshToken',
    };
  }
}
