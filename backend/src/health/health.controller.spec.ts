import { HealthController } from './health.controller';

describe('HealthController', () => {
  it('returns an ok payload for container health checks', () => {
    const controller = new HealthController();

    expect(controller.getHealth()).toEqual({
      success: true,
      data: {
        status: 'ok',
      },
    });
  });
});
