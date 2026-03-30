import { AdminUsersService } from './admin-users.service';

type MockQb = {
  andWhere: jest.Mock;
  orderBy: jest.Mock;
  addOrderBy: jest.Mock;
  skip: jest.Mock;
  take: jest.Mock;
  getManyAndCount: jest.Mock;
};

const createMockQueryBuilder = (): MockQb => {
  const qb: Partial<MockQb> = {};
  qb.andWhere = jest.fn().mockReturnValue(qb);
  qb.orderBy = jest.fn().mockReturnValue(qb);
  qb.addOrderBy = jest.fn().mockReturnValue(qb);
  qb.skip = jest.fn().mockReturnValue(qb);
  qb.take = jest.fn().mockReturnValue(qb);
  qb.getManyAndCount = jest.fn().mockResolvedValue([[], 0]);
  return qb as MockQb;
};

describe('AdminUsersService queryUsers filters', () => {
  it('should filter users by role and membershipLevel', async () => {
    const qb = createMockQueryBuilder();
    const userRepository = {
      createQueryBuilder: jest.fn().mockReturnValue(qb),
    };

    const service = new AdminUsersService(
      userRepository as any,
      {} as any,
      {} as any,
    );

    await service.queryUsers({
      role: 'USER',
      membershipLevel: 'VIP',
      page: 1,
      pageSize: 20,
    } as any);

    expect(qb.andWhere).toHaveBeenCalledWith('user.role = :role', {
      role: 'USER',
    });
    expect(qb.andWhere).toHaveBeenCalledWith(
      'user.membershipLevel = :membershipLevel',
      {
        membershipLevel: 'VIP',
      },
    );
  });

  it('should filter free users by membershipLevel only', async () => {
    const qb = createMockQueryBuilder();
    const userRepository = {
      createQueryBuilder: jest.fn().mockReturnValue(qb),
    };

    const service = new AdminUsersService(
      userRepository as any,
      {} as any,
      {} as any,
    );

    await service.queryUsers({
      membershipLevel: 'FREE',
      page: 1,
      pageSize: 20,
    } as any);

    expect(qb.andWhere).toHaveBeenCalledWith(
      'user.membershipLevel = :membershipLevel',
      {
        membershipLevel: 'FREE',
      },
    );
  });
});
