import {
  Injectable,
  CanActivate,
  ExecutionContext,
  NotFoundException,
} from '@nestjs/common';

@Injectable()
export class HealthCheckGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const authHeader = request.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new NotFoundException();
    }

    const token = authHeader.substring(7); // Remove 'Bearer ' prefix
    const expectedKey = process.env.HEALTHCHECK_KEY;

    if (!expectedKey) {
      throw new NotFoundException();
    }

    if (token !== expectedKey) {
      throw new NotFoundException();
    }

    return true;
  }
}
