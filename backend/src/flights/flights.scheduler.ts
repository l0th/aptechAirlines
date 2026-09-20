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
    this.logger.log('Running daily AirLabs commercial flight horizon maintenance...');
    try {
      const report = await this.flightGeneratorService.ensureActiveCommercialHorizons(330);
      if (report.inserted_count > 0) {
        this.logger.log(
          `Daily AirLabs commercial flight horizon maintenance: appended ${report.inserted_count} tail flights across ${report.successful_templates} active templates.`,
        );
      } else {
        this.logger.log(
          `Daily AirLabs commercial flight horizon maintenance: 330-day horizon is intact across ${report.successful_templates} active templates.`,
        );
      }
      if (report.failed_templates > 0) {
        this.logger.warn(
          `Daily AirLabs commercial flight horizon maintenance encountered ${report.failed_templates} template failure(s).`,
        );
      }
      return report.inserted_count;
    } catch (err: any) {
      this.logger.error(
        `Daily AirLabs commercial flight horizon maintenance error: ${err?.message || err}`,
        err?.stack,
      );
      return 0;
    }
  }
}
