import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserRole } from '../users/user.entity';
import { IS_PUBLIC_KEY } from './public.decorator';
import { ROLES_KEY } from './roles.decorator';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const requiredRoles = this.getRequiredRoles(context);
    if (requiredRoles.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const user = request?.user as { role?: UserRole } | undefined;
    const currentRole = user?.role;
    if (!currentRole) {
      return false;
    }

    return requiredRoles.includes(currentRole);
  }

  private getRequiredRoles(context: ExecutionContext): UserRole[] {
    const classRoles =
      (Reflect.getMetadata(ROLES_KEY, context.getClass()) as UserRole[]) || [];
    const handlerRoles =
      (Reflect.getMetadata(ROLES_KEY, context.getHandler()) as UserRole[]) || [];

    return [...classRoles, ...handlerRoles];
  }
}
