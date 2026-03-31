import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SystemSetting } from './system-setting.entity';

const REGISTRATION_ENABLED_KEY = 'registration_enabled';

export interface SystemSettingsSnapshot {
  registrationEnabled: boolean;
}

export interface UpdateSystemSettingsInput {
  registrationEnabled: boolean;
}

@Injectable()
export class SystemSettingsService {
  constructor(
    @InjectRepository(SystemSetting)
    private readonly systemSettingsRepository: Repository<SystemSetting>,
  ) {}

  async getPublicSettings(): Promise<SystemSettingsSnapshot> {
    const settings = await this.systemSettingsRepository.find();
    return this.toSnapshot(settings);
  }

  async getAdminSettings(): Promise<SystemSettingsSnapshot> {
    return this.getPublicSettings();
  }

  async isRegistrationEnabled(): Promise<boolean> {
    const settings = await this.getPublicSettings();
    return settings.registrationEnabled;
  }

  async updateSettings(input: UpdateSystemSettingsInput): Promise<SystemSettingsSnapshot> {
    const settings = await this.systemSettingsRepository.find();
    const current = settings.find((item) => item.key === REGISTRATION_ENABLED_KEY);

    if (current) {
      current.value = input.registrationEnabled ? 'true' : 'false';
      await this.systemSettingsRepository.save(current);
    } else {
      await this.systemSettingsRepository.save(
        this.systemSettingsRepository.create({
          key: REGISTRATION_ENABLED_KEY,
          value: input.registrationEnabled ? 'true' : 'false',
        }),
      );
    }

    return {
      registrationEnabled: input.registrationEnabled,
    };
  }

  private toSnapshot(settings: SystemSetting[]): SystemSettingsSnapshot {
    const registrationEnabledRaw = settings.find(
      (item) => item.key === REGISTRATION_ENABLED_KEY,
    )?.value;

    return {
      registrationEnabled: String(registrationEnabledRaw || '').trim().toLowerCase() === 'true',
    };
  }
}
