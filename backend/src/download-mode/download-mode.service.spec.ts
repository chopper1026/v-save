import { BadRequestException } from '@nestjs/common';
import { DownloadModeService } from './download-mode.service';
import {
  DownloadClientType,
  DownloadModePlatform,
  DownloadModeSource,
  DownloadPolicyMode,
} from './download-mode.types';

const createRepository = () => ({
  find: jest.fn(),
  findOne: jest.fn(),
  create: jest.fn((input) => input),
  save: jest.fn(async (input) => ({
    id: 'cfg-1',
    updatedAt: new Date('2026-03-19T00:00:00.000Z'),
    createdAt: new Date('2026-03-19T00:00:00.000Z'),
    ...input,
  })),
});

describe('DownloadModeService', () => {
  it('resolves douyin WEB default mode to availability-first strategy', async () => {
    const repository = createRepository();
    repository.findOne.mockResolvedValue(null);
    const service = new DownloadModeService(repository as any);

    const resolved = await service.resolveGetUrlPolicy({
      clientType: DownloadClientType.WEB,
      videoInfo: {
        title: 'douyin',
        cover: '',
        duration: '00:10',
        platform: DownloadModePlatform.DOUYIN,
        videoUrl: 'https://example.com/video.mp4',
      },
      format: 'mp4' as any,
      quality: '1080p',
    });

    expect(resolved.mode).toBe(DownloadPolicyMode.AVAILABILITY_FIRST);
    expect(resolved.source).toBe(DownloadModeSource.DEFAULT);
    expect(resolved.probeMode).toBe('smart');
    expect(resolved.allowWatermarkFallback).toBe(true);
  });

  it('applies per-request douyin overrides on top of configured mode', async () => {
    const repository = createRepository();
    repository.findOne.mockResolvedValue({
      id: 'cfg-1',
      platform: DownloadModePlatform.DOUYIN,
      clientType: DownloadClientType.MOBILE,
      mode: DownloadPolicyMode.QUALITY_FIRST,
    });
    const service = new DownloadModeService(repository as any);

    const resolved = await service.resolveGetUrlPolicy({
      clientType: DownloadClientType.MOBILE,
      videoInfo: {
        title: 'douyin',
        cover: '',
        duration: '00:10',
        platform: DownloadModePlatform.DOUYIN,
        videoUrl: 'https://example.com/video.mp4',
      },
      format: 'mp4' as any,
      quality: '1080p',
      overrides: {
        allowWatermarkFallback: true,
        probeMode: 'fast' as any,
      },
    });

    expect(resolved.mode).toBe(DownloadPolicyMode.QUALITY_FIRST);
    expect(resolved.source).toBe(DownloadModeSource.DATABASE);
    expect(resolved.probeMode).toBe('fast');
    expect(resolved.allowWatermarkFallback).toBe(true);
  });

  it('resolves bilibili MOBILE default mode with smart compatibility enabled when default codec is not AVC', async () => {
    const repository = createRepository();
    repository.findOne.mockResolvedValue(null);
    const service = new DownloadModeService(repository as any);

    const resolved = await service.resolveGetUrlPolicy({
      clientType: DownloadClientType.MOBILE,
      videoInfo: {
        title: 'bilibili',
        cover: '',
        duration: '00:10',
        platform: DownloadModePlatform.BILIBILI,
        videoUrl: 'https://example.com/default.m4s',
        downloadOptions: {
          video: {
            '1080p': 'https://example.com/hevc-default.m4s',
          },
          videoCandidates: {
            '1080p': [
              {
                url: 'https://example.com/hevc-default.m4s',
                codecid: 12,
                width: 1920,
                height: 1080,
              },
              {
                url: 'https://example.com/avc-ios.m4s',
                codecid: 7,
                width: 1920,
                height: 1080,
              },
            ],
          },
        },
      },
      format: 'mp4' as any,
      quality: '1080p',
    });

    expect(resolved.mode).toBe(DownloadPolicyMode.COMPATIBILITY_FIRST);
    expect(resolved.iosCompatible).toBe(true);
  });

  it('does not force bilibili smart compatibility when the default candidate is already AVC', async () => {
    const repository = createRepository();
    repository.findOne.mockResolvedValue({
      id: 'cfg-1',
      platform: DownloadModePlatform.BILIBILI,
      clientType: DownloadClientType.MOBILE,
      mode: DownloadPolicyMode.COMPATIBILITY_FIRST,
    });
    const service = new DownloadModeService(repository as any);

    const resolved = await service.resolveGetUrlPolicy({
      clientType: DownloadClientType.MOBILE,
      videoInfo: {
        title: 'bilibili',
        cover: '',
        duration: '00:10',
        platform: DownloadModePlatform.BILIBILI,
        videoUrl: 'https://example.com/default.m4s',
        downloadOptions: {
          video: {
            '1080p': 'https://example.com/avc-default.m4s',
          },
          videoCandidates: {
            '1080p': [
              {
                url: 'https://example.com/avc-default.m4s',
                codecid: 7,
                width: 1920,
                height: 1080,
              },
            ],
          },
        },
      },
      format: 'mp4' as any,
      quality: '1080p',
    });

    expect(resolved.iosCompatible).toBe(false);
  });

  it('lists editable and readonly platform configs with default sources when database rows are absent', async () => {
    const repository = createRepository();
    repository.find.mockResolvedValue([]);
    const service = new DownloadModeService(repository as any);

    const configs = await service.getConfigs();
    const douyin = configs.find((item) => item.platform === DownloadModePlatform.DOUYIN);
    const youtube = configs.find((item) => item.platform === DownloadModePlatform.YOUTUBE);

    expect(douyin?.editable).toBe(true);
    expect(douyin?.clients.WEB.mode).toBe(DownloadPolicyMode.AVAILABILITY_FIRST);
    expect(douyin?.clients.WEB.source).toBe(DownloadModeSource.DEFAULT);
    expect(youtube?.editable).toBe(false);
    expect(youtube?.clients.WEB.mode).toBeNull();
    expect(youtube?.clients.WEB.source).toBe(DownloadModeSource.READONLY);
  });

  it('rejects updates for readonly platforms', async () => {
    const repository = createRepository();
    const service = new DownloadModeService(repository as any);

    await expect(
      service.updateModeConfig({
        platform: DownloadModePlatform.YOUTUBE,
        clientType: DownloadClientType.WEB,
        mode: DownloadPolicyMode.QUALITY_FIRST,
        updatedByUserId: 'admin-1',
        updatedByEmail: 'admin@example.com',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
