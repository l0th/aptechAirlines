import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { ApiService } from './api.service';

declare global {
  interface Window { paypal?: any; }
}

@Injectable({providedIn:'root'})
export class PaypalService {
  private api=inject(ApiService);
  private sdkPromise?:Promise<any>;
  private prepared?:{sdk:any;paypalEligible:boolean};

  private loadScript(environment:string):Promise<void>{
    if(window.paypal?.createInstance)return Promise.resolve();
    const src=environment==='sandbox'
      ? 'https://www.sandbox.paypal.com/web-sdk/v6/core'
      : 'https://www.paypal.com/web-sdk/v6/core';
    return new Promise((resolve,reject)=>{
      const existing=document.querySelector(`script[src="${src}"]`) as HTMLScriptElement|null;
      if(existing){existing.addEventListener('load',()=>resolve(),{once:true});existing.addEventListener('error',()=>reject(new Error('Không tải được PayPal Web SDK.')),{once:true});return;}
      const script=document.createElement('script');script.src=src;script.async=true;script.onload=()=>resolve();script.onerror=()=>reject(new Error('Không tải được PayPal Web SDK.'));document.head.appendChild(script);
    });
  }

  async sdk(){
    if(this.sdkPromise)return this.sdkPromise;
    this.sdkPromise=(async()=>{
      const cfg=await firstValueFrom(this.api.paypalConfig());
      if(!cfg?.enabled||!cfg?.client_id)throw new Error('PayPal Sandbox chưa được bật hoặc thiếu client id.');
      await this.loadScript(cfg.environment||'sandbox');
      if(!window.paypal?.createInstance)throw new Error('PayPal Web SDK không khởi tạo được.');
      return window.paypal.createInstance({clientId:cfg.client_id,components:['paypal-payments'],pageType:'checkout',locale:'en-US'});
    })().catch(e=>{this.sdkPromise=undefined;throw e});
    return this.sdkPromise;
  }

  async prepare(){
    if(this.prepared)return this.prepared.paypalEligible;
    const sdk=await this.sdk();
    const eligible=await sdk.findEligibleMethods({currencyCode:'USD'});
    this.prepared={sdk,paypalEligible:!!eligible?.isEligible('paypal')};
    return this.prepared.paypalEligible;
  }

  async pay(createOrder:()=>Promise<{orderId:string}>,approve:(orderId:string)=>Promise<void>){
    if(!this.prepared)await this.prepare();
    const sdk=this.prepared!.sdk;
    if(!this.prepared!.paypalEligible)throw new Error('PayPal không khả dụng cho phiên này.');
    let callbackError:any=null;
    const session=sdk.createPayPalOneTimePaymentSession({
      onApprove:async(data:any)=>{try{await approve(data.orderId)}catch(e){callbackError=e}},
      onCancel:()=>{callbackError=new Error('Bạn đã hủy thanh toán PayPal.')},
      onError:(e:any)=>{callbackError=e},
    });
    // PayPal Web SDK v6 validates the order argument with the page's global
    // Promise constructor. Angular/zone.js replaces window.Promise, while an
    // `async` callback still returns the browser's native Promise. Normalize
    // it through the patched global Promise so PayPal accepts it.
    const orderPromise=Promise.resolve(createOrder());
    await session.start({presentationMode:'auto'},orderPromise);
    if(callbackError)throw callbackError;
  }
}
