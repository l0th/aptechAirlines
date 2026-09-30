import { Injectable, signal } from '@angular/core';

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
 search=signal<any>(null);
 selection=signal<any>(null);
 passengers=signal<any[]>([]);
 seatRequests=signal<any[]>([]);
 seatFeeTotal=signal(0);
 quote=signal<any>(null);
 staffCustomer=signal<any>(null);

 reset(){this.search.set(null);this.selection.set(null);this.passengers.set([]);this.seatRequests.set([]);this.seatFeeTotal.set(0);this.quote.set(null);this.staffCustomer.set(null)}
 beginStaffBooking(customer:any){this.search.set(null);this.selection.set(null);this.passengers.set([]);this.seatRequests.set([]);this.seatFeeTotal.set(0);this.quote.set(null);this.staffCustomer.set(customer)}
 beginSearch(search:any){this.search.set(search);this.selection.set(null);this.passengers.set([]);this.seatRequests.set([]);this.seatFeeTotal.set(0);this.quote.set(null)}

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
