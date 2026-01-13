import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Role } from '../users/role.enum';
import { ROLES_KEY } from './roles.decorator';
import { IS_PUBLIC_KEY } from './public.decorator';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }
    const requiredRoles = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!requiredRoles) {
      return true;
    }
    const { user } = context.switchToHttp().getRequest();
    if (requiredRoles.includes(Role.Admin) && user.role == Role.SuperAdmin) {
      // superAdmin has all admin functions
      return true;
    } else {
      if (
        requiredRoles.includes(Role.User) &&
        (user.role == Role.SuperAdmin || user.role == Role.Admin)
      ) {
        // admin has all user functions
        return true;
      }
      return requiredRoles.some((role) => user.role == role);
    }
  }
}
