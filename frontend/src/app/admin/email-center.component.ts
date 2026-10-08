import { Component, OnInit, inject } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { ApiService } from '../core/api.service';
import { ToastService } from '../core/toast.service';

type Tab = 'templates' | 'logs' | 'jobs';
type Job = 'run-reminders' | 'run-travel-reminders' | 'run-expiry';

interface MailTemplateRow {
  key: string;
  name: string;
  description: string;
  trigger: string;
  enabled: boolean;
}

@Component({
  standalone: true,
  imports: [FormsModule, DatePipe],
  template: `
    <div class="eyebrow">TRUNG TÂM EMAIL</div>
    <div class="section-head">
      <div>
        <h1 class="title">Quản lý email</h1>
        <p class="subtitle">Xem trước mẫu email, theo dõi lịch sử gửi và chạy thủ công các tác vụ tự động.</p>
      </div>
    </div>

    <div class="ec-tabs" role="tablist">
      <button type="button" role="tab" class="btn" [class.btn-primary]="tab==='templates'" [class.btn-outline]="tab!=='templates'" (click)="setTab('templates')">Mẫu email</button>
      <button type="button" role="tab" class="btn" [class.btn-primary]="tab==='logs'" [class.btn-outline]="tab!=='logs'" (click)="setTab('logs')">Lịch sử gửi</button>
      <button type="button" role="tab" class="btn" [class.btn-primary]="tab==='jobs'" [class.btn-outline]="tab!=='jobs'" (click)="setTab('jobs')">Tác vụ tự động (demo)</button>
    </div>

    

    @if(tab==='templates'){
      <div class="ec-grid">
        <section class="card ec-list">
          @for(t of templates;track t.key){
            <article class="ec-item" [class.active]="selected?.key===t.key" (click)="select(t)">
              <div class="ec-item-head">
                <strong>{{t.name}}</strong>
                <label class="ec-switch" (click)="$event.stopPropagation()" [title]="t.enabled ? 'Đang bật' : 'Đang tắt'">
                  <input type="checkbox" [checked]="t.enabled" (change)="toggle(t, $any($event.target).checked)" />
                  <span class="pill" [class.pill-gold]="t.enabled">{{t.enabled ? 'Bật' : 'Tắt'}}</span>
                </label>
              </div>
              <p class="ec-desc">{{t.description}}</p>
              <p class="ec-when"><b>Khi nào gửi:</b> {{t.trigger}}</p>
            </article>
          } @empty {
            <p class="empty-row">{{loadingTemplates ? 'Đang tải…' : 'Không có mẫu email.'}}</p>
          }
        </section>

        <section class="card ec-preview">
          @if(selected){
            <div class="eyebrow">XEM TRƯỚC · {{selected.key}}</div>
            <p class="ec-subject"><b>Tiêu đề:</b> {{preview?.subject || '…'}}</p>
            <form class="ec-test" (ngSubmit)="sendTest()">
              <label class="field">
                <span>Gửi thử tới email</span>
                <input class="control" type="email" name="testTo" [(ngModel)]="testTo" placeholder="ban@example.com" required />
              </label>
              <button class="btn btn-primary" type="submit" [disabled]="sending || !testTo">{{sending ? 'Đang gửi…' : 'Gửi thử'}}</button>
            </form>
            @if(!selected.enabled){<p class="ec-note">Mẫu đang tắt: hệ thống sẽ không tự động gửi, nhưng vẫn có thể gửi thử.</p>}
            @if(previewHtml){
              <iframe class="ec-frame" title="Xem trước email" sandbox="" [attr.srcdoc]="previewHtml"></iframe>
            }
          } @else {
            <p class="empty-row">Chọn một mẫu email để xem trước.</p>
          }
        </section>
      </div>
    }

    @if(tab==='logs'){
      <section class="card ec-filters">
        <label class="field"><span>Mẫu</span>
          <select class="control" [(ngModel)]="logFilter.template" (change)="reloadLogs()">
            <option value="">Tất cả</option>
            @for(t of templates;track t.key){<option [value]="t.key">{{t.name}}</option>}
            <option value="CUSTOM">Khác (CUSTOM)</option>
          </select>
        </label>
        <label class="field"><span>Trạng thái</span>
          <select class="control" [(ngModel)]="logFilter.status" (change)="reloadLogs()">
            <option value="">Tất cả</option>
            <option value="SENT">Đã gửi (SENT)</option>
            <option value="DEV_FALLBACK">Dev (DEV_FALLBACK)</option>
            <option value="FAILED">Thất bại (FAILED)</option>
          </select>
        </label>
        <label class="field ec-grow"><span>Tìm email / PNR</span>
          <input class="control" [(ngModel)]="logFilter.q" (keyup.enter)="reloadLogs()" placeholder="vd: khach@example.com hoặc PNR8X2KQ" />
        </label>
        <button class="btn btn-outline" type="button" (click)="reloadLogs()">Lọc</button>
      </section>

      <section class="card table-card">
        <div class="table-wrap">
          <table class="table">
            <thead><tr><th>Thời gian</th><th>Mẫu</th><th>Người nhận</th><th>Tiêu đề</th><th>PNR</th><th>Trạng thái</th></tr></thead>
            <tbody>
              @for(l of logs;track l._id){
                <tr>
                  <td>{{l.created_at | date:'dd/MM/yyyy HH:mm:ss'}}</td>
                  <td>{{templateName(l.template_key)}}</td>
                  <td>{{l.to}}</td>
                  <td class="ec-subj-cell">{{l.subject}}</td>
                  <td>{{l.booking_reference || '—'}}</td>
                  <td>
                    <span class="pill" [class.pill-gold]="l.status==='SENT'" [class.ec-fail]="l.status==='FAILED'">{{statusLabel(l.status)}}</span>
                    @if(l.error){<div class="ec-err">{{l.error}}</div>}
                  </td>
                </tr>
              } @empty {
                <tr><td colspan="6" class="empty-row">{{loadingLogs ? 'Đang tải…' : 'Chưa có email nào được ghi nhận.'}}</td></tr>
              }
            </tbody>
          </table>
        </div>
      </section>
      <div class="ec-pager">
        <span>Tổng {{logTotal}} email · Trang {{logPage}}/{{logPages}}</span>
        <button class="btn btn-outline compact" type="button" [disabled]="logPage<=1" (click)="goLogPage(logPage-1)">‹ Trước</button>
        <button class="btn btn-outline compact" type="button" [disabled]="logPage>=logPages" (click)="goLogPage(logPage+1)">Sau ›</button>
      </div>
    }

    @if(tab==='jobs'){
      <section class="card ec-jobs">
        <p class="subtitle">Các tác vụ dưới đây vốn được cron chạy tự động. Dùng nút để chạy ngay khi demo — kết quả trả về sẽ hiển thị bên dưới, email đã gửi xuất hiện trong tab “Lịch sử gửi”.</p>
        <div class="ec-job">
          <div>
            <strong>Gửi nhắc giữ chỗ ngay</strong>
            <p>Cron <b>mỗi giờ</b>. Gửi email nhắc thanh toán cho vé <b>BLOCKED</b> chưa được nhắc, có chuyến khởi hành trong vòng <b>21 ngày</b> tới (yêu cầu nhắc trước 3 tuần) và chưa quá hạn giữ chỗ.</p>
          </div>
          <button class="btn btn-primary" type="button" [disabled]="running" (click)="run('run-reminders')">Gửi nhắc giữ chỗ ngay</button>
        </div>
        <div class="ec-job">
          <div>
            <strong>Gửi nhắc chuyến sắp bay</strong>
            <p>Cron <b>mỗi giờ</b>. Gửi email nhắc lịch cho vé <b>CONFIRMED/RESCHEDULED</b> có chặng khởi hành trong vòng <b>3 ngày</b>; mỗi hành trình chỉ nhắc một lần (đổi lịch sẽ nhắc lại).</p>
          </div>
          <button class="btn btn-primary" type="button" [disabled]="running" (click)="run('run-travel-reminders')">Gửi nhắc chuyến sắp bay</button>
        </div>
        <div class="ec-job">
          <div>
            <strong>Chạy hủy giữ chỗ hết hạn ngay</strong>
            <p>Cron <b>mỗi giờ</b>. Hạn giữ chỗ là <b>14 ngày trước giờ khởi hành</b>; vé BLOCKED quá hạn sẽ bị tự động hủy, hoàn ghế về kho và gửi email “Giữ chỗ hết hạn”. (Đối soát ghế/saga chạy <b>mỗi 10 phút</b>.)</p>
          </div>
          <button class="btn btn-primary" type="button" [disabled]="running" (click)="run('run-expiry')">Chạy hủy giữ chỗ hết hạn ngay</button>
        </div>
        @if(jobResult){
          <div class="ec-result">
            <div class="eyebrow">KẾT QUẢ · {{jobResult.label}} · {{jobResult.at | date:'HH:mm:ss'}}</div>
            <p>{{jobResult.message}}</p>
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
  jobResult: { label: string; message: string; at: Date } | null = null;

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
    this.error = Array.isArray(msg) ? msg.join(', ') : msg || fallback;
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
        this.fail(e, 'Không tải được danh sách mẫu email.');
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
      error: (e) => this.fail(e, 'Không tải được bản xem trước.'),
    });
  }

  toggle(t: MailTemplateRow, enabled: boolean) {
    const prev = t.enabled;
    t.enabled = enabled;
    this.api.setMailTemplateEnabled(t.key, enabled).subscribe({
      next: () => this.toast.success({ titleVi: `${enabled ? 'Đã bật' : 'Đã tắt'} mẫu “${t.name}”`, titleEn: `Template ${enabled ? 'enabled' : 'disabled'}` }),
      error: (e) => {
        t.enabled = prev;
        this.fail(e, 'Không cập nhật được trạng thái mẫu.');
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
        if (res?.success) this.toast.success({ titleVi: 'Đã gửi email thử', titleEn: 'Test email sent', messageVi: res.message, messageEn: res.message });
        else this.error = res?.message || 'Gửi email thử thất bại.';
      },
      error: (e) => {
        this.sending = false;
        this.fail(e, 'Gửi email thử thất bại.');
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
        this.fail(e, 'Không tải được lịch sử gửi email.');
      },
    });
  }

  templateName(key: string) {
    return this.templates.find((t) => t.key === key)?.name || key;
  }

  statusLabel(s: string) {
    return s === 'SENT' ? 'Đã gửi' : s === 'FAILED' ? 'Thất bại' : s === 'DEV_FALLBACK' ? 'Dev (console)' : s;
  }

  async run(job: Job) {
    const labels: Record<Job, string> = {
      'run-reminders': 'Gửi nhắc giữ chỗ',
      'run-travel-reminders': 'Gửi nhắc chuyến sắp bay',
      'run-expiry': 'Hủy giữ chỗ hết hạn',
    };
    const warn = job === 'run-expiry'
      ? 'Tác vụ này sẽ HỦY THẬT các vé giữ chỗ đã quá hạn và hoàn ghế về kho. Tiếp tục?'
      : `Chạy ngay tác vụ “${labels[job]}”? Email thật sẽ được gửi cho khách hàng đủ điều kiện.`;
    const ok = await this.toast.confirm({
      titleVi: labels[job],
      titleEn: 'Run scheduled job now?',
      messageVi: warn,
      messageEn: warn,
      confirmVi: 'Chạy ngay',
    });
    if (!ok) return;
    this.running = true;
    this.error = '';
    this.api.runBookingScheduler(job).subscribe({
      next: (res) => {
        this.running = false;
        this.jobResult = { label: labels[job], message: res?.message || JSON.stringify(res), at: new Date() };
      },
      error: (e) => {
        this.running = false;
        this.fail(e, 'Chạy tác vụ thất bại.');
      },
    });
  }
}
