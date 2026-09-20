import { SCHEDULE_CRON_OPTIONS } from '@nestjs/schedule/dist/schedule.constants';
import { FlightsScheduler } from './flights.scheduler';

describe('FlightsScheduler - Timezone & Maintenance Verification', () => {
  it('1. handleDailyHorizonMaintenance has @Cron configured with explicit Asia/Ho_Chi_Minh timeZone', () => {
    const meta = Reflect.getMetadata(
      SCHEDULE_CRON_OPTIONS,
      FlightsScheduler.prototype.handleDailyHorizonMaintenance,
    );
    expect(meta).toBeDefined();
    expect(meta.cronTime).toBe('0 2 * * *');
    expect(meta.timeZone).toBe('Asia/Ho_Chi_Minh');
  });

  it('2. handleDailyHorizonMaintenance delegates to flightGeneratorService.ensureHorizonDays(330)', async () => {
    const mockFlightGen = {
      ensureHorizonDays: jest.fn().mockResolvedValue(1),
    };
    const scheduler = new FlightsScheduler(mockFlightGen as any);
    const result = await scheduler.handleDailyHorizonMaintenance();
    expect(mockFlightGen.ensureHorizonDays).toHaveBeenCalledWith(330);
    expect(result).toBe(1);
  });
});
