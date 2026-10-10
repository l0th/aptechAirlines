import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { EmailLog, EmailLogDocument, EmailSetting, EmailSettingDocument } from './email-log.schema';
import { MAIL_TEMPLATES, MailTemplateDefinition, findMailTemplate, sampleDataFor } from './mail-templates';
import { MailService } from './mail.service';
import { normalizeMailLang, renderBilingualMail } from './mail-i18n';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export interface EmailLogQuery {
  template?: string;
  status?: string;
  q?: string;
  page?: string | number;
  limit?: string | number;
}

@Injectable()
export class MailAdminService {
  constructor(
    private readonly mailService: MailService,
    @InjectModel(EmailLog.name) private readonly logModel: Model<EmailLogDocument>,
    @InjectModel(EmailSetting.name) private readonly settingModel: Model<EmailSettingDocument>,
  ) {}

  private getTemplate(key: string): MailTemplateDefinition {
    const tpl = findMailTemplate(key);
    if (!tpl) throw new NotFoundException(`Email template ${key} not found.`);
    return tpl;
  }

  async listTemplates() {
    const settings = await this.settingModel.find().lean().exec();
    const map = new Map(settings.map((s) => [s.template_key, s.enabled !== false]));
    return MAIL_TEMPLATES.map((t) => ({
      key: t.key,
      name: t.name,
      description: t.description,
      trigger: t.trigger,
      nameEn: t.nameEn,
      descriptionEn: t.descriptionEn,
      triggerEn: t.triggerEn,
      enabled: map.has(t.key) ? map.get(t.key) : true,
    }));
  }

  /** The preview always matches the bilingual email actually sent to customers. */
  preview(key: string, lang?: string) {
    const tpl = this.getTemplate(key);
    const { subject, html } = renderBilingualMail((language) => tpl.render(sampleDataFor(tpl, language)));
    return { key: tpl.key, lang: 'vi-en', subject, html };
  }

  async sendTest(key: string, to: string, lang?: string) {
    const language = normalizeMailLang(lang);
    const email = String(to || '').trim();
    if (!EMAIL_RE.test(email)) {
      throw new BadRequestException(language === 'en' ? 'Invalid email address.' : 'Địa chỉ email không hợp lệ.');
    }
    const tpl = this.getTemplate(key);
    const { subject, html } = renderBilingualMail((partLang) =>
      tpl.render({ ...sampleDataFor(tpl, partLang), toEmail: email }),
    );
    // Test sends bypass the enable toggle on purpose so admins can preview disabled templates.
    const ok = await this.mailService.sendMail(email, `[TEST] ${subject}`, html, {
      templateKey: tpl.key,
      bookingReference: tpl.sampleData?.bookingReference,
    });
    const message = ok
      ? language === 'en'
        ? `Test email sent to ${email}.`
        : `Đã gửi email thử tới ${email}.`
      : language === 'en'
        ? 'Failed to send the email. Check the SMTP configuration / delivery history.'
        : 'Gửi email thất bại. Kiểm tra cấu hình SMTP / lịch sử gửi.';
    return {
      success: ok,
      message,
      messageVi: ok ? `Đã gửi email thử tới ${email}.` : 'Gửi email thất bại. Kiểm tra cấu hình SMTP / lịch sử gửi.',
      messageEn: ok ? `Test email sent to ${email}.` : 'Failed to send the email. Check the SMTP configuration / delivery history.',
    };
  }

  async setEnabled(key: string, enabled: boolean) {
    if (typeof enabled !== 'boolean') throw new BadRequestException('enabled must be a boolean.');
    const tpl = this.getTemplate(key);
    await this.settingModel
      .updateOne({ template_key: tpl.key }, { $set: { enabled } }, { upsert: true })
      .exec();
    return { key: tpl.key, enabled };
  }

  async listLogs(query: EmailLogQuery) {
    const filter: Record<string, any> = {};
    if (query.template) filter.template_key = query.template;
    if (query.status) filter.status = query.status;
    if (query.q && String(query.q).trim()) {
      const rx = new RegExp(escapeRegex(String(query.q).trim()), 'i');
      filter.$or = [{ to: rx }, { booking_reference: rx }, { subject: rx }];
    }
    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(query.limit) || 20));
    const [items, total] = await Promise.all([
      this.logModel
        .find(filter)
        .sort({ created_at: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean()
        .exec(),
      this.logModel.countDocuments(filter).exec(),
    ]);
    return { items, total, page, limit, pages: Math.max(1, Math.ceil(total / limit)) };
  }
}
