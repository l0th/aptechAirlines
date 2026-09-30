import { Injectable, computed, inject, signal } from '@angular/core';import { Router } from '@angular/router';import { tap } from 'rxjs';import { ApiService } from './api.service';
@Injectable({providedIn:'root'}) export class AuthService{
 private api=inject(ApiService);private router=inject(Router);token=signal<string|null>(localStorage.getItem('auth_token'));user=signal<any>(this.readUser());
 authenticated=computed(()=>!!this.token());role=computed(()=>this.user()?.role||'');staff=computed(()=>['CLERK','ADMIN','SUPER_ADMIN'].includes(this.role()));admin=computed(()=>['ADMIN','SUPER_ADMIN'].includes(this.role()));
 login(body:any){return this.api.login(body).pipe(tap(r=>this.set(r)))}register(body:any){return this.api.register(body).pipe(tap(r=>this.set(r)))}
 logout(){localStorage.removeItem('auth_token');localStorage.removeItem('auth_user');this.token.set(null);this.user.set(null);this.router.navigate(['/'])}
 refresh(){if(!this.token())return;this.api.me().subscribe({next:u=>{this.user.set(u);localStorage.setItem('auth_user',JSON.stringify(u))},error:e=>{if(e.status===401||e.status===403)this.logout()}})}
 private set(r:any){localStorage.setItem('auth_token',r.access_token);localStorage.setItem('auth_user',JSON.stringify(r.user));this.token.set(r.access_token);this.user.set(r.user)}
 private readUser(){try{return JSON.parse(localStorage.getItem('auth_user')||'null')}catch{return null}}
}
