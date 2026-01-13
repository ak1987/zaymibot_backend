import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ServiceUnavailableException,
  Logger,
} from '@nestjs/common';

@Injectable()
export class MaintenanceGuard implements CanActivate {
  private readonly logger = new Logger(MaintenanceGuard.name);

  constructor() {
    const isEnabled = this.isMaintenanceModeEnabled();
    if (isEnabled) {
      this.logger.warn(
        '⚠️  Maintenance mode is ENABLED - all endpoints will return 503 (except health checks)',
      );
    }
  }

  canActivate(context: ExecutionContext): boolean {
    // Check if maintenance mode is enabled
    const isMaintenanceEnabled = this.isMaintenanceModeEnabled();

    if (!isMaintenanceEnabled) {
      return true; // Maintenance mode is off, allow all requests
    }

    // During maintenance, only allow health endpoints
    const request = context.switchToHttp().getRequest();
    const path = request.url || request.path || '';

    // Allow health endpoints
    if (path && (path.includes('/health') || path.includes('/v1/health'))) {
      return true; // Allow health endpoints
    }

    // Maintenance mode is enabled - block ALL other endpoints
    throw new ServiceUnavailableException({
      statusCode: 503,
      message:
        'Service is currently under maintenance. Please try again later.',
      error: 'Service Unavailable',
    });
  }

  private isMaintenanceModeEnabled(): boolean {
    const maintenanceEnv = process.env.IS_MAINTENANCE;

    if (!maintenanceEnv) {
      return false;
    }

    // Check if IS_MAINTENANCE is set to 1, TRUE, or true (case-insensitive)
    const normalizedValue = maintenanceEnv.toString().trim().toUpperCase();
    return normalizedValue === '1' || normalizedValue === 'TRUE';
  }
}
