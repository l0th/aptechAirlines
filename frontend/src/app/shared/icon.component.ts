import { Component, Input } from '@angular/core';
@Component({selector:'app-icon',standalone:true,template:`<svg [attr.width]="size" [attr.height]="size" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
@switch(name){
@case('plane'){<path d="M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z"/>}
@case('search'){<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>}
@case('user'){<circle cx="12" cy="7" r="4"/><path d="M5 21v-2a7 7 0 0 1 14 0v2"/>}
@case('ticket'){<path d="M2 9a3 3 0 0 1 0 6v2a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-2a3 3 0 0 1 0-6V7a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2Z"/>}
@case('calendar'){<rect x="3" y="4" width="18" height="17" rx="2"/><path d="M8 2v4M16 2v4M3 10h18"/>}
@case('clock'){<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>}
@case('arrow'){<path d="M5 12h14m-6-6 6 6-6 6"/>}
@case('swap'){<path d="m16 3 4 4-4 4M20 7H4m4 14-4-4 4-4m-4 4h16"/>}
@case('seat'){<path d="M19 9V6a2 2 0 0 0-2-2H7a2 2 0 0 0-2 2v3M3 16a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-5a2 2 0 0 0-4 0v2H7v-2a2 2 0 0 0-4 0Z"/>}
@case('shield'){<path d="M20 13c0 5-3.5 7.5-8 9-4.5-1.5-8-4-8-9V6l8-3 8 3z"/><path d="m9 12 2 2 4-4"/>}
@case('check'){<path d="m5 12 4 4L19 6"/>}
@case('eye'){<path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>}
@case('eye-off'){<path d="m3 3 18 18"/><path d="M10.6 6.2A10.4 10.4 0 0 1 12 6c6.5 0 10 6 10 6a17 17 0 0 1-2.1 2.8M6.6 6.6C3.7 8.4 2 12 2 12s3.5 6 10 6c1.5 0 2.8-.3 4-.7"/><path d="M9.9 9.9A3 3 0 0 0 14.1 14.1"/>}
@case('menu'){<path d="M4 6h16M4 12h16M4 18h16"/>}
@default{<circle cx="12" cy="12" r="9"/>}
}</svg>`})
export class IconComponent{@Input() name='';@Input() size=20;}
