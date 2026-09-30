import { Component, inject } from '@angular/core';import { RouterOutlet } from '@angular/router';import { AuthService } from './core/auth.service';
@Component({selector:'app-root',standalone:true,imports:[RouterOutlet],template:`<router-outlet/>`})export class AppComponent{constructor(){inject(AuthService).refresh()}}
