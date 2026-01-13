import { Strategy } from 'passport-local';
import { PassportStrategy } from '@nestjs/passport';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { UsersService } from './users.service';
import { LoginUserDto } from './dto/login-user.dto';

@Injectable()
export class LocalStrategy extends PassportStrategy(Strategy) {
  constructor(private userService: UsersService) {
    super();
  }

  async validate(email: string, password: string): Promise<any> {
    console.log('local strategy validate');
    const userLoginDto = new LoginUserDto();
    Object.assign(userLoginDto, {
      email: email,
      password: password,
    });
    const user = await this.userService.login(userLoginDto);
    if (!user) {
      throw new UnauthorizedException();
    }
    return user;
  }
}
