import { Column, Entity, PrimaryColumn } from 'typeorm';

// ym:pv:goalsID	ym:pv:counterUserIDHash	ym:pv:dateTime	ym:pv:watchID	ym:pv:params

@Entity()
export class ExportedLogEntity {
  @PrimaryColumn({ type: 'text', name: 'watch_id' })
  watchId: string;

  @Column({ type: 'integer', name: 'goal_id' })
  goalId: number;

  @Column({ type: 'timestamptz', name: 'date_time' })
  watchTime: Date;

  @Column({ type: 'text', name: 'client_id' })
  clientId: string;

  @Column({ type: 'text', name: 'steam_id', nullable: true })
  steamId?: string;

  constructor(
    watchId: string,
    goalId: number,
    watchTime: Date,
    clientId: string,
    steamId: string,
  ) {
    this.watchId = watchId;
    this.goalId = goalId;
    this.watchTime = watchTime;
    this.clientId = clientId;
    this.steamId = steamId;
  }
}
