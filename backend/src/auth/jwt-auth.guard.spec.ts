jest.mock('@nestjs/passport', () => ({
  AuthGuard: () =>
    class {
      canActivate() {
        return 'delegated';
      }
    },
}));

import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtAuthGuard } from './jwt-auth.guard';

describe('JwtAuthGuard', () => {
  const createContext = (): ExecutionContext =>
    ({
      getHandler: jest.fn(() => 'handler'),
      getClass: jest.fn(() => 'class'),
    }) as unknown as ExecutionContext;

  it('allows requests marked public', () => {
    const reflector = {
      getAllAndOverride: jest.fn(() => true),
    } as unknown as Reflector;
    const guard = new JwtAuthGuard(reflector);

    expect(guard.canActivate(createContext())).toBe(true);
  });

  it('delegates to the jwt strategy for protected routes', () => {
    const reflector = {
      getAllAndOverride: jest.fn(() => false),
    } as unknown as Reflector;
    const guard = new JwtAuthGuard(reflector);

    expect(guard.canActivate(createContext())).toBe('delegated');
  });
});
