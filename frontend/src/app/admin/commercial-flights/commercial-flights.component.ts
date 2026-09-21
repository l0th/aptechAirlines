import { Component, OnInit, inject, signal, computed, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { ApiService } from '../../core/services/api.service';
import { LanguageService } from '../../core/services/language.service';
import { ToastService } from '../../shared/services/toast.service';
import { IconComponent } from '../../shared/components/icon/icon.component';
import {
  AirLabsRouteRef,
  CommercialAircraftLayout,
  CommercialScheduleTemplate,
  CommercializeRoutePayload,
  UpdateCommercialTemplatePayload,
  MaterializeTemplateResponse,
  CabinClass,
  CommercialNetworkDiscoveryResponse,
  CommercialNetworkItinerary,
  CommercialNetworkLeg,
} from '../../core/models/flight.model';

import { CommercialStepperComponent } from './components/commercial-stepper.component';
import { CommercialNetworkSearchComponent } from './components/commercial-network-search.component';
import { CommercialItineraryResultsComponent } from './components/commercial-itinerary-results.component';
import { CommercialSelectedJourneyComponent } from './components/commercial-selected-journey.component';
import { CommercialPublishScheduleComponent } from './components/commercial-publish-schedule.component';
import { CommercialAdvancedToolsComponent } from './components/commercial-advanced-tools.component';
import { CommercializeRouteDrawerComponent } from './components/commercialize-route-drawer.component';
import { TemplateEditDrawerComponent } from './components/template-edit-drawer.component';
import { SingleTemplateMaterializeModalComponent } from './components/single-template-materialize-modal.component';
import { RouteInspectDrawerComponent } from './components/route-inspect-drawer.component';
import { RouteSyncModalComponent } from './components/route-sync-modal.component';

@Component({
  selector: 'app-commercial-flights',
  standalone: true,
  imports: [
    CommonModule,
    IconComponent,
    CommercialStepperComponent,
    CommercialNetworkSearchComponent,
    CommercialItineraryResultsComponent,
    CommercialSelectedJourneyComponent,
    CommercialPublishScheduleComponent,
    CommercialAdvancedToolsComponent,
    CommercializeRouteDrawerComponent,
    TemplateEditDrawerComponent,
    SingleTemplateMaterializeModalComponent,
    RouteInspectDrawerComponent,
    RouteSyncModalComponent,
  ],
  template: `
    <div class="space-y-6">

      <!-- Header & Navigation -->
      <div class="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <div class="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-amber-500/15 border border-gold/40 text-gold text-xs font-semibold mb-2">
            <app-icon name="plane" class="w-3.5 h-3.5" />
            <span>{{ lang.t('admin.commercial.tag') }}</span>
          </div>
          <h1 class="text-2xl font-black text-navy">{{ lang.t('admin.commercial.title') }}</h1>
          <p class="text-xs text-slate-500 mt-1 max-w-2xl">
            {{ lang.t('admin.commercial.subtitle') }}
          </p>
        </div>
      </div>

      <!-- 4-Step Stepper -->
      <app-commercial-stepper
        [currentStep]="currentStep()"
        [step1Done]="step1Done()"
        [step2Done]="step2Done()"
        [step3Done]="step3Done()"
        [step4Done]="step4Done()"
        (stepClick)="onStepClick($event)"
      />

      <!-- STEP 1: Search Journey -->
      <app-commercial-network-search
        [origin]="discOrigin()"
        [destination]="discDestination()"
        [departureDate]="discDepartureDate()"
        [maxStops]="discMaxStops()"
        [isSearching]="isDiscovering()"
        (originChange)="discOrigin.set($event)"
        (destinationChange)="discDestination.set($event)"
        (departureDateChange)="discDepartureDate.set($event)"
        (maxStopsChange)="discMaxStops.set($event)"
        (searchSubmit)="searchNetworkDiscovery()"
      />

      <!-- STEP 2: Choose Itinerary -->
      @if (isDiscovering() || discoveryError() || discoveryResponse()) {
        <app-commercial-itinerary-results
          [isDiscovering]="isDiscovering()"
          [discoveryError]="discoveryError()"
          [discoveryResponse]="discoveryResponse()"
          [selectedItinerary]="selectedItinerary()"
          (itinerarySelect)="onSelectItinerary($event)"
        />
      }

      <!-- STEP 3 & STEP 4: Selected Journey Workspace -->
      @if (selectedItinerary(); as itin) {
        <!-- STEP 3: Create APTECH Flights -->
        <app-commercial-selected-journey
          [itinerary]="itin"
          [templateMap]="templateMapByRouteKey()"
          [loadingLegSourceKey]="loadingLegSourceKey()"
          [allCommercialized]="allCommercialized()"
          [allReadyToPublish]="allReadyToPublish()"
          [hasInactiveTemplate]="hasInactiveTemplate()"
          [uncommercializedCount]="uncommercializedCount()"
          (changeItinerary)="onChangeItinerary()"
          (configureLeg)="openCommercializeDrawerForLeg($event)"
          (createRemainingQueue)="startItineraryCommercializeQueue(itin)"
          (viewTemplate)="onViewTemplateFlightNumber($event)"
        />

        <!-- STEP 4: Publish Commercial Flight Schedule -->
        <app-commercial-publish-schedule
          [itinerary]="itin"
          [templateMap]="templateMapByRouteKey()"
          [readyToPublish]="allReadyToPublish()"
          [hasInactiveTemplate]="hasInactiveTemplate()"
          [days]="itineraryMaterializeDays()"
          [startDate]="itineraryMaterializeStartDate()"
          [isDaysValid]="isItineraryMaterializeDaysValid()"
          [submitting]="submittingItineraryMaterialize()"
          [progress]="itineraryMaterializeProgress()"
          [summary]="itineraryMaterializeSummary()"
          [hasErrors]="hasItineraryMaterializeErrors()"
          (daysChange)="onItineraryMaterializeDaysChange($event)"
          (startDateChange)="onItineraryMaterializeStartDateChange($event)"
          (generateSubmit)="executeItineraryMaterialize()"
          (viewFlights)="onViewFlights()"
          (viewTemplate)="onViewTemplateFlightNumber($event)"
        />
      }

      <!-- SECONDARY ADVANCED TOOLS (Collapsed by default) -->
      <app-commercial-advanced-tools
        #advancedTools
        [routes]="routes()"
        [routesLoading]="routesLoading()"
        [filterDep]="filterDep()"
        [filterArr]="filterArr()"
        [filterHasSchedule]="filterHasSchedule()"
        [routesPage]="routesPage()"
        [routesLimit]="routesLimit()"
        [routesTotal]="routesTotal()"
        [templates]="templates()"
        [filteredTemplates]="filteredTemplates()"
        [templatesLoading]="templatesLoading()"
        [templateSearch]="templateSearch()"
        [matchingRoutesCount]="matchingRoutesCount()"
        [activeTemplatesCount]="activeTemplatesCount()"
        [commercializedRoutesCount]="commercializedRoutesCount()"
        (filterDepChange)="filterDep.set($event)"
        (filterArrChange)="filterArr.set($event)"
        (filterHasScheduleChange)="onFilterHasScheduleChange($event)"
        (loadRoutes)="loadRoutes($event)"
        (openSyncModal)="openSyncModal()"
        (inspectRoute)="inspectRoute($event)"
        (templateSearchChange)="templateSearch.set($event)"
        (toggleTemplateStatus)="onToggleTemplateStatus($event)"
        (openEditTemplate)="openEditDrawer($event)"
        (openMaterializeTemplate)="openMaterializeModal($event)"
      />

      <!-- DRAWERS & MODALS -->
      @if (commercializingRoute(); as cr) {
        <app-commercialize-route-drawer
          [route]="cr"
          [queue]="commercializeQueue()"
          [aircraftLayouts]="aircraftLayouts()"
          [formFlightNumber]="formFlightNumber()"
          [formAircraftType]="formAircraftType()"
          [formSelectedCabins]="formSelectedCabins()"
          [formAllocatedSeats]="formAllocatedSeats()"
          [formBasePrices]="formBasePrices()"
          [formMaterializeImmediately]="formMaterializeImmediately()"
          [formIncompatibleCabins]="formIncompatibleCabins()"
          [formOvercapacityDetails]="formOvercapacityDetails()"
          [selectedAircraftLayout]="selectedAircraftLayout()"
          [isFormValid]="isCommercializeFormValid()"
          [submitting]="submittingCommercialize()"
          (closeDrawer)="closeCommercializeDrawer()"
          (cancelQueue)="closeCommercializeDrawer()"
          (flightNumberChange)="formFlightNumber.set($event)"
          (aircraftTypeChange)="onAircraftTypeSelected($event)"
          (toggleCabin)="toggleCabinSelection($event)"
          (allocatedSeatsChange)="updateAllocatedSeats($event.cabin, $event.count)"
          (basePriceChange)="updateBasePrice($event.cabin, $event.price)"
          (materializeImmediatelyChange)="formMaterializeImmediately.set($event)"
          (removeIncompatibleCabins)="removeIncompatibleFormCabins()"
          (submitCommercialize)="submitCommercialize()"
        />
      }

      @if (editingTemplate(); as et) {
        <app-template-edit-drawer
          [template]="et"
          [aircraftLayouts]="aircraftLayouts()"
          [editFlightNumber]="editFlightNumber()"
          [editAircraftType]="editAircraftType()"
          [editSelectedCabins]="editSelectedCabins()"
          [editAllocatedSeats]="editAllocatedSeats()"
          [editBasePrices]="editBasePrices()"
          [editIsActive]="editIsActive()"
          [submittingEdit]="submittingEdit()"
          [editIncompatibleCabins]="editIncompatibleCabins()"
          [editOvercapacityDetails]="editOvercapacityDetails()"
          [editAircraftLayout]="editAircraftLayout()"
          [isEditFormValid]="isEditFormValid()"
          (closeDrawer)="editingTemplate.set(null)"
          (flightNumberChange)="editFlightNumber.set($event)"
          (aircraftTypeChange)="onEditAircraftTypeSelected($event)"
          (toggleCabin)="toggleEditCabinSelection($event)"
          (allocatedSeatsChange)="updateEditAllocatedSeats($event.cabin, $event.count)"
          (basePriceChange)="updateEditBasePrice($event.cabin, $event.price)"
          (isActiveChange)="editIsActive.set($event)"
          (removeIncompatibleCabins)="removeIncompatibleEditCabins()"
          (saveEdit)="saveTemplateEdit()"
        />
      }

      @if (materializingTemplate(); as mt) {
        <app-single-template-materialize-modal
          [template]="mt"
          [days]="materializeDays()"
          [startDate]="materializeStartDate()"
          [isDaysValid]="isMaterializeDaysValid()"
          [submitting]="submittingMaterialize()"
          [materializeResult]="materializeResult()"
          (closeModal)="closeMaterializeModal()"
          (daysChange)="materializeDays.set($event)"
          (startDateChange)="materializeStartDate.set($event)"
          (executeMaterialize)="executeMaterialize()"
        />
      }

      @if (inspectingRoute(); as ir) {
        <app-route-inspect-drawer
          [route]="ir"
          (closeDrawer)="inspectingRoute.set(null)"
        />
      }

      @if (syncModalOpen()) {
        <app-route-sync-modal
          [depIata]="syncDepIata()"
          [limit]="syncLimit()"
          [syncing]="syncing()"
          (closeModal)="syncModalOpen.set(false)"
          (depIataChange)="syncDepIata.set($event)"
          (limitChange)="syncLimit.set($event)"
          (executeSync)="executeAirportSync()"
        />
      }

    </div>
  `,
})
export class CommercialFlightsComponent implements OnInit {
  readonly api = inject(ApiService);
  readonly lang = inject(LanguageService);
  private readonly toast = inject(ToastService);
  private readonly router = inject(Router);

  @ViewChild('advancedTools') advancedTools?: CommercialAdvancedToolsComponent;

  // STEP 1: Discovery Search Parameters
  discOrigin = signal<string>('HAN');
  discDestination = signal<string>('SGN');
  discDepartureDate = signal<string>(new Date().toISOString().slice(0, 10));
  discMaxStops = signal<number | null>(null);
  isDiscovering = signal<boolean>(false);
  discoveryResponse = signal<CommercialNetworkDiscoveryResponse | null>(null);
  discoveryError = signal<string | null>(null);

  // STEP 2 & 3: Selected Itinerary & Leg Queue State
  selectedItinerary = signal<CommercialNetworkItinerary | null>(null);
  loadingLegSourceKey = signal<string | null>(null);
  commercializeQueue = signal<{
    itineraryKey: string;
    legs: CommercialNetworkLeg[];
    currentIndex: number;
  } | null>(null);

  // STEP 4: Itinerary Materialization State
  itineraryMaterializeDays = signal<number>(30);
  itineraryMaterializeStartDate = signal<string>('');
  submittingItineraryMaterialize = signal<boolean>(false);
  itineraryMaterializeProgress = signal<
    Array<{
      legIndex: number;
      flightNumber: string;
      status: 'PENDING' | 'RUNNING' | 'SUCCESS' | 'ERROR';
      stats?: MaterializeTemplateResponse;
      error?: string;
    }>
  >([]);
  itineraryMaterializeSummary = signal<{
    totalInserted: number;
    totalMatched: number;
    completedCount: number;
  } | null>(null);

  hasItineraryMaterializeErrors = computed(() => {
    return this.itineraryMaterializeProgress().some((p) => p.status === 'ERROR');
  });

  // Global Catalogs & KPIs
  templates = signal<CommercialScheduleTemplate[]>([]);
  matchingRoutesCount = signal<number>(0);
  aircraftLayouts = signal<CommercialAircraftLayout[]>([]);

  activeTemplatesCount = computed(() => this.templates().filter((t) => t.is_active).length);
  commercializedRoutesCount = computed(() => {
    const set = new Set(this.templates().map((t) => t.source_route_key).filter(Boolean));
    return set.size;
  });

  templateMapByRouteKey = computed(() => {
    const map = new Map<string, CommercialScheduleTemplate>();
    for (const t of this.templates()) {
      if (t.source_route_key) {
        map.set(t.source_route_key, t);
      }
    }
    return map;
  });

  // Derived Predicates for Progressive Disclosure
  allCommercialized = computed(() => {
    const itin = this.selectedItinerary();
    if (!itin || !itin.legs || itin.legs.length === 0) return false;
    const map = this.templateMapByRouteKey();
    return itin.legs.every((l) => map.has(l.source_key));
  });

  allReadyToPublish = computed(() => {
    const itin = this.selectedItinerary();
    if (!itin || !itin.legs || itin.legs.length === 0) return false;
    const map = this.templateMapByRouteKey();
    return itin.legs.every((l) => {
      const tpl = map.get(l.source_key);
      return !!tpl && tpl.is_active === true;
    });
  });

  hasInactiveTemplate = computed(() => {
    const itin = this.selectedItinerary();
    if (!itin || !itin.legs) return false;
    const map = this.templateMapByRouteKey();
    return itin.legs.some((l) => {
      const tpl = map.get(l.source_key);
      return !!tpl && !tpl.is_active;
    });
  });

  uncommercializedCount = computed(() => {
    const itin = this.selectedItinerary();
    if (!itin || !itin.legs) return 0;
    const map = this.templateMapByRouteKey();
    return itin.legs.filter((l) => !map.has(l.source_key)).length;
  });

  // Stepper State
  step1Done = computed(() => {
    const resp = this.discoveryResponse();
    return !!resp && Array.isArray(resp.itineraries) && resp.itineraries.length > 0;
  });

  step2Done = computed(() => {
    return this.selectedItinerary() !== null;
  });

  step3Done = computed(() => {
    return this.selectedItinerary() !== null && this.allReadyToPublish();
  });

  step4Done = computed(() => {
    const sum = this.itineraryMaterializeSummary();
    const itin = this.selectedItinerary();
    if (!sum || !itin) return false;
    return sum.completedCount === itin.legs.length && !this.hasItineraryMaterializeErrors();
  });

  currentStep = computed(() => {
    if (this.step4Done()) return 4;
    if (this.selectedItinerary() !== null && this.allReadyToPublish()) return 4;
    if (this.selectedItinerary() !== null) return 3;
    if (this.step1Done()) return 2;
    return 1;
  });

  // Secondary Tools: RouteRef Explorer State
  routes = signal<AirLabsRouteRef[]>([]);
  routesLoading = signal<boolean>(false);
  filterDep = signal<string>('');
  filterArr = signal<string>('');
  filterHasSchedule = signal<boolean>(true);
  routesPage = signal<number>(1);
  routesLimit = signal<number>(20);
  routesTotal = signal<number>(0);
  inspectingRoute = signal<AirLabsRouteRef | null>(null);

  // Secondary Tools: Templates Catalog State
  templatesLoading = signal<boolean>(false);
  templateSearch = signal<string>('');
  filteredTemplates = computed(() => {
    const q = this.templateSearch().toLowerCase().trim();
    if (!q) return this.templates();
    return this.templates().filter(
      (t) =>
        t.flight_number.toLowerCase().includes(q) ||
        t.template_id.toLowerCase().includes(q) ||
        t.origin_iata.toLowerCase().includes(q) ||
        t.dest_iata.toLowerCase().includes(q) ||
        (t.aircraft_type && t.aircraft_type.toLowerCase().includes(q)),
    );
  });

  // Single Airport Sync Modal State
  syncModalOpen = signal<boolean>(false);
  syncDepIata = signal<string>('SGN');
  syncLimit = signal<number>(200);
  syncing = signal<boolean>(false);

  // Commercialize Route Drawer Form State
  commercializingRoute = signal<AirLabsRouteRef | null>(null);
  formFlightNumber = signal<string>('');
  formAircraftType = signal<string>('');
  formSelectedCabins = signal<Set<CabinClass>>(new Set([CabinClass.ECONOMY]));
  formAllocatedSeats = signal<Record<string, number>>({});
  formBasePrices = signal<Record<string, number | null>>({ [CabinClass.ECONOMY]: null });
  formMaterializeImmediately = signal<boolean>(false);
  submittingCommercialize = signal<boolean>(false);
  formIncompatibleCabins = signal<CabinClass[]>([]);
  formOvercapacityDetails = signal<Array<{ cabin: string; allocated: number; max: number }>>([]);

  selectedAircraftLayout = computed(() => {
    const code = this.formAircraftType();
    return this.aircraftLayouts().find((l) => l.aircraft_type === code) || null;
  });

  // Edit Template Drawer Form State
  editingTemplate = signal<CommercialScheduleTemplate | null>(null);
  editFlightNumber = signal<string>('');
  editAircraftType = signal<string>('');
  editSelectedCabins = signal<Set<CabinClass>>(new Set());
  editAllocatedSeats = signal<Record<string, number>>({});
  editBasePrices = signal<Record<string, number | null>>({});
  editIsActive = signal<boolean>(true);
  submittingEdit = signal<boolean>(false);
  editIncompatibleCabins = signal<CabinClass[]>([]);
  editOvercapacityDetails = signal<Array<{ cabin: string; allocated: number; max: number }>>([]);

  editAircraftLayout = computed(() => {
    const code = this.editAircraftType();
    return this.aircraftLayouts().find((l) => l.aircraft_type === code) || null;
  });

  // Single Template Materialize Modal State
  materializingTemplate = signal<CommercialScheduleTemplate | null>(null);
  materializeDays = signal<number>(30);
  materializeStartDate = signal<string>('');
  submittingMaterialize = signal<boolean>(false);
  materializeResult = signal<MaterializeTemplateResponse | null>(null);

  ngOnInit(): void {
    this.loadAircraftLayouts();
    this.refreshTemplatesCatalog();
    this.loadRoutes(1);
  }

  // ===================== AIRCRAFT LAYOUTS =====================
  loadAircraftLayouts(): void {
    this.api.getCommercialAircraftLayouts().subscribe({
      next: (layouts) => {
        this.aircraftLayouts.set(layouts || []);
      },
      error: (err) => {
        this.toast.show(err?.error?.message || this.lang.t('admin.commercial.errorLoadLayouts'), 'error');
      },
    });
  }

  // ===================== TEMPLATES CATALOG =====================
  refreshTemplatesCatalog(): void {
    this.templatesLoading.set(true);
    this.api.fetchAllCommercialTemplates().subscribe({
      next: (allTemplates) => {
        this.templates.set(allTemplates || []);
        this.templatesLoading.set(false);
      },
      error: (err) => {
        this.templatesLoading.set(false);
        this.toast.show(err?.error?.message || this.lang.t('admin.commercial.errorLoadTemplates'), 'error');
      },
    });
  }

  // ===================== ROUTEREF EXPLORER =====================
  loadRoutes(page = 1): void {
    this.routesPage.set(page);
    this.routesLoading.set(true);
    const offset = (page - 1) * this.routesLimit();

    this.api
      .getAirLabsRoutes({
        dep_iata: this.filterDep() || undefined,
        arr_iata: this.filterArr() || undefined,
        has_schedule: this.filterHasSchedule(),
        limit: this.routesLimit(),
        offset,
      })
      .subscribe({
        next: (res) => {
          this.routes.set(res.items || []);
          this.routesTotal.set(res.total || 0);
          this.matchingRoutesCount.set(res.total || 0);
          this.routesLoading.set(false);
        },
        error: (err) => {
          this.routesLoading.set(false);
          this.toast.show(err?.error?.message || this.lang.t('admin.commercial.errorLoadRoutes'), 'error');
        },
      });
  }

  onFilterHasScheduleChange(val: boolean): void {
    this.filterHasSchedule.set(val);
    this.loadRoutes(1);
  }

  inspectRoute(r: AirLabsRouteRef): void {
    this.inspectingRoute.set(r);
  }

  // ===================== STEP 1: DISCOVERY SEARCH =====================
  searchNetworkDiscovery(): void {
    const origin = this.discOrigin().trim();
    const dest = this.discDestination().trim();
    const date = this.discDepartureDate().trim();

    if (!origin || !dest || !date) {
      return;
    }

    // Reset transient workflow state as required by Plan Review item 3
    this.selectedItinerary.set(null);
    this.commercializeQueue.set(null);
    this.commercializingRoute.set(null);
    this.loadingLegSourceKey.set(null);
    this.itineraryMaterializeSummary.set(null);
    this.itineraryMaterializeProgress.set([]);

    this.isDiscovering.set(true);
    this.discoveryError.set(null);
    this.discoveryResponse.set(null);

    this.api
      .discoverCommercialNetwork({
        origin,
        destination: dest,
        departure_date: date,
        max_stops: this.discMaxStops() ?? undefined,
      })
      .subscribe({
        next: (resp) => {
          this.isDiscovering.set(false);
          this.discoveryResponse.set(resp);
        },
        error: (err) => {
          this.isDiscovering.set(false);
          this.discoveryError.set(
            err?.error?.message || this.lang.t('admin.commercial.discErrorGeneric'),
          );
        },
      });
  }

  // ===================== STEP 2 & 3: ITINERARY SELECTION =====================
  onSelectItinerary(itin: CommercialNetworkItinerary): void {
    this.selectedItinerary.set(itin);
    this.commercializeQueue.set(null);
    this.itineraryMaterializeSummary.set(null);
    const defaultStartDate =
      this.discoveryResponse()?.departure_date || this.discDepartureDate() || new Date().toISOString().slice(0, 10);
    this.itineraryMaterializeStartDate.set(defaultStartDate);
    this.initializeItineraryMaterializeProgress(itin);
  }

  onChangeItinerary(): void {
    this.selectedItinerary.set(null);
    this.commercializeQueue.set(null);
    this.loadingLegSourceKey.set(null);
    this.itineraryMaterializeSummary.set(null);
    this.itineraryMaterializeProgress.set([]);
  }

  onStepClick(step: number): void {
    if (step === 1) {
      // Step 1: Keep current search or let admin adjust
    } else if (step === 2) {
      // Allow returning to itinerary results
      this.selectedItinerary.set(null);
      this.commercializeQueue.set(null);
      this.loadingLegSourceKey.set(null);
    }
  }

  onViewTemplateFlightNumber(flightNumber: string): void {
    this.templateSearch.set(flightNumber);
    if (this.advancedTools) {
      this.advancedTools.isOpen.set(true);
      this.advancedTools.activeSubTab.set('templates');
    }
  }

  onViewFlights(): void {
    this.router.navigate(['/admin/flights']);
  }

  // ===================== COMMERCIALIZATION DRAWER & QUEUE =====================
  generateSuggestedFlightNumber(sourceFlightStr: string, queueOffset: number = 0): string {
    const digits = (sourceFlightStr || '').replace(/\D/g, '');
    let num = digits ? parseInt(digits, 10) : 100;
    if (isNaN(num) || num <= 0) num = 100;
    num += queueOffset;

    const existingFlightNumbers = new Set(this.templates().map((t) => t.flight_number.toUpperCase()));
    while (existingFlightNumbers.has(`APT${num}`)) {
      num++;
    }
    return `APT${num}`;
  }

  openCommercializeDrawer(r: AirLabsRouteRef, queueIndex: number = -1): void {
    this.commercializingRoute.set(r);
    this.formMaterializeImmediately.set(false);
    this.formIncompatibleCabins.set([]);
    this.formOvercapacityDetails.set([]);

    const offset = queueIndex >= 0 ? queueIndex : 0;
    const aptNumber = this.generateSuggestedFlightNumber(r.flight_number || r.flight_iata || '', offset);
    this.formFlightNumber.set(aptNumber);

    const defaultLayout = this.aircraftLayouts().find((l) => l.aircraft_type === 'A21N') || this.aircraftLayouts()[0];
    if (defaultLayout) {
      this.formAircraftType.set(defaultLayout.aircraft_type);
      const newCabins = new Set<CabinClass>([CabinClass.ECONOMY]);
      if (defaultLayout.supported_cabins.includes('BUSINESS')) {
        newCabins.add(CabinClass.BUSINESS);
      }
      this.formSelectedCabins.set(newCabins);

      const seats: Record<string, number> = {};
      for (const c of defaultLayout.supported_cabins) {
        seats[c] = defaultLayout.cabin_capacities[c] || 0;
      }
      this.formAllocatedSeats.set(seats);

      this.formBasePrices.set({
        [CabinClass.ECONOMY]: null,
        [CabinClass.BUSINESS]: null,
        [CabinClass.CLUB]: null,
        [CabinClass.FIRST]: null,
      });
      this.formIncompatibleCabins.set([]);
      this.formOvercapacityDetails.set([]);
    }
  }

  closeCommercializeDrawer(): void {
    this.commercializeQueue.set(null);
    this.commercializingRoute.set(null);
  }

  openCommercializeDrawerForLeg(leg: CommercialNetworkLeg, queueIndex: number = -1): void {
    const reqKey = leg.source_key;
    this.loadingLegSourceKey.set(reqKey);
    this.api.getAirLabsRouteBySourceKey(reqKey).subscribe({
      next: (routeRef) => {
        if (this.loadingLegSourceKey() !== reqKey) return;
        this.loadingLegSourceKey.set(null);
        this.openCommercializeDrawer(routeRef, queueIndex);
      },
      error: () => {
        if (this.loadingLegSourceKey() !== reqKey) return;
        this.loadingLegSourceKey.set(null);
        this.toast.show(this.lang.t('admin.commercial.errorLoadRouteRef'), 'error');
      },
    });
  }

  startItineraryCommercializeQueue(itinerary: CommercialNetworkItinerary): void {
    const pendingLegs = itinerary.legs.filter((l) => !this.isLegCommercialized(l));
    if (pendingLegs.length === 0) {
      this.toast.show(this.lang.t('admin.commercial.allLegsCommercialized'), 'info');
      return;
    }
    this.commercializeQueue.set({
      itineraryKey: this.itinTrackKey(itinerary),
      legs: pendingLegs,
      currentIndex: 0,
    });
    this.openCommercializeDrawerForLeg(pendingLegs[0], 0);
  }

  onAircraftTypeSelected(aircraftType: string): void {
    this.formAircraftType.set(aircraftType);
    const layout = this.aircraftLayouts().find((l) => l.aircraft_type === aircraftType);
    if (!layout) return;
    this.recheckFormIncompatibility(layout);
  }

  removeIncompatibleFormCabins(): void {
    const incomp = new Set(this.formIncompatibleCabins());
    const remaining = new Set(
      Array.from(this.formSelectedCabins()).filter((c) => !incomp.has(c)),
    );
    this.formSelectedCabins.set(remaining);

    const seats = { ...this.formAllocatedSeats() };
    const prices = { ...this.formBasePrices() };
    for (const c of incomp) {
      delete seats[c];
      delete prices[c];
    }
    this.formAllocatedSeats.set(seats);
    this.formBasePrices.set(prices);

    const layout = this.selectedAircraftLayout();
    if (layout) {
      this.recheckFormIncompatibility(layout);
    }
  }

  toggleCabinSelection(cabin: CabinClass): void {
    if (cabin === CabinClass.ECONOMY) return; // Economy is mandatory
    const set = new Set(this.formSelectedCabins());
    if (set.has(cabin)) {
      set.delete(cabin);
    } else {
      set.add(cabin);
    }
    this.formSelectedCabins.set(set);

    const layout = this.selectedAircraftLayout();
    if (layout) {
      const seats = { ...this.formAllocatedSeats() };
      if (!seats[cabin]) {
        seats[cabin] = layout.cabin_capacities[cabin] || 0;
        this.formAllocatedSeats.set(seats);
      }
      this.recheckFormIncompatibility(layout);
    }
  }

  updateAllocatedSeats(cabin: string, val: number): void {
    const current = { ...this.formAllocatedSeats() };
    current[cabin] = val;
    this.formAllocatedSeats.set(current);
    const layout = this.selectedAircraftLayout();
    if (layout) {
      this.recheckFormIncompatibility(layout);
    }
  }

  updateBasePrice(cabin: string, val: number | null): void {
    const current = { ...this.formBasePrices() };
    current[cabin] = val;
    this.formBasePrices.set(current);
  }

  private recheckFormIncompatibility(layout: CommercialAircraftLayout): void {
    const incompCabins: CabinClass[] = [];
    const overcap: Array<{ cabin: string; allocated: number; max: number }> = [];

    for (const c of this.formSelectedCabins()) {
      if (!layout.supported_cabins.includes(c)) {
        incompCabins.push(c);
      } else {
        const cap = layout.cabin_capacities[c] || 0;
        const curSeats = this.formAllocatedSeats()[c];
        if (curSeats && curSeats > cap) {
          overcap.push({ cabin: c, allocated: curSeats, max: cap });
        }
      }
    }
    this.formIncompatibleCabins.set(incompCabins);
    this.formOvercapacityDetails.set(overcap);
  }

  isCommercializeFormValid(): boolean {
    const flNum = this.formFlightNumber().trim();
    if (!/^APT[A-Z0-9]+$/i.test(flNum)) return false;

    const layout = this.selectedAircraftLayout();
    if (!layout) return false;

    if (this.formIncompatibleCabins().length > 0) return false;
    if (this.formOvercapacityDetails().length > 0) return false;

    const ecoPrice = this.formBasePrices()[CabinClass.ECONOMY];
    if (ecoPrice === null || ecoPrice === undefined || isNaN(Number(ecoPrice)) || Number(ecoPrice) < 0) return false;

    if (!this.formSelectedCabins().has(CabinClass.ECONOMY)) return false;

    for (const c of this.formSelectedCabins()) {
      if (!layout.supported_cabins.includes(c)) return false;

      const seats = this.formAllocatedSeats()[c];
      const maxCap = layout.cabin_capacities[c] || 0;
      if (!seats || seats < 1 || seats > maxCap) return false;

      if (c !== CabinClass.ECONOMY) {
        const p = this.formBasePrices()[c];
        if (p !== null && p !== undefined && p !== ('' as any) && (isNaN(Number(p)) || Number(p) <= 0)) return false;
      }
    }

    return true;
  }

  submitCommercialize(): void {
    const r = this.commercializingRoute();
    if (!r || !this.isCommercializeFormValid()) return;

    this.submittingCommercialize.set(true);

    const cabinClasses = Array.from(this.formSelectedCabins());
    const inventories = cabinClasses.map((c) => ({
      cabin_class: c,
      allocated_seats: this.formAllocatedSeats()[c] || 0,
    }));

    const prices = this.formBasePrices();
    const ecoPrice = Number(prices[CabinClass.ECONOMY]);

    const payload: CommercializeRoutePayload = {
      source_key: r.source_key,
      aptech_flight_number: this.formFlightNumber().trim().toUpperCase(),
      aircraft_type: this.formAircraftType(),
      base_price_economy: ecoPrice,
      base_price_business:
        prices[CabinClass.BUSINESS] !== null &&
        prices[CabinClass.BUSINESS] !== undefined &&
        prices[CabinClass.BUSINESS] !== ('' as any)
          ? Number(prices[CabinClass.BUSINESS])
          : undefined,
      base_price_club:
        prices[CabinClass.CLUB] !== null &&
        prices[CabinClass.CLUB] !== undefined &&
        prices[CabinClass.CLUB] !== ('' as any)
          ? Number(prices[CabinClass.CLUB])
          : undefined,
      base_price_first:
        prices[CabinClass.FIRST] !== null &&
        prices[CabinClass.FIRST] !== undefined &&
        prices[CabinClass.FIRST] !== ('' as any)
          ? Number(prices[CabinClass.FIRST])
          : undefined,
      cabin_classes: cabinClasses,
      inventories,
    };

    this.api.commercializeAirLabsRoute(payload).subscribe({
      next: (createdTemplate) => {
        this.toast.show(
          this.lang
            .t('admin.commercial.templateCreated')
            .replace('{route}', `${r.dep_iata} → ${r.arr_iata}`)
            .replace('{flightNumber}', createdTemplate.flight_number || createdTemplate.template_id),
          'success',
        );

        this.templates.update((list) => [...list, createdTemplate]);
        this.refreshTemplatesCatalog();

        const curItin = this.selectedItinerary();
        if (curItin) {
          this.initializeItineraryMaterializeProgress(curItin);
        }

        const proceedAfterMaterialize = () => {
          const q = this.commercializeQueue();
          if (q) {
            let nextIndex = q.currentIndex + 1;
            while (nextIndex < q.legs.length && this.isLegCommercialized(q.legs[nextIndex])) {
              nextIndex++;
            }
            if (nextIndex < q.legs.length) {
              this.commercializeQueue.set({ ...q, currentIndex: nextIndex });
              this.submittingCommercialize.set(false);
              this.openCommercializeDrawerForLeg(q.legs[nextIndex], nextIndex);
              return;
            } else {
              this.toast.show(
                this.lang.t('admin.commercial.queueComplete').replace('{total}', String(q.legs.length)),
                'success',
              );
              this.commercializeQueue.set(null);
              this.submittingCommercialize.set(false);
              this.commercializingRoute.set(null);
              return;
            }
          }
          this.submittingCommercialize.set(false);
          this.commercializingRoute.set(null);
        };

        if (this.formMaterializeImmediately()) {
          this.api.materializeCommercialTemplate(createdTemplate.template_id, { days_ahead: 30 }).subscribe({
            next: (matRes) => {
              this.toast.show(
                this.lang
                  .t('admin.commercial.materializeSuccess')
                  .replace('{inserted}', matRes.inserted_count.toString())
                  .replace('{matched}', matRes.matched_count.toString()),
                'success',
              );
              proceedAfterMaterialize();
            },
            error: (matErr) => {
              this.toast.show(
                `${this.lang.t('admin.commercial.partialMaterializeWarn')} (${matErr?.error?.message || this.lang.t('admin.commercial.errorMaterializeGeneric')})`,
                'warning',
              );
              proceedAfterMaterialize();
            },
          });
        } else {
          proceedAfterMaterialize();
        }
      },
      error: (err) => {
        this.submittingCommercialize.set(false);
        this.toast.show(err?.error?.message || this.lang.t('admin.commercial.errorCommercialize'), 'error');
      },
    });
  }

  // ===================== STEP 4: ITINERARY MATERIALIZE =====================
  onItineraryMaterializeDaysChange(newDays: number): void {
    if (this.itineraryMaterializeDays() === newDays) return;
    this.itineraryMaterializeDays.set(newDays);
    this.itineraryMaterializeSummary.set(null);
    const itin = this.selectedItinerary();
    if (itin) {
      this.initializeItineraryMaterializeProgress(itin);
    }
  }

  onItineraryMaterializeStartDateChange(newDate: string): void {
    if (this.itineraryMaterializeStartDate() === newDate) return;
    this.itineraryMaterializeStartDate.set(newDate);
    this.itineraryMaterializeSummary.set(null);
    const itin = this.selectedItinerary();
    if (itin) {
      this.initializeItineraryMaterializeProgress(itin);
    }
  }

  initializeItineraryMaterializeProgress(itin: CommercialNetworkItinerary): void {
    const map = this.templateMapByRouteKey();
    const progress = itin.legs.map((leg, idx) => {
      const tpl = map.get(leg.source_key);
      return {
        legIndex: idx,
        flightNumber: tpl ? tpl.flight_number : leg.flight_iata || leg.flight_number || `APT-Leg${idx + 1}`,
        status: 'PENDING' as const,
      };
    });
    this.itineraryMaterializeProgress.set(progress);
  }

  isItineraryMaterializeDaysValid(): boolean {
    const d = this.itineraryMaterializeDays();
    return Number.isInteger(d) && d >= 1 && d <= 330;
  }

  async executeItineraryMaterialize(): Promise<void> {
    const itin = this.selectedItinerary();
    if (!itin || !this.isItineraryMaterializeDaysValid() || !this.allReadyToPublish()) return;

    const days = this.itineraryMaterializeDays();
    const startDate = this.itineraryMaterializeStartDate().trim() || undefined;

    this.submittingItineraryMaterialize.set(true);

    let totalInserted = 0;
    let totalMatched = 0;
    let successCount = 0;

    if (this.itineraryMaterializeProgress().length !== itin.legs.length) {
      this.initializeItineraryMaterializeProgress(itin);
    }

    for (let i = 0; i < itin.legs.length; i++) {
      const currentProgress = this.itineraryMaterializeProgress().find((p) => p.legIndex === i);
      if (currentProgress && currentProgress.status === 'SUCCESS') {
        if (currentProgress.stats) {
          totalInserted += currentProgress.stats.inserted_count || 0;
          totalMatched += currentProgress.stats.matched_count || 0;
        }
        successCount++;
        continue;
      }

      const leg = itin.legs[i];
      const tpl = this.templateMapByRouteKey().get(leg.source_key);
      if (!tpl) {
        this.updateItineraryLegProgress(i, 'ERROR', undefined, this.lang.t('admin.commercial.templateNotFound'));
        continue;
      }

      this.updateItineraryLegProgress(i, 'RUNNING');

      try {
        const res = await firstValueFrom(
          this.api.materializeCommercialTemplate(tpl.template_id, { days_ahead: days, start_date: startDate }),
        );
        totalInserted += res.inserted_count;
        totalMatched += res.matched_count;
        successCount++;
        this.updateItineraryLegProgress(i, 'SUCCESS', res);
      } catch (err: any) {
        this.updateItineraryLegProgress(
          i,
          'ERROR',
          undefined,
          err?.error?.message || this.lang.t('admin.commercial.errorMaterializeGeneric'),
        );
      }
    }

    this.submittingItineraryMaterialize.set(false);
    this.itineraryMaterializeSummary.set({
      totalInserted,
      totalMatched,
      completedCount: successCount,
    });

    if (successCount === itin.legs.length) {
      this.toast.show(
        this.lang
          .t('admin.commercial.materializeSummary')
          .replace('{inserted}', String(totalInserted))
          .replace('{matched}', String(totalMatched))
          .replace('{total}', String(itin.legs.length)),
        'success',
      );
    } else if (successCount > 0) {
      this.toast.show(
        this.lang
          .t('admin.commercial.materializeSummary')
          .replace('{inserted}', String(totalInserted))
          .replace('{matched}', String(totalMatched))
          .replace('{total}', String(itin.legs.length)),
        'warning',
      );
    } else {
      this.toast.show(this.lang.t('admin.commercial.errorMaterializeGeneric'), 'error');
    }
  }

  private updateItineraryLegProgress(
    legIndex: number,
    status: 'PENDING' | 'RUNNING' | 'SUCCESS' | 'ERROR',
    stats?: MaterializeTemplateResponse,
    error?: string,
  ): void {
    this.itineraryMaterializeProgress.update((list) =>
      list.map((item) => (item.legIndex === legIndex ? { ...item, status, stats, error } : item)),
    );
  }

  // ===================== TEMPLATE EDIT DRAWER =====================
  openEditDrawer(t: CommercialScheduleTemplate): void {
    this.editingTemplate.set(t);
    this.editFlightNumber.set(t.flight_number);
    this.editAircraftType.set(t.aircraft_type);
    this.editIsActive.set(t.is_active);

    const cabins = new Set<CabinClass>(t.cabin_classes || [CabinClass.ECONOMY]);
    this.editSelectedCabins.set(cabins);

    const seats: Record<string, number> = {};
    if (t.commercial_inventories) {
      for (const inv of t.commercial_inventories) {
        seats[inv.cabin_class] = inv.allocated_seats;
      }
    }
    this.editAllocatedSeats.set(seats);

    const prices: Record<string, number | null> = {
      [CabinClass.ECONOMY]: t.base_price_economy,
      [CabinClass.BUSINESS]: t.base_price_business ?? null,
      [CabinClass.CLUB]: t.base_price_club ?? null,
      [CabinClass.FIRST]: t.base_price_first ?? null,
    };
    this.editBasePrices.set(prices);
    this.editIncompatibleCabins.set([]);
    this.editOvercapacityDetails.set([]);
  }

  onEditAircraftTypeSelected(aircraftType: string): void {
    this.editAircraftType.set(aircraftType);
    const layout = this.aircraftLayouts().find((l) => l.aircraft_type === aircraftType);
    if (!layout) return;
    this.recheckEditIncompatibility(layout);
  }

  removeIncompatibleEditCabins(): void {
    const incomp = new Set(this.editIncompatibleCabins());
    const remaining = new Set(
      Array.from(this.editSelectedCabins()).filter((c) => !incomp.has(c)),
    );
    this.editSelectedCabins.set(remaining);

    const seats = { ...this.editAllocatedSeats() };
    const prices = { ...this.editBasePrices() };
    for (const c of incomp) {
      delete seats[c];
      delete prices[c];
    }
    this.editAllocatedSeats.set(seats);
    this.editBasePrices.set(prices);

    const layout = this.editAircraftLayout();
    if (layout) {
      this.recheckEditIncompatibility(layout);
    }
  }

  toggleEditCabinSelection(cabin: CabinClass): void {
    if (cabin === CabinClass.ECONOMY) return;
    const set = new Set(this.editSelectedCabins());
    if (set.has(cabin)) {
      set.delete(cabin);
    } else {
      set.add(cabin);
    }
    this.editSelectedCabins.set(set);

    const layout = this.editAircraftLayout();
    if (layout) {
      const seats = { ...this.editAllocatedSeats() };
      if (!seats[cabin]) {
        seats[cabin] = layout.cabin_capacities[cabin] || 0;
        this.editAllocatedSeats.set(seats);
      }
      this.recheckEditIncompatibility(layout);
    }
  }

  updateEditAllocatedSeats(cabin: string, val: number): void {
    const current = { ...this.editAllocatedSeats() };
    current[cabin] = val;
    this.editAllocatedSeats.set(current);

    const layout = this.editAircraftLayout();
    if (layout) {
      this.recheckEditIncompatibility(layout);
    }
  }

  updateEditBasePrice(cabin: string, val: number | null): void {
    const current = { ...this.editBasePrices() };
    current[cabin] = val;
    this.editBasePrices.set(current);
  }

  private recheckEditIncompatibility(layout: CommercialAircraftLayout): void {
    const incompCabins: CabinClass[] = [];
    const overcap: Array<{ cabin: string; allocated: number; max: number }> = [];

    for (const c of this.editSelectedCabins()) {
      if (!layout.supported_cabins.includes(c)) {
        incompCabins.push(c);
      } else {
        const cap = layout.cabin_capacities[c] || 0;
        const curSeats = this.editAllocatedSeats()[c];
        if (curSeats && curSeats > cap) {
          overcap.push({ cabin: c, allocated: curSeats, max: cap });
        }
      }
    }
    this.editIncompatibleCabins.set(incompCabins);
    this.editOvercapacityDetails.set(overcap);
  }

  isEditFormValid(): boolean {
    const flNum = this.editFlightNumber().trim();
    if (!/^APT[A-Z0-9]+$/i.test(flNum)) return false;

    const layout = this.editAircraftLayout();
    if (!layout) return false;

    if (this.editIncompatibleCabins().length > 0) return false;
    if (this.editOvercapacityDetails().length > 0) return false;

    const ecoPrice = this.editBasePrices()[CabinClass.ECONOMY];
    if (ecoPrice === null || ecoPrice === undefined || isNaN(Number(ecoPrice)) || Number(ecoPrice) < 0) return false;

    if (!this.editSelectedCabins().has(CabinClass.ECONOMY)) return false;

    for (const c of this.editSelectedCabins()) {
      if (!layout.supported_cabins.includes(c)) return false;

      const seats = this.editAllocatedSeats()[c];
      const maxCap = layout.cabin_capacities[c] || 0;
      if (!seats || seats < 1 || seats > maxCap) return false;

      if (c !== CabinClass.ECONOMY) {
        const p = this.editBasePrices()[c];
        if (p !== null && p !== undefined && p !== ('' as any) && (isNaN(Number(p)) || Number(p) <= 0)) return false;
      }
    }

    return true;
  }

  saveTemplateEdit(): void {
    const t = this.editingTemplate();
    if (!t || !this.isEditFormValid()) return;

    this.submittingEdit.set(true);

    const cabinClasses = Array.from(this.editSelectedCabins());
    const inventories = cabinClasses.map((c) => ({
      cabin_class: c,
      allocated_seats: this.editAllocatedSeats()[c] || 0,
    }));
    const prices = this.editBasePrices();
    const ecoPrice = Number(prices[CabinClass.ECONOMY]);

    const resolvePremiumPrice = (cabin: CabinClass, originalVal?: number): number | null | undefined => {
      const inputVal = prices[cabin];
      if (inputVal === null || inputVal === undefined || (inputVal as any) === '') {
        if (originalVal !== undefined && originalVal !== null) {
          return null;
        }
        return undefined;
      }
      const num = Number(inputVal);
      return !isNaN(num) && num >= 0 ? num : null;
    };

    const payload: UpdateCommercialTemplatePayload = {
      flight_number: this.editFlightNumber().trim().toUpperCase(),
      aircraft_type: this.editAircraftType(),
      base_price_economy: ecoPrice,
      base_price_business: resolvePremiumPrice(CabinClass.BUSINESS, t.base_price_business),
      base_price_club: resolvePremiumPrice(CabinClass.CLUB, t.base_price_club),
      base_price_first: resolvePremiumPrice(CabinClass.FIRST, t.base_price_first),
      cabin_classes: cabinClasses,
      is_active: this.editIsActive(),
      inventories,
    };

    this.api.updateCommercialTemplate(t.template_id, payload).subscribe({
      next: (updated) => {
        this.submittingEdit.set(false);
        this.editingTemplate.set(null);
        this.toast.show(
          this.lang.t('admin.commercial.templateUpdated').replace('{id}', updated.template_id),
          'success',
        );
        this.refreshTemplatesCatalog();
      },
      error: (err) => {
        this.submittingEdit.set(false);
        this.toast.show(err?.error?.message || this.lang.t('admin.commercial.errorUpdateTemplate'), 'error');
      },
    });
  }

  onToggleTemplateStatus(evt: { id: string; isActive: boolean }): void {
    this.api.toggleCommercialTemplateStatus(evt.id, evt.isActive).subscribe({
      next: () => {
        this.templates.update((list) =>
          list.map((item) => (item.template_id === evt.id ? { ...item, is_active: evt.isActive } : item)),
        );
        this.toast.show(
          (evt.isActive
            ? this.lang.t('admin.commercial.templateStatusActive')
            : this.lang.t('admin.commercial.templateStatusInactive')
          ).replace('{id}', evt.id),
          'info',
        );
      },
      error: (err) => {
        this.toast.show(err?.error?.message || this.lang.t('admin.commercial.errorToggleStatus'), 'error');
      },
    });
  }

  // ===================== SINGLE TEMPLATE MATERIALIZE MODAL =====================
  openMaterializeModal(t: CommercialScheduleTemplate): void {
    this.materializingTemplate.set(t);
    this.materializeDays.set(30);
    this.materializeStartDate.set('');
    this.materializeResult.set(null);
  }

  closeMaterializeModal(): void {
    this.materializingTemplate.set(null);
    this.materializeResult.set(null);
  }

  isMaterializeDaysValid(): boolean {
    const d = this.materializeDays();
    return Number.isInteger(d) && d >= 1 && d <= 330;
  }

  executeMaterialize(): void {
    const t = this.materializingTemplate();
    if (!t || !this.isMaterializeDaysValid()) return;

    const days = this.materializeDays();
    const startDate = this.materializeStartDate().trim() || undefined;

    this.submittingMaterialize.set(true);
    this.api.materializeCommercialTemplate(t.template_id, { days_ahead: days, start_date: startDate }).subscribe({
      next: (res) => {
        this.submittingMaterialize.set(false);
        this.materializeResult.set(res);
        this.toast.show(
          this.lang
            .t('admin.commercial.materializeSuccess')
            .replace('{inserted}', res.inserted_count.toString())
            .replace('{matched}', res.matched_count.toString()),
          'success',
        );
      },
      error: (err) => {
        this.submittingMaterialize.set(false);
        this.toast.show(err?.error?.message || this.lang.t('admin.commercial.errorMaterialize'), 'error');
      },
    });
  }

  // ===================== ON-DEMAND AIRPORT SYNC =====================
  openSyncModal(): void {
    this.syncModalOpen.set(true);
  }

  executeAirportSync(): void {
    const depIata = this.syncDepIata().trim().toUpperCase();
    if (!depIata) {
      this.toast.show(this.lang.t('admin.commercial.airportIataRequired'), 'warning');
      return;
    }

    this.syncing.set(true);
    this.api.syncRoutesForAirport(depIata, this.syncLimit()).subscribe({
      next: (res) => {
        this.syncing.set(false);
        this.syncModalOpen.set(false);

        const countStr = String(res.updated || 0);
        if (res.complete === true) {
          this.toast.show(
            this.lang
              .t('admin.commercial.syncComplete')
              .replace('{count}', countStr)
              .replace('{airport}', res.dep_iata),
            'success',
          );
        } else if (res.truncated === true) {
          this.toast.show(
            this.lang
              .t('admin.commercial.syncTruncated')
              .replace('{count}', countStr)
              .replace('{airport}', res.dep_iata),
            'warning',
          );
        } else {
          this.toast.show(
            this.lang
              .t('admin.commercial.syncIncomplete')
              .replace('{count}', countStr)
              .replace('{airport}', res.dep_iata),
            'warning',
          );
        }

        this.filterDep.set(depIata);
        this.loadRoutes(1);
      },
      error: (err) => {
        this.syncing.set(false);
        this.toast.show(err?.error?.message || this.lang.t('admin.commercial.errorSyncRoutes'), 'error');
      },
    });
  }

  // ===================== UTILITY METHODS =====================
  itinTrackKey(itin: CommercialNetworkItinerary): string {
    return itin.legs.map((l) => l.source_key).join('>');
  }

  isLegCommercialized(leg: CommercialNetworkLeg): boolean {
    return this.templateMapByRouteKey().has(leg.source_key);
  }
}
