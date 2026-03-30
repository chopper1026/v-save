import { BadRequestException } from '@nestjs/common';
import { createGlobalValidationPipe } from './validation';
import { LoginDto } from '../auth/dto/login.dto';
import { QueryAdminUsersDto } from '../admin/dto/query-admin-users.dto';
import { QueryDownloadHistoryDto } from '../download/dto/download.dto';

describe('createGlobalValidationPipe', () => {
  it('returns compatible validation payload for malformed body input', async () => {
    const pipe = createGlobalValidationPipe();

    await expect(
      pipe.transform(
        {
          email: 'bad-email',
          password: '123',
        },
        {
          type: 'body',
          metatype: LoginDto,
        } as any,
      ),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        code: 'VALIDATION_ERROR',
        message: '请求参数校验失败',
        errors: expect.arrayContaining([
          expect.objectContaining({
            field: 'email',
          }),
          expect.objectContaining({
            field: 'password',
          }),
        ]),
      }),
    });
  });

  it('rejects invalid numeric query values with compatible error payload', async () => {
    const pipe = createGlobalValidationPipe();

    await expect(
      pipe.transform(
        {
          page: 'abc',
        },
        {
          type: 'query',
          metatype: QueryAdminUsersDto,
        } as any,
      ),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        code: 'VALIDATION_ERROR',
        errors: expect.arrayContaining([
          expect.objectContaining({
            field: 'page',
          }),
        ]),
      }),
    });
  });

  it('keeps clamp semantics for paged admin query params', async () => {
    const pipe = createGlobalValidationPipe();

    const transformed = await pipe.transform(
      {
        page: '-5',
        pageSize: '999',
      },
      {
        type: 'query',
        metatype: QueryAdminUsersDto,
      } as any,
    );

    expect(transformed).toBeInstanceOf(QueryAdminUsersDto);
    expect(transformed.page).toBe(1);
    expect(transformed.pageSize).toBe(100);
  });

  it('keeps clamp semantics for download history query params', async () => {
    const pipe = createGlobalValidationPipe();

    const transformed = await pipe.transform(
      {
        limit: '999',
        offset: '-10',
      },
      {
        type: 'query',
        metatype: QueryDownloadHistoryDto,
      } as any,
    );

    expect(transformed).toBeInstanceOf(QueryDownloadHistoryDto);
    expect(transformed.limit).toBe(50);
    expect(transformed.offset).toBe(0);
  });
});
