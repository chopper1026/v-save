import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { UsersModule } from './users/users.module';
import { AuthModule } from './auth/auth.module';
import { ParsersModule } from './parsers/parsers.module';
import { DownloadModule } from './download/download.module';
import { ProxyModule } from './proxy/proxy.module';
import { BilibiliAuthModule } from './bilibili-auth/bilibili-auth.module';
import { DouyinAuthModule } from './douyin-auth/douyin-auth.module';
import { NotificationsModule } from './notifications/notifications.module';
import { AuthHealthModule } from './auth-health/auth-health.module';
import { AdminUsersModule } from './admin/admin-users.module';
import { RuntimeMonitorModule } from './runtime-monitor/runtime-monitor.module';
import { PaymentsModule } from './payments/payments.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        return {
          type: 'mysql' as const,
          host: configService.get<string>('DATABASE_HOST', '127.0.0.1'),
          port: parseInt(configService.get<string>('DATABASE_PORT', '3306'), 10),
          username: configService.get<string>('DATABASE_USER', 'root'),
          password: configService.get<string>('DATABASE_PASSWORD', ''),
          database: configService.get<string>('DATABASE_NAME', 'video_downloader'),
          entities: [__dirname + '/**/*.entity{.ts,.js}'],
          synchronize: configService.get<string>('DB_SYNCHRONIZE', 'true') === 'true',
        };
      },
    }),
    RuntimeMonitorModule,
    UsersModule,
    AuthModule,
    BilibiliAuthModule,
    DouyinAuthModule,
    ParsersModule,
    DownloadModule,
    ProxyModule,
    NotificationsModule,
    AuthHealthModule,
    AdminUsersModule,
    PaymentsModule,
  ],
  controllers: [],
  providers: [],
})
export class AppModule {}
