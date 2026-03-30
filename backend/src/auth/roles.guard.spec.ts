import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RolesGuard } from './roles.guard';
import { Roles } from './roles.decorator';

describe('RolesGuard', () => {
  @Roles('SUPER_ADMIN')
  class ProtectedController {
    protectedRoute() {}

    publicRoute() {}
  }

  const createContext = (
    handler: keyof ProtectedController,
    user?: { role?: string },
  ): ExecutionContext =>
    ({
      getHandler: jest.fn(() => ProtectedController.prototype[handler]),
      getClass: jest.fn(() => ProtectedController),
      switchToHttp: jest.fn(() => ({
        getRequest: () => ({ user }),
      })),
    }) as unknown as ExecutionContext;

  it('allows public routes even when class roles are present', () => {
    const reflector = {
      getAllAndOverride: jest.fn(() => true),
    } as unknown as Reflector;
    const guard = new RolesGuard(reflector);

    expect(guard.canActivate(createContext('publicRoute'))).toBe(true);
  });

  it('keeps protected routes role-checked', () => {
    const reflector = {
      getAllAndOverride: jest.fn(() => false),
    } as unknown as Reflector;
    const guard = new RolesGuard(reflector);

    expect(
      guard.canActivate(createContext('protectedRoute', { role: 'SUPER_ADMIN' })),
    ).toBe(true);
    expect(guard.canActivate(createContext('protectedRoute'))).toBe(false);
  });
});
