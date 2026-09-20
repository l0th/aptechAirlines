import { RouteCacheScheduler } from './route-cache.scheduler';
import { SCHEDULE_CRON_OPTIONS } from '@nestjs/schedule/dist/schedule.constants';
import { BadRequestException } from '@nestjs/common';

describe('RouteCacheScheduler', () => {
  let scheduler: RouteCacheScheduler;
  let mockReferenceService: any;

  beforeEach(() => {
    mockReferenceService = {
      ensureRoutesForAirport: jest.fn().mockResolvedValue({
        from_cache: true,
        stale: false,
        complete: true,
        count: 50,
        routes: [{ dep_iata: 'SGN', arr_iata: 'HAN' }],
      }),
    };
    scheduler = new RouteCacheScheduler(mockReferenceService);
  });

  it('1. handleDailyHubsPreWarm has @Cron configured with explicit Asia/Ho_Chi_Minh timeZone and 03:00 pattern', () => {
    const cronMetadata = Reflect.getMetadata(
      SCHEDULE_CRON_OPTIONS,
      RouteCacheScheduler.prototype.handleDailyHubsPreWarm,
    );

    expect(cronMetadata).toBeDefined();
    expect(cronMetadata.cronTime).toBe('0 3 * * *');
    expect(cronMetadata.timeZone).toBe('Asia/Ho_Chi_Minh');
  });

  it('2. Cache-aware: fresh & complete cache for all hubs triggers 0 HTTP refresh calls', async () => {
    // All hubs return fresh, complete cache
    mockReferenceService.ensureRoutesForAirport.mockResolvedValue({
      from_cache: true,
      stale: false,
      complete: true,
      count: 42,
      routes: [{ dep_iata: 'X', arr_iata: 'Y' }],
    });

    const res = await scheduler.handleDailyHubsPreWarm();

    // Exactly 19 hubs called
    expect(mockReferenceService.ensureRoutesForAirport).toHaveBeenCalledTimes(19);
    // Verified 7-day TTL passed
    expect(mockReferenceService.ensureRoutesForAirport).toHaveBeenCalledWith('SGN', 7 * 24 * 60 * 60 * 1000);
    expect(mockReferenceService.ensureRoutesForAirport).toHaveBeenCalledWith('HAN', 7 * 24 * 60 * 60 * 1000);
    // 0 refreshes triggered because all were fresh
    expect(res.total_refreshed).toBe(0);
    expect(res.total_processed).toBe(19);
    expect(res.rate_limited).toBe(false);
  });

  it('3. Cache-aware: stale/missing cache triggers refresh and counts updated hubs', async () => {
    // First 2 hubs are stale or fetched fresh, rest are cached
    mockReferenceService.ensureRoutesForAirport
      .mockResolvedValueOnce({
        from_cache: false,
        stale: false,
        complete: true,
        count: 60,
      })
      .mockResolvedValueOnce({
        from_cache: true,
        stale: true,
        complete: false,
        count: 30,
      })
      .mockResolvedValue({
        from_cache: true,
        stale: false,
        complete: true,
        count: 50,
      });

    const res = await scheduler.handleDailyHubsPreWarm();

    expect(res.total_refreshed).toBe(2);
    expect(res.total_processed).toBe(19);
    expect(res.rate_limited).toBe(false);
  });

  it('4. AirLabs 429 in refresh_error halts execution immediately for all remaining hubs', async () => {
    // 1st hub succeeds fresh
    // 2nd hub returns 429 rate limit in refresh_error
    mockReferenceService.ensureRoutesForAirport
      .mockResolvedValueOnce({
        from_cache: true,
        stale: false,
        complete: true,
        count: 50,
      })
      .mockResolvedValueOnce({
        from_cache: true,
        stale: true,
        complete: false,
        count: 20,
        refresh_error: 'AirLabs API Rate Limit (429): Quota exceeded or too many requests.',
      });

    const res = await scheduler.handleDailyHubsPreWarm();

    // Halted on 2nd hub! Remaining 17 hubs were NOT called
    expect(mockReferenceService.ensureRoutesForAirport).toHaveBeenCalledTimes(2);
    expect(res.rate_limited).toBe(true);
    expect(res.total_processed).toBe(2);
  });

  it('5. AirLabs 429 thrown halts execution immediately for all remaining hubs', async () => {
    mockReferenceService.ensureRoutesForAirport
      .mockResolvedValueOnce({
        from_cache: true,
        stale: false,
        complete: true,
        count: 50,
      })
      .mockRejectedValueOnce(
        new BadRequestException('AirLabs API Rate Limit (429): Quota exceeded or too many requests.'),
      );

    const res = await scheduler.handleDailyHubsPreWarm();

    // Halted on 2nd hub!
    expect(mockReferenceService.ensureRoutesForAirport).toHaveBeenCalledTimes(2);
    expect(res.rate_limited).toBe(true);
    expect(res.total_processed).toBe(2);
  });

  it('6. Catches unexpected errors per hub gracefully without unhandled rejection', async () => {
    mockReferenceService.ensureRoutesForAirport.mockRejectedValueOnce(new Error('Fatal database connection error'));

    const res = await scheduler.handleDailyHubsPreWarm();
    expect(res.total_processed).toBe(19);
    expect(res.per_hub[0].error).toContain('Fatal database connection error');
    expect(res.rate_limited).toBe(false);
  });
});
