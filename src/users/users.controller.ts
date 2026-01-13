import {Body, Controller, Post} from '@nestjs/common';
import {UsersService} from "./users.service";
import {LoginUserDto} from "./dto/login-user.dto";
import {Public} from "../guards";

@Controller('users')
export class UsersController {
  constructor(private usersService: UsersService) {}
  @Post('login')
  @Public()
  login(@Body() userLoginDto: LoginUserDto) {
    return this.usersService.login(userLoginDto);
  }
}
