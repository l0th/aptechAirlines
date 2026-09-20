import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { FlightGeneratorService } from './flight-generator.service';

@Injectable()
export class FlightsScheduler {
  private readonly logger = new Logger(FlightsScheduler.name);

  constructor(private readonly flightGeneratorService: FlightGeneratorService) {}

  /**
   * Requirement 6: Maintain rolling 330-day operational flight horizon daily.
   * Runs once daily at 02:00 AM ICT (19:00 UTC).
   * Appends ONLY missing tail dates (e.g. Day T+329) if missing.
   * Never rewrites existing flights, deletes historical flights, or generates 15k rows on startup.
   */
  @Cron('0 2 * * *', {
    timeZone: 'Asia/Ho_Chi_Minh',
  })
  async handleDailyHorizonMaintenance(): Promise<number> {
    this.logger.log('Running daily rolling flight horizon maintenance...');
    try {
      const appended = await this.flightGeneratorService.ensureHorizonDays(330);
      if (appended > 0) {
        this.logger.log(`Daily horizon maintenance: appended ${appended} tail flights.`);
      } else {
        this.logger.log('Daily horizon maintenance: 330-day horizon is intact.');
      }
      return appended;
    } catch (err: any) {
      this.logger.error(
        `Daily horizon maintenance error: ${err?.message || err}`,
        err?.stack,
      );
      return 0;
    }
  }
}
