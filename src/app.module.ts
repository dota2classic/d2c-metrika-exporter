import { Module } from '@nestjs/common';
import { AppService } from './app.service';
import { ConfigModule, ConfigService } from '@nestjs/config';
import configuration from './configuration';
import { TypeOrmModule, TypeOrmModuleOptions } from '@nestjs/typeorm';
import { YandexMetrikaService } from './yandex-metrika/yandex-metrika.service';
import { ExportedLogEntity } from './model/exported-log.entity';
import { ScheduleModule } from '@nestjs/schedule';
import { LogProcessEntity } from './model/log-process.entity';

const Entities = [ExportedLogEntity, LogProcessEntity];

@Module({
  imports: [
    ScheduleModule.forRoot(),
    ConfigModule.forRoot({
      load: [configuration],
      isGlobal: true,
    }),
    TypeOrmModule.forRootAsync({
      useFactory(config: ConfigService): TypeOrmModuleOptions {
        return {
          type: 'postgres',
          database: 'postgres',
          host: config.get('postgres.host'),
          port: 5432,
          username: config.get('postgres.username'),
          password: config.get('postgres.password'),
          entities: Entities,
          synchronize: true,

          ssl: false,
        };
      },
      imports: [],
      inject: [ConfigService],
    }),
    TypeOrmModule.forFeature(Entities),
  ],
  controllers: [],
  providers: [AppService, YandexMetrikaService],
})
export class AppModule {}
