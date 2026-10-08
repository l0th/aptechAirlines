import { BadRequestException, NotFoundException } from '@nestjs/common';
import { MailService } from './mail.service';
import { MailAdminService } from './mail-admin.service';
import { MailController } from './mail.controller';
import { MAIL_TEMPLATES } from './mail-templates';
import { ROLES_KEY } from '../auth/roles.decorator';
import { UserRole } from '../users/users.schema';

function chain(value: any) {
  const q: any = {};
  ['find', 'sort', 'skip', 'limit', 'lean'].forEach((m) => (q[m] = jest.fn().mockReturnValue(q)));
  q.exec = jest.fn().mockResolvedValue(value);
  return q;
}

describe('Mail templates registry', () => {
  it('every template renders sample data on the shared navy layout', () => {
    const keys = MAIL_TEMPLATES.map((t) => t.key);
    expect(keys).toEqual(
      expect.arrayContaining([
        'BLOCKED_REMINDER',
        'UPCOMING_TRIP',
        'CANCELLATION',
        'EXPIRED_HOLD',
        'HOLD_CANCELLED_BY_CUSTOMER',
        'FLIGHT_DISRUPTION',
        'PASSWORD_RESET',
      ]),
    );
    for (const tpl of MAIL_TEMPLATES) {
      const { subject, html } = tpl.render(tpl.sampleData);
      expect(subject.length).toBeGreaterThan(0);
      expect(html).toContain('#071b2e');
      expect(html).toContain('APTECH AIRLINES');
      expect(tpl.name && tpl.description && tpl.trigger).toBeTruthy();
    }
  });
});

describe('MailService logging & toggles', () => {
  const originalEnv = process.env;
  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.SMTP_HOST;
  });
  afterAll(() => (process.env = originalEnv));

  it('records DEV_FALLBACK log with template key and booking reference', async () => {
    const logModel: any = { create: jest.fn().mockResolvedValue({}) };
    const settingModel: any = { findOne: jest.fn().mockReturnValue(chain(null)) };
    const service = new MailService(logModel, settingModel);
    const ok = await service.sendHoldCancelledByCustomerEmail({
      toEmail: 'a@example.com',
      passengerName: 'A',
      bookingReference: 'PNR1',
      blockingNumber: 'BLK1',
      cancellationNumber: 'CAN1',
    });
    expect(ok).toBe(true);
    expect(logModel.create).toHaveBeenCalledWith(
      expect.objectContaining({
        template_key: 'HOLD_CANCELLED_BY_CUSTOMER',
        to: 'a@example.com',
        status: 'DEV_FALLBACK',
        booking_reference: 'PNR1',
      }),
    );
  });

  it('records FAILED log after retries are exhausted', async () => {
    process.env.SMTP_HOST = 'smtp.test.local';
    process.env.NODE_ENV = 'test';
    const logModel: any = { create: jest.fn().mockResolvedValue({}) };
    const service = new MailService(logModel);
    (service as any).transporter = { sendMail: jest.fn().mockRejectedValue(new Error('boom')) };
    expect(await service.sendMail('x@example.com', 'S', '<p/>')).toBe(false);
    expect(logModel.create).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'FAILED', error: 'boom', template_key: 'CUSTOM' }),
    );
  });

  it('skips sending when the template is disabled', async () => {
    const logModel: any = { create: jest.fn() };
    const settingModel: any = { findOne: jest.fn().mockReturnValue(chain({ enabled: false })) };
    const service = new MailService(logModel, settingModel);
    const spy = jest.spyOn(service, 'sendMail');
    expect(await service.sendBlockedTicketReminder('a@example.com', '<p/>', 'PNR')).toBe(true);
    expect(spy).not.toHaveBeenCalled();
    expect(logModel.create).not.toHaveBeenCalled();
  });

  it('a log write failure never breaks delivery', async () => {
    const logModel: any = { create: jest.fn().mockRejectedValue(new Error('db down')) };
    const service = new MailService(logModel);
    expect(await service.sendMail('a@example.com', 'S', '<p/>')).toBe(true);
  });
});

describe('MailAdminService / MailController', () => {
  let mailService: any;
  let logModel: any;
  let settingModel: any;
  let admin: MailAdminService;
  let controller: MailController;

  beforeEach(() => {
    mailService = { sendMail: jest.fn().mockResolvedValue(true) };
    logModel = { find: jest.fn(), countDocuments: jest.fn() };
    settingModel = {
      find: jest.fn().mockReturnValue(chain([{ template_key: 'PASSWORD_RESET', enabled: false }])),
      updateOne: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue({}) }),
    };
    admin = new MailAdminService(mailService, logModel, settingModel);
    controller = new MailController(admin);
  });

  it('is restricted to ADMIN / SUPER_ADMIN', () => {
    const roles = Reflect.getMetadata(ROLES_KEY, MailController);
    expect(roles).toEqual([UserRole.ADMIN, UserRole.SUPER_ADMIN]);
  });

  it('lists templates with enabled flags (default true)', async () => {
    const list = await controller.listTemplates();
    expect(list).toHaveLength(MAIL_TEMPLATES.length);
    expect(list.find((t) => t.key === 'PASSWORD_RESET')!.enabled).toBe(false);
    expect(list.find((t) => t.key === 'CANCELLATION')!.enabled).toBe(true);
  });

  it('previews a template with sample data and 404s unknown keys', () => {
    const res = controller.preview('EXPIRED_HOLD');
    expect(res.subject).toContain('PNR8X2KQ');
    expect(res.html).toContain('BLK-20261015-001');
    expect(() => controller.preview('NOPE')).toThrow(NotFoundException);
  });

  it('sends a test email with [TEST] prefix and validates the address', async () => {
    const res = await controller.sendTest('UPCOMING_TRIP', { to: 'qa@example.com' });
    expect(res.success).toBe(true);
    const [to, subject, , meta] = mailService.sendMail.mock.calls[0];
    expect(to).toBe('qa@example.com');
    expect(subject.startsWith('[TEST]')).toBe(true);
    expect(meta.templateKey).toBe('UPCOMING_TRIP');
    await expect(controller.sendTest('UPCOMING_TRIP', { to: 'bad' })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('upserts the enabled toggle', async () => {
    expect(await controller.setEnabled('CANCELLATION', { enabled: false })).toEqual({ key: 'CANCELLATION', enabled: false });
    expect(settingModel.updateOne).toHaveBeenCalledWith(
      { template_key: 'CANCELLATION' },
      { $set: { enabled: false } },
      { upsert: true },
    );
    await expect(controller.setEnabled('CANCELLATION', { enabled: 'x' as any })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('filters and paginates logs', async () => {
    const q = chain([{ to: 'a@example.com' }]);
    logModel.find.mockReturnValue(q);
    logModel.countDocuments.mockReturnValue({ exec: jest.fn().mockResolvedValue(45) });
    const res = await controller.listLogs('CANCELLATION', 'FAILED', 'pnr(1', '2');
    const filter = logModel.find.mock.calls[0][0];
    expect(filter.template_key).toBe('CANCELLATION');
    expect(filter.status).toBe('FAILED');
    expect(filter.$or).toHaveLength(3);
    expect(q.skip).toHaveBeenCalledWith(20);
    expect(res).toMatchObject({ total: 45, page: 2, limit: 20, pages: 3 });
  });
});
