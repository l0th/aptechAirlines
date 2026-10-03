import { Component, EventEmitter, Input, Output } from '@angular/core';
import { FormsModule } from '@angular/forms';

@Component({
  selector: 'app-pagination',
  standalone: true,
  imports: [FormsModule],
  template: `
    @if(total > 0){
      <nav class="pager" aria-label="Phân trang">
        <div class="summary">Hiển thị <b>{{from}}</b>–<b>{{to}}</b> / <b>{{total}}</b></div>
        <div class="controls">
          <label>
            <span>Mỗi trang</span>
            <select class="page-size" [ngModel]="pageSize" (ngModelChange)="changeSize($event)">
              @for(size of pageSizeOptions; track size){<option [ngValue]="size">{{size}}</option>}
            </select>
          </label>
          <button type="button" class="page-btn" (click)="go(1)" [disabled]="page<=1" aria-label="Trang đầu">«</button>
          <button type="button" class="page-btn" (click)="go(page-1)" [disabled]="page<=1" aria-label="Trang trước">‹</button>
          @for(p of visiblePages; track p){
            <button type="button" class="page-btn number" [class.active]="p===page" (click)="go(p)">{{p}}</button>
          }
          <button type="button" class="page-btn" (click)="go(page+1)" [disabled]="page>=totalPages" aria-label="Trang sau">›</button>
          <button type="button" class="page-btn" (click)="go(totalPages)" [disabled]="page>=totalPages" aria-label="Trang cuối">»</button>
        </div>
      </nav>
    }
  `,
  styles: [`
    .pager{display:flex;align-items:center;justify-content:space-between;gap:14px;flex-wrap:wrap;padding:14px 16px;margin-top:12px;background:#fff;border:1px solid #dfe6ec;border-radius:16px;box-shadow:0 7px 20px rgba(15,35,52,.04)}
    .summary{font-size:12px;color:#718093;white-space:nowrap}.summary b{color:#0a2540}
    .controls{display:flex;align-items:center;gap:6px;flex-wrap:wrap}.controls label{display:flex;align-items:center;gap:7px;margin-right:5px;font-size:11px;color:#718093;font-weight:800}
    .page-size{border:1px solid #d5dfe7;border-radius:10px;background:#fff;color:#0a2540;padding:7px 9px;outline:none}
    .page-btn{min-width:34px;height:34px;border:1px solid #d5dfe7;border-radius:10px;background:#fff;color:#0a2540;font-weight:900;display:grid;place-items:center;padding:0 8px}
    .page-btn:hover:not(:disabled){border-color:#d4af37;background:#fffaf0}.page-btn.active{background:#0a2540;color:#fff;border-color:#0a2540}.page-btn:disabled{opacity:.35;cursor:not-allowed}
    @media(max-width:700px){.pager{align-items:stretch;flex-direction:column}.controls{justify-content:space-between;overflow:auto}.controls label{margin-right:auto}.page-btn.number{display:none}}
  `]
})
export class PaginationComponent {
  @Input() total = 0;
  @Input() page = 1;
  @Output() pageChange = new EventEmitter<number>();
  @Input() pageSize = 20;
  @Output() pageSizeChange = new EventEmitter<number>();
  @Input() pageSizeOptions = [10, 20, 50, 100];

  get totalPages(){ return Math.max(1, Math.ceil(this.total / Math.max(1, this.pageSize))); }
  get from(){ return this.total ? (this.page - 1) * this.pageSize + 1 : 0; }
  get to(){ return Math.min(this.total, this.page * this.pageSize); }
  get visiblePages(){
    const total=this.totalPages;
    const start=Math.max(1,Math.min(this.page-2,total-4));
    const end=Math.min(total,start+4);
    return Array.from({length:end-start+1},(_,i)=>start+i);
  }
  go(next:number){
    const value=Math.max(1,Math.min(this.totalPages,Number(next)||1));
    if(value!==this.page)this.pageChange.emit(value);
  }
  changeSize(value:any){
    const size=Math.max(1,Number(value)||20);
    this.pageSizeChange.emit(size);
    this.pageChange.emit(1);
  }
}
