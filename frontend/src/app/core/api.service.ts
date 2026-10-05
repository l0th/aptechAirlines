import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
@Injectable({providedIn:'root'})
export class ApiService{
 private http=inject(HttpClient); private base='/api';
 login(body:any){return this.http.post<any>(`${this.base}/auth/login`,body)}
 register(body:any){return this.http.post<any>(`${this.base}/auth/register`,body)}
 forgotPassword(email:string){return this.http.post<any>(`${this.base}/auth/forgot-password`,{email})}
 resetPassword(body:{email:string;code:string;new_password:string}){return this.http.post<any>(`${this.base}/auth/reset-password`,body)}
 me(){return this.http.get<any>(`${this.base}/auth/me`)}
 updateUser(id:string,body:any){return this.http.put<any>(`${this.base}/users/${id}`,body)}
 suggestLocations(q:string){return this.http.get<any>(`${this.base}/reference/suggest`,{params:{q}})}
 searchFlights(q:any){let p=new HttpParams();Object.entries(q).forEach(([k,v])=>{if(v!==undefined&&v!==null&&v!=='')p=p.set(k,String(v))});return this.http.get<any>(`${this.base}/flights/search`,{params:p})}
 bookingWindow(){return this.http.get<any>(`${this.base}/flights/booking-window`)}
 flightLookup(flight_number:string,date:string){return this.http.get<any>(`${this.base}/flights/lookup`,{params:{flight_number,date}})}
 seatMap(id:string){return this.http.get<any>(`${this.base}/flights/${id}/seat-map`)}
 quoteBooking(body:any){return this.http.post<any>(`${this.base}/bookings/quote`,body)}
 createBooking(body:any){return this.http.post<any>(`${this.base}/bookings`,body)}
 track(code:string){return this.http.get<any>(`${this.base}/bookings/track/${encodeURIComponent(code)}`)}
 myTrips(){return this.http.get<any[]>(`${this.base}/bookings/my-trips`)}
 confirm(body:any){return this.http.post<any>(`${this.base}/bookings/confirm`,body)}
 cancel(identifier:string,reason=''){return this.http.post<any>(`${this.base}/bookings/cancel`,{identifier,reason})}
 quoteReschedule(body:any){return this.http.post<any>(`${this.base}/bookings/reschedule/quote`,body)}
 reschedule(body:any){return this.http.post<any>(`${this.base}/bookings/reschedule`,body)}
 policies(){return this.http.get<any[]>(`${this.base}/policies`)}
 createPolicy(body:any){return this.http.post<any>(`${this.base}/policies`,body)}
 updatePolicy(id:string,body:any){return this.http.put<any>(`${this.base}/policies/${id}`,body)}
 deletePolicy(id:string){return this.http.delete<any>(`${this.base}/policies/${id}`)}
 paypalConfig(){return this.http.get<any>(`${this.base}/paypal/config`)}
 paypalCreate(body:any){return this.http.post<any>(`${this.base}/bookings/paypal/create-order`,body)}
 paypalCapture(checkout:string,order:string){return this.http.post<any>(`${this.base}/bookings/paypal/checkouts/${checkout}/capture`,{order_id:order})}
 paypalConfirmHoldCreate(body:any){return this.http.post<any>(`${this.base}/bookings/paypal/confirm-hold/create-order`,body)}
 paypalConfirmHoldCapture(checkout:string,order:string){return this.http.post<any>(`${this.base}/bookings/paypal/confirm-hold/${checkout}/capture`,{order_id:order})}
 paypalRescheduleCreate(body:any){return this.http.post<any>(`${this.base}/bookings/paypal/reschedule/create-order`,body)}
 paypalRescheduleCapture(checkout:string,order:string){return this.http.post<any>(`${this.base}/bookings/paypal/reschedule/${checkout}/capture`,{order_id:order})}
 users(){return this.http.get<any[]>(`${this.base}/users`)}
 createUser(body:any){return this.http.post<any>(`${this.base}/users`,body)}
 deleteUser(id:string){return this.http.delete<any>(`${this.base}/users/${encodeURIComponent(id)}`)}
 bookings(){return this.http.get<any[]>(`${this.base}/bookings`)}
 runBookingScheduler(job:'run-reminders'|'run-travel-reminders'|'run-expiry'){return this.http.post<any>(`${this.base}/bookings/scheduler/${job}`,{})}
 sendBookingReminder(id:string){return this.http.post<any>(`${this.base}/bookings/${encodeURIComponent(id)}/send-reminder`,{})}
 flights(){return this.http.get<any[]>(`${this.base}/flights`)}
 createFlight(body:any){return this.http.post<any>(`${this.base}/flights`,body)}
 updateFlight(id:string,body:any){return this.http.put<any>(`${this.base}/flights/${encodeURIComponent(id)}`,body)}
 updateFlightStatus(id:string,body:any){return this.http.patch<any>(`${this.base}/flights/${encodeURIComponent(id)}/status`,body)}
 deleteFlight(id:string){return this.http.delete<any>(`${this.base}/flights/${encodeURIComponent(id)}`)}
 airports(){return this.http.get<any[]>(`${this.base}/airports`)}
 createAirport(body:any){return this.http.post<any>(`${this.base}/airports`,body)}
 updateAirport(iata:string,body:any){return this.http.put<any>(`${this.base}/airports/${encodeURIComponent(iata)}`,body)}
 deleteAirport(iata:string){return this.http.delete<any>(`${this.base}/airports/${encodeURIComponent(iata)}`)}
 analytics(){return this.http.get<any>(`${this.base}/analytics/overview`)}
 analyticsCapacity(){return this.http.get<any>(`${this.base}/analytics/capacity`)}
 pricingProfiles(){return this.http.get<any[]>(`${this.base}/flights/pricing-profiles`)}
 createPricingProfile(body:any){return this.http.post<any>(`${this.base}/flights/pricing-profiles`,body)}
 updatePricingProfile(id:string,body:any){return this.http.patch<any>(`${this.base}/flights/pricing-profiles/${encodeURIComponent(id)}`,body)}
 deletePricingProfile(id:string){return this.http.delete<any>(`${this.base}/flights/pricing-profiles/${encodeURIComponent(id)}`)}
 assignPricingProfile(id:string,body:any){return this.http.post<any>(`${this.base}/flights/pricing-profiles/${encodeURIComponent(id)}/assign`,body)}
 getSeatPricingRules(){return this.http.get<any[]>(`${this.base}/seat-allocation/pricing-rules`)}
 createSeatPricingRule(body:any){return this.http.post<any>(`${this.base}/seat-allocation/pricing-rules`,body)}
 updateSeatPricingRule(id:string,body:any){return this.http.put<any>(`${this.base}/seat-allocation/pricing-rules/${encodeURIComponent(id)}`,body)}
 deleteSeatPricingRule(id:string){return this.http.delete<any>(`${this.base}/seat-allocation/pricing-rules/${id}`)}
 seatPricingProfiles(){return this.http.get<any[]>(`${this.base}/seat-allocation/pricing-profiles`)}
 createSeatPricingProfile(body:any){return this.http.post<any>(`${this.base}/seat-allocation/pricing-profiles`,body)}
 updateSeatPricingProfile(id:string,body:any){return this.http.put<any>(`${this.base}/seat-allocation/pricing-profiles/${encodeURIComponent(id)}`,body)}
 deleteSeatPricingProfile(id:string){return this.http.delete<any>(`${this.base}/seat-allocation/pricing-profiles/${encodeURIComponent(id)}`)}
 assignSeatPricingProfile(id:string,body:any){return this.http.post<any>(`${this.base}/seat-allocation/pricing-profiles/${encodeURIComponent(id)}/assign`,body)}
 seatOperationsMap(flightId:string,aircraftType:string){return this.http.get<any>(`${this.base}/seat-allocation/flight/${encodeURIComponent(flightId)}/map`,{params:{aircraftType}})}
 blockSeat(flightId:string,body:any){return this.http.post<any>(`${this.base}/seat-allocation/flight/${encodeURIComponent(flightId)}/block`,body)}
 unblockSeat(flightId:string,seat_code:string){return this.http.post<any>(`${this.base}/seat-allocation/flight/${encodeURIComponent(flightId)}/unblock`,{seat_code})}
 setSeatPriceOverride(flightId:string,body:any){return this.http.post<any>(`${this.base}/seat-allocation/flight/${encodeURIComponent(flightId)}/override-price`,body)}
 removeSeatPriceOverride(flightId:string,seatCode:string){return this.http.delete<any>(`${this.base}/seat-allocation/flight/${encodeURIComponent(flightId)}/override-price/${encodeURIComponent(seatCode)}`)}
 commercialTemplates(params:any={}){let p=new HttpParams();Object.entries(params).forEach(([k,v])=>{if(v!==undefined&&v!==null&&v!=='')p=p.set(k,String(v))});return this.http.get<any>(`${this.base}/flights/commercial-templates`,{params:p})}
 airlabsRoutes(params:any={}){let p=new HttpParams();Object.entries(params).forEach(([k,v])=>{if(v!==undefined&&v!==null&&v!=='')p=p.set(k,String(v))});return this.http.get<any>(`${this.base}/flights/airlabs-routes`,{params:p})}
 airlabsRoute(sourceKey:string){return this.http.get<any>(`${this.base}/flights/airlabs-routes/${encodeURIComponent(sourceKey)}`)}
 commercialAircraftLayouts(){return this.http.get<any[]>(`${this.base}/flights/commercial-aircraft-layouts`)}
 discoverCommercialNetwork(body:any){return this.http.post<any>(`${this.base}/flights/commercial-network-discovery`,body)}
 commercializeAirlabsRoute(body:any){return this.http.post<any>(`${this.base}/flights/commercialize-airlabs-route`,body)}
 updateCommercialTemplate(id:string,body:any){return this.http.patch<any>(`${this.base}/flights/commercial-templates/${encodeURIComponent(id)}`,body)}
 setCommercialTemplateStatus(id:string,is_active:boolean){return this.http.patch<any>(`${this.base}/flights/commercial-templates/${encodeURIComponent(id)}/status`,{is_active})}
 materializeCommercialTemplate(id:string,days_ahead:number,start_date?:string){return this.http.post<any>(`${this.base}/flights/commercial-templates/${encodeURIComponent(id)}/materialize`,{days_ahead,...(start_date?{start_date}:{})})}
}
