import { effect, Injectable, signal } from '@angular/core';

export type BookingLeg = {
  flight_id:string;
  inventory_id:string;
  flight_number?:string;
  origin_iata?:string;
  dest_iata?:string;
  scheduled_departure?:string;
  scheduled_departure_local?:string;
  scheduled_arrival?:string;
  scheduled_arrival_local?:string;
  leg_type:string;
  [key:string]:any;
};

@Injectable({providedIn:'root'}) export class BookingStateService{
 private readonly draftStorageKey='aptech-airlines-booking-draft-v1';
 private readonly draftMaxAgeMs=12*60*60*1000;
 search=signal<any>(null);
 selection=signal<any>(null);
 passengers=signal<any[]>([]);
 seatRequests=signal<any[]>([]);
 seatFeeTotal=signal(0);
 quote=signal<any>(null);
 staffCustomer=signal<any>(null);

 constructor(){
  this.restoreDraft();
  effect(()=>{
   const draft={
    version:1,
    savedAt:Date.now(),
    search:this.search(),
    selection:this.selection(),
    passengers:this.passengers(),
    seatRequests:this.seatRequests(),
    seatFeeTotal:this.seatFeeTotal(),
    staffCustomer:this.staffCustomer(),
   };
   this.persistDraft(draft);
  });
 }

 reset(){this.search.set(null);this.selection.set(null);this.passengers.set([]);this.seatRequests.set([]);this.seatFeeTotal.set(0);this.quote.set(null);this.staffCustomer.set(null);this.removeDraft()}
 beginStaffBooking(customer:any){this.search.set(null);this.selection.set(null);this.passengers.set([]);this.seatRequests.set([]);this.seatFeeTotal.set(0);this.quote.set(null);this.staffCustomer.set(customer)}
 endStaffBooking(){this.reset()}
 beginSearch(search:any){this.search.set(search);this.selection.set(null);this.passengers.set([]);this.seatRequests.set([]);this.seatFeeTotal.set(0);this.quote.set(null)}

 private restoreDraft(){
  if(typeof sessionStorage==='undefined')return;
  try{
   const raw=sessionStorage.getItem(this.draftStorageKey);if(!raw)return;
   const draft=JSON.parse(raw);
   if(draft?.version!==1||!Number.isFinite(draft?.savedAt)||Date.now()-draft.savedAt>this.draftMaxAgeMs){this.removeDraft();return}
   this.search.set(draft.search??null);
   this.selection.set(draft.selection??null);
   this.passengers.set(Array.isArray(draft.passengers)?draft.passengers:[]);
   this.seatRequests.set(Array.isArray(draft.seatRequests)?draft.seatRequests:[]);
   this.seatFeeTotal.set(Number(draft.seatFeeTotal||0));
   this.staffCustomer.set(draft.staffCustomer??null);
  }catch{this.removeDraft()}
 }

 private persistDraft(draft:any){
  if(typeof sessionStorage==='undefined')return;
  try{
   const hasDraft=!!draft.search||!!draft.selection||draft.passengers.length>0||draft.seatRequests.length>0||!!draft.staffCustomer;
   if(hasDraft)sessionStorage.setItem(this.draftStorageKey,JSON.stringify(draft));else sessionStorage.removeItem(this.draftStorageKey);
  }catch{}
 }

 private removeDraft(){if(typeof sessionStorage==='undefined')return;try{sessionStorage.removeItem(this.draftStorageKey)}catch{}}

 selectedLegs():BookingLeg[]{return (this.selection()?.legs||[]).filter((l:any)=>l?.flight_id&&l?.inventory_id)}

 buildPayload(isBlock=false,payment_method?:string,userId='self'){
  const sel=this.selection();
  return{
   user_id:userId,
   booking_type:sel?.booking_type||'ONE_WAY',
   is_block:isBlock,
   passengers:this.passengers(),
   legs:this.selectedLegs().map((l:any)=>({flight_id:l.flight_id,inventory_id:l.inventory_id,leg_type:l.leg_type})),
   seat_requests:this.seatRequests(),
   ...(payment_method?{payment_method}:{}),
  }
 }
}
