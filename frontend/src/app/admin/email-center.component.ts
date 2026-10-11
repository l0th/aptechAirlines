import { Component, OnInit, inject } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { ApiService } from '../core/api.service';
import { ToastService } from '../core/toast.service';
import { LanguageService } from '../core/language.service';

type Tab = 'templates' | 'logs' | 'jobs';
type Job = 'run-reminders' | 'run-travel-reminders' | 'run-expiry';

interface MailTemplateRow {
  key: string;
  name: string;
  description: string;
  trigger: string;
  nameEn?: string;
  descriptionEn?: string;
  triggerEn?: string;
  enabled: boolean;
}

@Component({
  standalone: true,
  imports: [FormsModule, DatePipe],
  template: `
    <div class="eyebrow">{{t('TRUNG TÂM EMAIL','EMAIL CENTER')}}</div>
    <div class="section-head">
      <div>
        <h1 class="title">{{t('Quản lý email','Email center')}}</h1>
        <p class="subtitle">{{t('Xem trước mẫu email, theo dõi lịch sử gửi và chạy thủ công các tác vụ tự động.','Preview email templates, review send history and manually run automated jobs.')}}</p>
      </div>
    </div>

    <div class="ec-tabs" role="tablist">
      <button type="button" role="tab" class="btn" [class.btn-primary]="tab==='templates'" [class.btn-outline]="tab!=='templates'" (click)="setTab('templates')">{{t('Mẫu email','Templates')}}</button>
      <button type="button" role="tab" class="btn" [class.btn-primary]="tab==='logs'" [class.btn-outline]="tab!=='logs'" (click)="setTab('logs')">{{t('Lịch sử gửi','Send history')}}</button>
      <button type="button" role="tab" class="btn" [class.btn-primary]="tab==='jobs'" [class.btn-outline]="tab!=='jobs'" (click)="setTab('jobs')">{{t('Tác vụ tự động (demo)','Automated jobs (demo)')}}</button>
    </div>

    

    @if(tab==='templates'){
      <div class="ec-grid">
        <section class="card ec-list">
          @for(t of templates;track t.key){
            <article class="ec-item" [class.active]="selected?.key===t.key" (click)="select(t)">
              <div class="ec-item-head">
                <strong translate="no">{{tName(t)}}</strong>
                <label class="ec-switch" (click)="$event.stopPropagation()" [title]="t.enabled ? this.t('Đang bật','Enabled') : this.t('Đang tắt','Disabled')">
                  <input type="checkbox" [checked]="t.enabled" (change)="toggle(t, $any($event.target).checked)" />
                  <span class="pill" [class.pill-gold]="t.enabled">{{t.enabled ? this.t('Bật','On') : this.t('Tắt','Off')}}</span>
                </label>
              </div>
              <p class="ec-desc" translate="no">{{tDesc(t)}}</p>
              <p class="ec-when"><b>{{this.t('Khi nào gửi:','When sent:')}}</b> <span translate="no">{{tTrigger(t)}}</span></p>
            </article>
          } @empty {
            <p class="empty-row">{{loadingTemplates ? t('Đang tải…','Loading…') : t('Không có mẫu email.','No email templates.')}}</p>
          }
        </section>

        <section class="card ec-preview">
          @if(selected){
            <div class="eyebrow">{{t('XEM TRƯỚC','PREVIEW')}} · <span translate="no">{{selected.key}}</span></div>
            <p class="ec-hint">{{t('Email song ngữ: Tiếng Việt phía trên, English phía dưới (trong cùng một email).','Bilingual email: Vietnamese first, English below in the same email.')}}</p>
            <p class="ec-subject"><b>{{t('Tiêu đề:','Subject:')}}</b> <span translate="no">{{preview?.subject || '…'}}</span></p>
            <form class="ec-test" (ngSubmit)="sendTest()">
              <label class="field">
                <span>{{t('Gửi thử tới email','Send test to')}}</span>
                <input class="control" type="email" name="testTo" [(ngModel)]="testTo" placeholder="ban@example.com" required />
              </label>
              <button class="btn btn-primary" type="submit" [disabled]="sending || !testTo">{{sending ? t('Đang gửi…','Sending…') : t('Gửi thử','Send test')}}</button>
            </form>
            @if(!selected.enabled){<p class="ec-note">{{t('Mẫu đang tắt: hệ thống sẽ không tự động gửi, nhưng vẫn có thể gửi thử.','This template is disabled: it will not be sent automatically, but test sends remain available.')}}</p>}
            @if(previewHtml){
              <iframe class="ec-frame" [title]="t('Xem trước email','Email preview')" sandbox="" [attr.srcdoc]="previewHtml"></iframe>
            }
          } @else {
            <p class="empty-row">{{t('Chọn một mẫu email để xem trước.','Select an email template to preview.')}}</p>
          }
        </section>
      </div>
    }

    @if(tab==='logs'){
      <section class="card ec-filters">
        <label class="field"><span>{{t('Mẫu','Template')}}</span>
          <select class="control" [(ngModel)]="logFilter.template" (change)="reloadLogs()">
            <option value="">{{t('Tất cả','All')}}</option>
            @for(t of templates;track t.key){<option [value]="t.key" translate="no">{{tName(t)}}</option>}
            <option value="CUSTOM">{{t('Khác','Other')}} (CUSTOM)</option>
          </select>
        </label>
        <label class="field"><span>{{t('Trạng thái','Status')}}</span>
          <select class="control" [(ngModel)]="logFilter.status" (change)="reloadLogs()">
            <option value="">{{t('Tất cả','All')}}</option>
            <option value="SENT">{{t('Đã gửi','Sent')}} (SENT)</option>
            <option value="DEV_FALLBACK">Dev (DEV_FALLBACK)</option>
            <option value="FAILED">{{t('Thất bại','Failed')}} (FAILED)</option>
          </select>
        </label>
        <label class="field ec-grow"><span>{{t('Tìm email / PNR','Search email / PNR')}}</span>
          <input class="control" [(ngModel)]="logFilter.q" (keyup.enter)="reloadLogs()" [placeholder]="t('vd: khach@example.com hoặc PNR8X2KQ','e.g. customer@example.com or PNR8X2KQ')" />
        </label>
        <button class="btn btn-outline" type="button" (click)="reloadLogs()">{{t('Lọc','Filter')}}</button>
      </section>

      <section class="card table-card">
        <div class="table-wrap">
          <table class="table">
            <thead><tr><th>{{t('Thời gian','Time')}}</th><th>{{t('Mẫu','Template')}}</th><th>{{t('Người nhận','Recipient')}}</th><th>{{t('Tiêu đề','Subject')}}</th><th>PNR</th><th>{{t('Trạng thái','Status')}}</th></tr></thead>
            <tbody>
              @for(l of logs;track l._id){
                <tr>
                  <td>{{l.created_at | date:'dd/MM/yyyy HH:mm:ss'}}</td>
                  <td translate="no">{{templateName(l.template_key)}}</td>
                  <td>{{l.to}}</td>
                  <td class="ec-subj-cell" translate="no">{{l.subject}}</td>
                  <td>{{l.booking_reference || '—'}}</td>
                  <td>
                    <span class="pill" [class.pill-gold]="l.status==='SENT'" [class.ec-fail]="l.status==='FAILED'">{{statusLabel(l.status)}}</span>
                    @if(l.error){<div class="ec-err">{{l.error}}</div>}
                  </td>
                </tr>
              } @empty {
                <tr><td colspan="6" class="empty-row">{{loadingLogs ? t('Đang tải…','Loading…') : t('Chưa có email nào được ghi nhận.','No email has been recorded yet.')}}</td></tr>
              }
            </tbody>
          </table>
        </div>
      </section>
      <div class="ec-pager">
        <span>{{t('Tổng','Total')}} {{logTotal}} email · {{t('Trang','Page')}} {{logPage}}/{{logPages}}</span>
        <button class="btn btn-outline compact" type="button" [disabled]="logPage<=1" (click)="goLogPage(logPage-1)">‹ {{t('Trước','Previous')}}</button>
        <button class="btn btn-outline compact" type="button" [disabled]="logPage>=logPages" (click)="goLogPage(logPage+1)">{{t('Sau','Next')}} ›</button>
      </div>
    }

    @if(tab==='jobs'){
      <section class="card ec-jobs">
        <p class="subtitle">{{t('Các tác vụ dưới đây vốn được cron chạy tự động. Dùng nút để chạy ngay khi demo — kết quả trả về sẽ hiển thị bên dưới, email đã gửi xuất hiện trong tab “Lịch sử gửi”.','These jobs normally run automatically by cron. Use the buttons to run them during a demo; results appear below and sent emails appear under Send history.')}}</p>
        <div class="ec-job">
          <div>
            <strong>{{t('Gửi nhắc giữ chỗ ngay','Send hold reminders now')}}</strong>
            <p>{{t('Cron mỗi giờ. Gửi email nhắc thanh toán cho vé BLOCKED chưa được nhắc, có chuyến khởi hành trong vòng 21 ngày tới và chưa quá hạn giữ chỗ.','Hourly cron. Sends payment reminders for unreminded BLOCKED bookings departing within 21 days that have not expired.')}}</p>
          </div>
          <button class="btn btn-primary" type="button" [disabled]="running" (click)="run('run-reminders')">{{t('Gửi nhắc giữ chỗ ngay','Send hold reminders now')}}</button>
        </div>
        <div class="ec-job">
          <div>
            <strong>{{t('Gửi nhắc chuyến sắp bay','Send upcoming-trip reminders')}}</strong>
            <p>{{t('Cron mỗi giờ. Gửi email nhắc lịch cho vé CONFIRMED/RESCHEDULED có chặng khởi hành trong vòng 3 ngày; mỗi hành trình chỉ nhắc một lần.','Hourly cron. Sends trip reminders for CONFIRMED/RESCHEDULED bookings with a leg departing within 3 days; each itinerary is reminded once.')}}</p>
          </div>
          <button class="btn btn-primary" type="button" [disabled]="running" (click)="run('run-travel-reminders')">{{t('Gửi nhắc chuyến sắp bay','Send upcoming-trip reminders')}}</button>
        </div>
        <div class="ec-job">
          <div>
            <strong>{{t('Chạy hủy giữ chỗ hết hạn ngay','Cancel expired holds now')}}</strong>
            <p>{{t('Cron mỗi giờ. Vé BLOCKED quá hạn giữ chỗ 14 ngày trước giờ khởi hành sẽ tự động bị hủy, hoàn ghế về kho và gửi email hết hạn.','Hourly cron. BLOCKED bookings that pass the 14-day pre-departure hold deadline are cancelled, their seats released and an expiry email sent.')}}</p>
          </div>
          <button class="btn btn-primary" type="button" [disabled]="running" (click)="run('run-expiry')">{{t('Chạy hủy giữ chỗ hết hạn ngay','Cancel expired holds now')}}</button>
        </div>
        @if(jobResult){
          <div class="ec-result">
            <div class="eyebrow">{{t('KẾT QUẢ','RESULT')}} · {{t(jobResult.labelVi,jobResult.labelEn)}} · {{jobResult.at | date:'HH:mm:ss'}}</div>
            <p>{{t(jobResult.messageVi,jobResult.messageEn)}}</p>
          </div>
        }
      </section>
    }
  `,
  styles: [`
    .ec-tabs{display:flex;gap:8px;flex-wrap:wrap;margin:8px 0 16px}
    .ec-grid{display:grid;grid-template-columns:minmax(280px,380px) 1fr;gap:16px;align-items:start}
    @media (max-width:960px){.ec-grid{grid-template-columns:1fr}}
    .ec-list{padding:8px;display:flex;flex-direction:column;gap:6px;max-height:78vh;overflow:auto}
    .ec-item{padding:12px;border-radius:12px;border:1px solid transparent;cursor:pointer}
    .ec-item:hover{background:var(--soft,#f5f7fa)}
    .ec-item.active{border-color:var(--gold,#d6b35a);background:#fffaf0}
    .ec-item-head{display:flex;justify-content:space-between;align-items:center;gap:8px}
    .ec-switch{display:inline-flex;align-items:center;gap:6px;cursor:pointer}
    .ec-desc{margin:6px 0 4px;color:var(--ink,#102033);font-size:13px}
    .ec-when{margin:0;color:var(--muted,#68778a);font-size:12px}
    .ec-preview{padding:16px}
    .ec-subject{margin:6px 0 12px}
    .ec-hint{margin:0 0 6px;color:var(--muted,#68778a);font-size:12px}
    .ec-test{display:flex;gap:8px;align-items:flex-end;flex-wrap:wrap;margin-bottom:12px}
    .ec-test .field{flex:1;min-width:220px}
    .ec-note{color:var(--warn,#a76b00);font-size:13px}
    .ec-frame{width:100%;height:68vh;border:1px solid var(--line,#dde5ec);border-radius:12px;background:#fff}
    .ec-filters{display:flex;gap:12px;align-items:flex-end;flex-wrap:wrap;padding:12px 16px;margin-bottom:12px}
    .ec-grow{flex:1;min-width:220px}
    .ec-subj-cell{max-width:320px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .ec-fail{background:#fde8e8;color:var(--danger,#c53b3b)}
    .ec-err{color:var(--danger,#c53b3b);font-size:12px;margin-top:4px}
    .ec-pager{display:flex;gap:8px;align-items:center;justify-content:flex-end;margin-top:12px}
    .ec-jobs{padding:16px;display:flex;flex-direction:column;gap:12px}
    .ec-job{display:flex;justify-content:space-between;gap:16px;align-items:center;padding:12px;border:1px solid var(--line,#dde5ec);border-radius:12px}
    .ec-job p{margin:4px 0 0;color:var(--muted,#68778a);font-size:13px}
    .ec-result{padding:12px;border-radius:12px;background:#fff7df;border:1px solid #efd783}
  `],
})
export class EmailCenterComponent implements OnInit {
  /** Validation/API messages are shown as global toasts instead of inline banners. */
  private __toast=inject(ToastService);
  private api = inject(ApiService);
  private toast = inject(ToastService);
  private sanitizer = inject(DomSanitizer);
  readonly language = inject(LanguageService);

  tab: Tab = 'templates';
  private __error='';get error(){return this.__error}set error(v:string){this.__error=v;this.__toast.notifyError(v)};

  templates: MailTemplateRow[] = [];
  loadingTemplates = false;
  selected: MailTemplateRow | null = null;
  preview: { subject: string; html: string } | null = null;
  previewHtml: SafeHtml | null = null;
  testTo = '';
  sending = false;

  logs: any[] = [];
  loadingLogs = false;
  logFilter = { template: '', status: '', q: '' };
  logPage = 1;
  logPages = 1;
  logTotal = 0;

  running = false;
  jobResult: { labelVi: string; labelEn: string; messageVi: string; messageEn: string; at: Date } | null = null;

  ngOnInit() {
    this.loadTemplates();
  }

  setTab(tab: Tab) {
    this.tab = tab;
    this.error = '';
    if (tab === 'logs') this.reloadLogs();
  }

  private fail(e: any, fallback: string) {
    const msg = e?.error?.message;
    const detail = Array.isArray(msg) ? msg.join(', ') : msg || fallback;
    this.error = this.language.translateNotice(detail);
  }

  loadTemplates() {
    this.loadingTemplates = true;
    this.api.mailTemplates().subscribe({
      next: (rows) => {
        this.templates = rows || [];
        this.loadingTemplates = false;
        if (!this.selected && this.templates.length) this.select(this.templates[0]);
      },
      error: (e) => {
        this.loadingTemplates = false;
        this.fail(e, this.language.pick('Không tải được danh sách mẫu email.','Unable to load email templates.'));
      },
    });
  }

  select(t: MailTemplateRow) {
    this.selected = t;
    this.preview = null;
    this.previewHtml = null;
    this.api.mailTemplatePreview(t.key).subscribe({
      next: (res) => {
        if (this.selected?.key !== t.key) return;
        this.preview = res;
        // Rendered inside a fully sandboxed iframe (no scripts, no same-origin).
        this.previewHtml = this.sanitizer.bypassSecurityTrustHtml(
          `<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0;padding:16px;background:#f5f7fa">${res.html}</body></html>`,
        );
      },
      error: (e) => this.fail(e, this.language.pick('Không tải được bản xem trước.','Unable to load preview.')),
    });
  }

  toggle(t: MailTemplateRow, enabled: boolean) {
    const prev = t.enabled;
    t.enabled = enabled;
    this.api.setMailTemplateEnabled(t.key, enabled).subscribe({
      next: () => this.toast.success({ titleVi: `${enabled ? 'Đã bật' : 'Đã tắt'} mẫu “${t.name}”`, titleEn: `Template ${enabled ? 'enabled' : 'disabled'}` }),
      error: (e) => {
        t.enabled = prev;
        this.fail(e, this.language.pick('Không cập nhật được trạng thái mẫu.','Unable to update template status.'));
      },
    });
  }

  sendTest() {
    if (!this.selected || !this.testTo) return;
    this.sending = true;
    this.error = '';
    this.api.sendMailTemplateTest(this.selected.key, this.testTo.trim()).subscribe({
      next: (res) => {
        this.sending = false;
        if (res?.success) this.toast.success({ titleVi: 'Đã gửi email thử', titleEn: 'Test email sent', messageVi: res.messageVi, messageEn: res.messageEn });
        else this.error = this.language.pick(res?.messageVi || 'Gửi email thử thất bại.', res?.messageEn || 'Unable to send test email.');
      },
      error: (e) => {
        this.sending = false;
        this.fail(e, this.language.pick('Gửi email thử thất bại.','Unable to send test email.'));
      },
    });
  }

  reloadLogs() {
    this.logPage = 1;
    this.loadLogs();
  }

  goLogPage(page: number) {
    this.logPage = page;
    this.loadLogs();
  }

  loadLogs() {
    this.loadingLogs = true;
    this.api.mailLogs({ ...this.logFilter, page: this.logPage, limit: 20 }).subscribe({
      next: (res) => {
        this.loadingLogs = false;
        this.logs = res?.items || [];
        this.logTotal = res?.total || 0;
        this.logPages = res?.pages || 1;
      },
      error: (e) => {
        this.loadingLogs = false;
        this.fail(e, this.language.pick('Không tải được lịch sử gửi email.','Unable to load email history.'));
      },
    });
  }

  private get isEn() {
    return this.language.language() === 'en';
  }

  t(vi: string, en: string) {
    return this.language.pick(vi, en);
  }

  tName(t: MailTemplateRow) {
    return (this.isEn && t.nameEn) || t.name;
  }

  tDesc(t: MailTemplateRow) {
    return (this.isEn && t.descriptionEn) || t.description;
  }

  tTrigger(t: MailTemplateRow) {
    return (this.isEn && t.triggerEn) || t.trigger;
  }

  templateName(key: string) {
    const t = this.templates.find((x) => x.key === key);
    return t ? this.tName(t) : key;
  }

  statusLabel(s: string) {
    return s === 'SENT'
      ? this.language.pick('Đã gửi','Sent')
      : s === 'FAILED'
        ? this.language.pick('Thất bại','Failed')
        : s === 'DEV_FALLBACK'
          ? this.language.pick('Dev (console)','Dev (console)')
          : s;
  }

  async run(job: Job) {
    const labelsVi: Record<Job, string> = {
      'run-reminders': 'Gửi nhắc giữ chỗ',
      'run-travel-reminders': 'Gửi nhắc chuyến sắp bay',
      'run-expiry': 'Hủy giữ chỗ hết hạn',
    };
    const labelsEn: Record<Job, string> = {
      'run-reminders': 'Send hold reminders',
      'run-travel-reminders': 'Send upcoming-trip reminders',
      'run-expiry': 'Cancel expired holds',
    };
    const warnVi = job === 'run-expiry'
      ? 'Tác vụ này sẽ HỦY THẬT các vé giữ chỗ đã quá hạn và hoàn ghế về kho. Tiếp tục?'
      : `Chạy ngay tác vụ “${labelsVi[job]}”? Email thật sẽ được gửi cho khách hàng đủ điều kiện.`;
    const warnEn = job === 'run-expiry'
      ? 'This job will actually cancel expired holds and release their seats. Continue?'
      : `Run “${labelsEn[job]}” now? Real emails will be sent to eligible customers.`;
    const ok = await this.toast.confirm({
      titleVi: labelsVi[job],
      titleEn: labelsEn[job],
      messageVi: warnVi,
      messageEn: warnEn,
      confirmVi: 'Chạy ngay',
      confirmEn: 'Run now',
    });
    if (!ok) return;
    this.running = true;
    this.error = '';
    this.api.runBookingScheduler(job).subscribe({
      next: (res) => {
        this.running = false;
        this.jobResult = {
          labelVi: labelsVi[job],
          labelEn: labelsEn[job],
          messageVi: res?.messageVi || res?.message || JSON.stringify(res),
          messageEn: res?.messageEn || res?.message || JSON.stringify(res),
          at: new Date(),
        };
      },
      error: (e) => {
        this.running = false;
        this.fail(e, this.language.pick('Chạy tác vụ thất bại.','Unable to run scheduled job.'));
      },
    });
  }
}
