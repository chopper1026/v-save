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
  it('should filter users by role and accountStatus', async () => {
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
      accountStatus: 'ACTIVE',
      page: 1,
      pageSize: 20,
    } as any);

    expect(qb.andWhere).toHaveBeenCalledWith('user.role = :role', {
      role: 'USER',
    });
    expect(qb.andWhere).toHaveBeenCalledWith(
      'user.accountStatus = :accountStatus',
      {
        accountStatus: 'ACTIVE',
      },
    );
  });

  it('should ignore deprecated membership filters when querying users', async () => {
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
      membershipLevel: 'VIP',
      page: 1,
      pageSize: 20,
    } as any);

    expect(qb.andWhere).not.toHaveBeenCalledWith(
      'user.membershipLevel = :membershipLevel',
      { membershipLevel: 'VIP' },
    );
  });
});
