import { Routes } from '@angular/router';
import { staffGuard, adminOnlyGuard } from './core/guards/auth.guard';

export const routes: Routes = [
  // Client Portal
  {
    path: '',
    loadComponent: () =>
      import('./pages/home/home.component').then((m) => m.HomeComponent),
  },
  {
    path: 'results',
    loadComponent: () =>
      import('./pages/flight-results/flight-results.component').then(
        (m) => m.FlightResultsComponent,
      ),
  },
  {
    path: 'booking',
    loadComponent: () =>
      import('./pages/booking/booking.component').then((m) => m.BookingComponent),
  },
  {
    path: 'booking-success',
    loadComponent: () =>
      import('./pages/booking-success/booking-success.component').then(
        (m) => m.BookingSuccessComponent,
      ),
  },
  {
    path: 'track',
    loadComponent: () =>
      import('./pages/track-booking/track-booking.component').then(
        (m) => m.TrackBookingComponent,
      ),
  },
  {
    path: 'flight-lookup',
    loadComponent: () =>
      import('./pages/flight-lookup/flight-lookup.component').then(
        (m) => m.FlightLookupComponent,
      ),
  },
  {
    path: 'skymiles',
    loadComponent: () =>
      import('./pages/skymiles/skymiles.component').then(
        (m) => m.SkyMilesComponent,
      ),
  },

  // Admin & Clerk Portal
  {
    path: 'admin',
    canActivate: [staffGuard],
    loadComponent: () =>
      import('./admin/admin-layout/admin-layout.component').then(
        (m) => m.AdminLayoutComponent,
      ),
    children: [
      {
        path: '',
        redirectTo: 'dashboard',
        pathMatch: 'full',
      },
      {
        path: 'dashboard',
        loadComponent: () =>
          import('./admin/dashboard/dashboard.component').then(
            (m) => m.DashboardComponent,
          ),
      },
      {
        path: 'flights',
        canActivate: [adminOnlyGuard],
        loadComponent: () =>
          import('./admin/flights-manage/flights-manage.component').then(
            (m) => m.FlightsManageComponent,
          ),
      },
      {
        path: 'airlabs-sync',
        canActivate: [adminOnlyGuard],
        loadComponent: () =>
          import('./admin/airlabs-sync/airlabs-sync.component').then(
            (m) => m.AirlabsSyncComponent,
          ),
      },
      {
        path: 'airports',
        canActivate: [adminOnlyGuard],
        loadComponent: () =>
          import('./admin/airports-manage/airports-manage.component').then(
            (m) => m.AirportsManageComponent,
          ),
      },
      {
        path: 'bookings',
        loadComponent: () =>
          import('./admin/bookings-manage/bookings-manage.component').then(
            (m) => m.BookingsManageComponent,
          ),
      },
      {
        path: 'reservation-desk',
        loadComponent: () =>
          import('./admin/reservation-desk/reservation-desk.component').then(
            (m) => m.ReservationDeskComponent,
          ),
      },
      {
        path: 'users',
        canActivate: [adminOnlyGuard],
        loadComponent: () =>
          import('./admin/users-manage/users-manage.component').then(
            (m) => m.UsersManageComponent,
          ),
      },
      {
        path: 'policies',
        canActivate: [adminOnlyGuard],
        loadComponent: () =>
          import('./admin/policies-manage/policies-manage.component').then(
            (m) => m.PoliciesManageComponent,
          ),
      },
      {
        path: 'seat-operations',
        loadComponent: () =>
          import('./admin/seat-operations/seat-operations.component').then(
            (m) => m.SeatOperationsComponent,
          ),
      },
      {
        path: 'seat-pricing',
        canActivate: [adminOnlyGuard],
        loadComponent: () =>
          import('./admin/seat-pricing/seat-pricing.component').then(
            (m) => m.SeatPricingComponent,
          ),
      },
    ],
  },

  // Catch-all
  {
    path: '**',
    redirectTo: '',
  },
];
