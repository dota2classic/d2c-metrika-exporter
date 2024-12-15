import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApisauceInstance, create } from 'apisauce';
import { ExportedLogEntity } from '../model/exported-log.entity';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Cron, CronExpression } from '@nestjs/schedule';
import {
  LogProcessEntity,
  LogProcessStatus,
} from '../model/log-process.entity';

interface RawParsedLogEntry {
  'ym:pv:goalsID': number[];
  'ym:pv:counterUserIDHash': string;
  'ym:pv:dateTime': Date;
  'ym:pv:watchID': string;
  'ym:pv:params': { UserID?: string };
}

interface LogRequest {
  request_id: number;
  date1: string;
  date2: string;
  status: LogProcessStatus;
  parts?: any[];
}
@Injectable()
export class YandexMetrikaService {
  private logger = new Logger(YandexMetrikaService.name);

  private api: ApisauceInstance;
  constructor(
    private readonly config: ConfigService,
    @InjectRepository(ExportedLogEntity)
    private readonly exportedLogEntityRepository: Repository<ExportedLogEntity>,
    @InjectRepository(LogProcessEntity)
    private readonly logProcessEntityRepository: Repository<LogProcessEntity>,
  ) {
    this.api = create({
      baseURL: `https://api-metrika.yandex.net/management/v1/counter/${this.config.get('ym.counter')}`,
      headers: {
        Authorization: `OAuth ${this.config.get('ym.token')}`,
      },
    });

    this.fetchLogs();
  }

  @Cron(CronExpression.EVERY_4_HOURS)
  private async createLogProcess() {
    this.logger.log('Cron: trying createLogProcess');
    const dateTo = new Date(); // Today - 1
    dateTo.setDate(new Date().getDate() - 1);

    const dateFrom = new Date(); // Today - 2
    dateFrom.setDate(dateTo.getDate() - 1);

    const params = {
      date1: dateFrom.toISOString().substring(0, 10),
      date2: dateTo.toISOString().substring(0, 10),
      fields:
        'ym:pv:goalsID,ym:pv:counterUserIDHash,ym:pv:dateTime,ym:pv:watchID,ym:pv:params',
      source: 'hits',
    };

    // Is there existing?

    const doesExist = await this.logProcessEntityRepository.exists({
      where: {
        date1: new Date(params.date1),
        date2: new Date(params.date2),
      },
    });
    if (doesExist) {
      this.logger.log('Already processing date range', {
        date1: params.date1,
        date2: params.date2,
      });
      return;
    }

    // date1=2024-10-01&date2=2024-12-13&fields=ym:pv:goalsID,ym:pv:counterUserIDHash,ym:pv:dateTime,ym:pv:watchID,ym:pv:params&source=hits
    const res = await this.api.post<{ log_request: LogRequest }>(
      `/logrequests`,
      null,
      {
        params,
      },
    );

    this.logger.log('POST to create new log request', params);
    if (res.ok) {
      this.logger.log('Success: saving log process entity with id', {
        id: res.data.log_request.request_id,
      });
      const lpe = this.logProcessFromLogRequest(res.data.log_request);
      await this.logProcessEntityRepository.save(lpe);
      this.logger.log(`Saved log process entity`, {
        request_id: lpe.requestId,
      });
    } else {
      this.logger.error('Issue creating log request');
      this.logger.error(res.data);
    }
  }

  @Cron(CronExpression.EVERY_MINUTE)
  public async doProcessing() {
    await this.logProcessEntityRepository
      .find({ where: { status: 'processed' } })
      .then((t) => t[0])
      .then((it) => it && this.processLogProcess(it));
  }

  @Cron(CronExpression.EVERY_5_SECONDS)
  public async updateLogProcessStatus() {
    const allLogs = await this.logProcessEntityRepository.find();
    const updates = await Promise.all(
      allLogs.map(async (log) => {
        const res = await this.api.get<{ log_request: LogRequest }>(
          `/logrequest/${log.requestId}`,
        );
        if (res.ok) {
          log.status = res.data.log_request.status;
          log.parts = res.data.log_request.parts
            ? res.data.log_request.parts.length
            : 0;
        }

        return log;
      }),
    );
    await this.logProcessEntityRepository.save(updates);
  }

  private async fetchLogs() {
    const requests = await this.api.get<{ requests: LogRequest[] }>(
      `/logrequests`,
    );
    if (requests.ok) {
      this.logger.log(`Fetched ${requests.data.requests.length} log requests`);
      await this.logProcessEntityRepository.upsert(
        requests.data.requests.map((req) => {
          return this.logProcessFromLogRequest(req);
        }),
        ['requestId'],
      );
    } else {
      this.logger.warn('There was an issue fetching logs', requests.data);
    }
  }

  private cleanLog(requestId: number): Promise<LogRequest> {
    return this.api
      .post<
        { log_request: LogRequest },
        { log_request: LogRequest }
      >(`/logrequest/${requestId}/clean`)
      .then((it) => it.data!.log_request);
  }

  private async processLogProcess(process: LogProcessEntity) {
    if (process.parts === 0 || process.status !== 'processed') {
      this.logger.log(`0 parts: status is not ready: ${process.status}`);
      return;
    }
    if (process.lastProcessedPart === process.parts - 1) {
      this.logger.log('LogProcess is exported. Deleting and cleaning up', {
        request_id: process.requestId,
      });
      const res = await this.cleanLog(process.requestId);
      process.status = res.status;
      await this.logProcessEntityRepository.save(process);
      return;
    }

    const newPart = process.lastProcessedPart + 1;
    const processed = await this.processLogPart(process.requestId, newPart);
    if (processed) {
      this.logger.log(`Success processing log part`, {
        request_id: process.requestId,
        part: newPart,
      });
      process.lastProcessedPart = newPart;
      await this.logProcessEntityRepository.save(process);
      return;
    } else {
      this.logger.log(
        `Couldn't process log request ${process.requestId} ${newPart}`,
      );
    }
  }

  private async processLogPart(requestId: number, part: number) {
    try {
      const tsv = await this.fetchLogPart(requestId, part);
      const parsedEntries = this.parseTSV(tsv);
      await this.processParsedEntries(parsedEntries);
      return true;
    } catch (e) {
      this.logger.log(`There was an issue procesing log part`, {
        request_id: requestId,
        part: part,
      });
      return false;
    }
  }

  private async fetchLogPart(requestId: number, part: number) {
    const some = await this.api.get(
      `/logrequest/${requestId}/part/${part}/download`,
    );
    return some.data.toString();
  }

  private parseTSV(content: string): RawParsedLogEntry[] {
    const rows = content.split('\n');
    const columns = rows[0].split('\t');
    const columnCount = columns.length;

    let cursor: number = 0;

    const columnBatch = [];
    const entries: RawParsedLogEntry[] = [];

    const dataContent = content.substring(content.indexOf('\n') + 1);

    while (true) {
      let startIndex = dataContent.indexOf('\t', cursor);
      if (startIndex === -1) break;
      const col = dataContent.substring(cursor, startIndex);
      if (col.includes('\n') && columnBatch.length > 2) {
        // stupid fucking tsv
        // we overflow, so need to fill with trash
        startIndex = dataContent.indexOf('\n', cursor);
        columnBatch.push(dataContent.substring(cursor, startIndex));
        if (columnBatch.length === 4) columnBatch.push('{}');
        cursor = startIndex + 1;
      } else {
        columnBatch.push(col);
        cursor = startIndex + 1;
      }

      if (columnBatch.length === columnCount) {
        const obj = {};
        for (let i = 0; i < columns.length; i++) {
          obj[columns[i]] = columnBatch[i];
        }
        obj['ym:pv:dateTime'] = obj['ym:pv:dateTime'].replaceAll(': ', ':');
        obj['ym:pv:goalsID'] = JSON.parse(obj['ym:pv:goalsID']);
        obj['ym:pv:watchID'] = obj['ym:pv:watchID'];
        obj['ym:pv:dateTime'] = new Date(obj['ym:pv:dateTime']);
        obj['ym:pv:counterUserIDHash'] = obj['ym:pv:counterUserIDHash'];
        try {
          let a = obj['ym:pv:params'];
          a = a.replaceAll('""', '"');
          a = a.substring(1, a.length - 1);
          a = JSON.parse(a);
          obj['ym:pv:params'] = a['__ymu'];
        } catch (e) {
          obj['ym:pv:params'] = {};
        }
        entries.push(obj as RawParsedLogEntry);
        columnBatch.length = 0;
      }
    }

    entries.sort(
      (a, b) => a['ym:pv:dateTime'].getTime() - b['ym:pv:dateTime'].getTime(),
    );

    return entries;
  }

  private async processParsedEntries(entries: RawParsedLogEntry[]) {
    const lookupTable = new Map<string, string>();

    const inserts: ExportedLogEntity[] = [];

    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      let steamId = entry['ym:pv:params'].UserID;
      const clientHash = entry['ym:pv:counterUserIDHash'];
      // Update SteamID lookup
      if (steamId) {
        lookupTable.set(clientHash, steamId);
      } else {
        steamId = lookupTable.get(clientHash);
      }

      // Create events in DB
      for (const goal of entry['ym:pv:goalsID']) {
        const logEntry = new ExportedLogEntity(
          entry['ym:pv:watchID'],
          goal,
          entry['ym:pv:dateTime'],
          entry['ym:pv:counterUserIDHash'],
          steamId || undefined,
        );

        inserts.push(logEntry);
      }
    }

    this.logger.log('Total upserts for part', { count: inserts.length });
    await this.exportedLogEntityRepository.upsert(inserts, ['watchId']);
  }

  private logProcessFromLogRequest(req: LogRequest): LogProcessEntity {
    const lpe = new LogProcessEntity();
    lpe.requestId = req.request_id;
    lpe.date1 = new Date(req.date1);
    lpe.date2 = new Date(req.date2);
    lpe.parts = !!req.parts ? req.parts.length : 0;
    lpe.status = req.status;
    return lpe;
  }
}
