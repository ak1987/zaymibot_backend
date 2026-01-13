import { IsNotEmpty, IsEmail, MaxLength } from 'class-validator';

export class LoginUserDto {
  @IsNotEmpty()
  @MaxLength(32)
  readonly user: string;

  @IsNotEmpty()
  readonly password: string;
}