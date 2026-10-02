import { Component, Input } from '@angular/core';

@Component({
  selector:'app-brand-logo',
  standalone:true,
  template:`
    <span class="brand-logo" [class.compact]="compact">
      <span class="mark" aria-hidden="true">
        <svg viewBox="0 0 64 64" role="img">
          <path class="wing wing-top" d="M10 36 44 12c4-3 9 2 6 6L38 33l16 3c4 1 4 7 0 8l-20 3-8 9c-3 3-8 0-6-4l5-10-15-1c-4 0-5-4 0-5Z"/>
          <path class="wing-cut" d="m30 35 11-13-18 13h7Z"/>
          <path class="spark" d="M47 10h7v7h-3v-4h-4v-3Z"/>
        </svg>
      </span>
      <span class="wordmark"><span>APTECH</span><b>AIRLINES</b>@if(!compact){<small>FLY BEYOND</small>}</span>
    </span>
  `,
  styles:[`
    :host{display:inline-flex}.brand-logo{display:inline-flex;align-items:center;gap:11px;color:#fff}.mark{width:42px;height:42px;display:grid;place-items:center;border-radius:14px;background:linear-gradient(145deg,#f5cf69,#c89622);box-shadow:0 8px 24px rgba(212,175,55,.24);overflow:hidden}.mark svg{width:34px;height:34px}.wing-top{fill:#071b2e}.wing-cut{fill:#f7dfa0}.spark{fill:#fff}.wordmark{display:grid;grid-template-columns:auto auto;column-gap:6px;align-items:center;font-size:15px;letter-spacing:.075em;font-weight:900;line-height:1}.wordmark b{color:#f2c85f}.wordmark small{grid-column:1/-1;font-size:7px;letter-spacing:.28em;color:#8fa5b5;margin-top:5px;font-weight:800}.brand-logo.compact .mark{width:36px;height:36px;border-radius:12px}.brand-logo.compact .mark svg{width:29px;height:29px}.brand-logo.compact .wordmark{font-size:14px}@media(max-width:520px){.brand-logo.compact .wordmark span,.brand-logo.compact .wordmark b{display:none}.brand-logo.compact{gap:0}}
  `]
})
export class BrandLogoComponent{
  @Input() compact=false;
}
