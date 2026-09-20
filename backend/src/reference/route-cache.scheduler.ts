import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ReferenceService } from './reference.service';

@Injectable()
export class RouteCacheScheduler {
  private readonly logger = new Logger(RouteCacheScheduler.name);

  constructor(private readonly referenceService: ReferenceService) {}

  /**
   * Pre-warm and refresh route cache for key international and domestic hubs.
   * Runs daily at 03:00 AM ICT (Asia/Ho_Chi_Minh).
   * Cache-aware execution:
   * - Hubs with fresh, complete cache (TTL 7 days) trigger 0 HTTP calls.
   * - Stale or incomplete or missing hubs trigger refresh/fetch via ensureRoutesForAirport.
   * - AirLabs 429 rate limits safely halt execution immediately for all remaining hubs.
   */
  @Cron('0 3 * * *', {
    timeZone: 'Asia/Ho_Chi_Minh',
  })
  async handleDailyHubsPreWarm(): Promise<{
    total_processed: number;
    total_refreshed: number;
    total_updated?: number;
    per_hub: any[];
    rate_limited: boolean;
    error?: string;
  }> {
    this.logger.log('Starting cache-aware route pre-warm for key hubs...');
    const hubs = [
      'SGN', 'HAN', 'DAD', 'SIN', 'BKK', 'KUL', 'HKG',
      'NRT', 'ICN', 'TPE', 'DXB', 'DOH', 'LHR', 'CDG',
      'FRA', 'JFK', 'LAX', 'SYD', 'MEL',
    ];

    const perHub: any[] = [];
    let totalRefreshed = 0;
    let rateLimited = false;
    const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

    try {
      for (const hub of hubs) {
        try {
          const res = await this.referenceService.ensureRoutesForAirport(hub, SEVEN_DAYS_MS);

          const is429 =
            res?.refresh_error &&
            (res.refresh_error.includes('429') ||
              res.refresh_error.toLowerCase().includes('rate limit') ||
              res.refresh_error.toLowerCase().includes('quota'));

          perHub.push({
            hub,
            from_cache: res.from_cache,
            stale: res.stale,
            complete: res.complete,
            routes_count: res.count,
            refresh_error: res.refresh_error,
          });

          if (!res.from_cache || res.stale) {
            totalRefreshed++;
          }

          if (is429) {
            rateLimited = true;
            this.logger.warn(`RouteCacheScheduler halted early on hub ${hub} due to AirLabs 429 rate limit.`);
            break;
          }
        } catch (err: any) {
          const is429 =
            err.status === 429 ||
            err.message?.includes('429') ||
            err.message?.toLowerCase().includes('rate limit') ||
            err.message?.toLowerCase().includes('quota');

          perHub.push({
            hub,
            error: err.message,
          });

          if (is429) {
            rateLimited = true;
            this.logger.warn(`RouteCacheScheduler halted early on hub ${hub} due to AirLabs 429 rate limit.`);
            break;
          }
        }
      }

      if (rateLimited) {
        this.logger.warn(`Route cache pre-warm halted early due to AirLabs rate limit. Processed: ${perHub.length}/${hubs.length}`);
      } else {
        this.logger.log(`Route cache pre-warm completed. Processed: ${perHub.length}, Refreshed: ${totalRefreshed}`);
      }

      return {
        total_processed: perHub.length,
        total_refreshed: totalRefreshed,
        total_updated: totalRefreshed,
        per_hub: perHub,
        rate_limited: rateLimited,
      };
    } catch (err: any) {
      this.logger.error(`Error during route cache pre-warm: ${err?.message || err}`, err?.stack);
      return {
        total_processed: perHub.length,
        total_refreshed: totalRefreshed,
        total_updated: totalRefreshed,
        per_hub: perHub,
        rate_limited: rateLimited,
        error: err?.message || String(err),
      };
    }
  }
}
