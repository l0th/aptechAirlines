import { MailAdminService } from './mail-admin.service';
import { MailService } from './mail.service';
import { MAIL_TEMPLATES } from './mail-templates';

describe('MailAdminService bilingual preview and test send', () => {
  const sender = { sendMail: jest.fn().mockResolvedValue(true) } as unknown as MailService;
  const service = new MailAdminService(sender, {} as any, {} as any);

  beforeEach(() => jest.clearAllMocks());

  it.each(MAIL_TEMPLATES.map((tpl) => tpl.key))('%s preview shows Vietnamese above English regardless of lang query', (key) => {
    const viPreview = service.preview(key, 'vi');
    const enPreview = service.preview(key, 'en');
    expect(enPreview).toEqual(viPreview);
    expect(viPreview.lang).toBe('vi-en');
    expect(viPreview.subject).toContain(' | ');
    expect(viPreview.html.indexOf('<section lang="vi"')).toBeLessThan(viPreview.html.indexOf('<section lang="en"'));
    expect(viPreview.html).not.toMatch(/<html[\s>]/i);
  });

  it('uses the same bilingual HTML for test sends and preserves translated free text', async () => {
    const preview = service.preview('FLIGHT_DISRUPTION');
    expect(preview.html).toContain('Thời tiết xấu tại sân bay đến');
    expect(preview.html).toContain('Bad weather at the destination airport');

    const response = await service.sendTest('FLIGHT_DISRUPTION', 'test@example.com', 'en');
    expect(response.success).toBe(true);
    expect(response.messageVi).toContain('Đã gửi email thử');
    expect(response.messageEn).toContain('Test email sent');
    expect(sender.sendMail).toHaveBeenCalledTimes(1);
    expect(sender.sendMail).toHaveBeenCalledWith(
      'test@example.com',
      `[TEST] ${preview.subject}`,
      preview.html,
      expect.objectContaining({ templateKey: 'FLIGHT_DISRUPTION' }),
    );
  });
});
