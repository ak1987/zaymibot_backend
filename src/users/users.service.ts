import { Injectable, HttpException, HttpStatus } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { LoginUserDto } from './dto/login-user.dto';
import { Role } from './role.enum';

@Injectable()
export class UsersService {
  constructor(private jwtService: JwtService) {}

  async login(userLoginDto: LoginUserDto): Promise<{ access_token: string }> {
    const adminUser = process.env.ADMIN_USER;
    const adminPass = process.env.ADMIN_PASS;

    if (!adminUser || !adminPass) {
      throw new HttpException(
        'Admin credentials not configured',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }

    const email = userLoginDto.user.toLowerCase();
    const password = userLoginDto.password;

    if (email === adminUser && password === adminPass) {
      const payload = {
        username: email,
        sub: 1, // Simple ID for admin user
        role: Role.Admin,
      };

      return {
        access_token: this.jwtService.sign(payload),
      };
    }

    throw new HttpException({}, HttpStatus.UNAUTHORIZED);
  }
}
