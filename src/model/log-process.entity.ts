import { Column, Entity, PrimaryColumn } from 'typeorm';

// ym:pv:goalsID	ym:pv:counterUserIDHash	ym:pv:dateTime	ym:pv:watchID	ym:pv:params

export type LogProcessStatus =
  | 'created'
  | 'canceled'
  | 'processed'
  | 'cleaned_by_user'
  | 'cleaned_automatically_as_too_old'
  | 'processing_failed'
  | 'awaiting_retry';

@Entity()
export class LogProcessEntity {
  @PrimaryColumn({ type: 'integer', name: 'request_id' })
  requestId: number;

  @Column({ type: 'date' })
  date1: Date;

  @Column({ type: 'date' })
  date2: Date;

  @Column({ type: 'text', name: 'status' })
  status: LogProcessStatus;

  @Column({ type: 'integer', name: 'parts' })
  parts: number;

  @Column({ type: 'integer', name: 'current_processing_part', default: -1 })
  lastProcessedPart: number;
}
