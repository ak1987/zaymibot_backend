import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IS_INTERNAL_KEY } from './internal.decorator';
import { IS_PUBLIC_KEY } from './public.decorator';

@Injectable()
export class InternalGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    // If endpoint is public, allow access
    if (isPublic) {
      return true;
    }

    const isInternal = this.reflector.getAllAndOverride<boolean>(
      IS_INTERNAL_KEY,
      [context.getHandler(), context.getClass()],
    );

    // If endpoint is not marked as internal, allow access (other guards will handle it)
    if (!isInternal) {
      return true;
    }

    // For internal endpoints, check if request comes from Docker network
    const request = context.switchToHttp().getRequest();
    const clientIp = this.getClientIp(request);

    // Check if the request comes from Docker network (172.x.x.x or 10.x.x.x ranges)
    if (this.isDockerNetwork(clientIp)) {
      // Set a flag to bypass JWT authentication
      request.isInternalRequest = true;
      return true;
    }

    throw new ForbiddenException();
  }

  private getClientIp(request: any): string {
    // Check for forwarded IPs (from reverse proxy)
    const forwardedFor = request.headers['x-forwarded-for'];
    if (forwardedFor) {
      return forwardedFor.split(',')[0].trim();
    }

    // Check for real IP header (from reverse proxy)
    const realIp = request.headers['x-real-ip'];
    if (realIp) {
      return realIp;
    }

    // Fallback to connection remote address
    return (
      request.connection?.remoteAddress ||
      request.socket?.remoteAddress ||
      'unknown'
    );
  }

  private isDockerNetwork(ip: string): boolean {
    if (!ip || ip === 'unknown') {
      return false;
    }

    // Remove IPv6 prefix if present
    const cleanIp = ip.replace(/^::ffff:/, '');

    // Check if IP is in Docker network ranges
    // Docker default networks: 172.16.0.0/12, 10.0.0.0/8, 192.168.0.0/16
    const dockerRanges = [
      /^172\.(1[6-9]|2[0-9]|3[0-1])\./, // 172.16.0.0/12
      /^10\./, // 10.0.0.0/8
      /^192\.168\./, // 192.168.0.0/16
      /^127\.0\.0\.1$/, // localhost
      /^::1$/, // IPv6 localhost
    ];

    return dockerRanges.some((range) => range.test(cleanIp));
  }
}
