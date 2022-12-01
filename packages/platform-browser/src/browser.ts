/**
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */

import {CommonModule, DOCUMENT, XhrFactory, ɵPLATFORM_BROWSER_ID as PLATFORM_BROWSER_ID} from '@angular/common';
import {APP_ID, ApplicationModule, ApplicationRef, createPlatformFactory, DELEGATE_RENDERER_FACTORY_FN, EnvironmentProviders, ErrorHandler, HydrationRenderer, inject, Inject, Injectable, InjectionToken, ModuleWithProviders, NgModule, NgZone, Optional, PLATFORM_ID, PLATFORM_INITIALIZER, platformCore, PlatformRef, Provider, Renderer2, RendererFactory2, RendererType2, SkipSelf, StaticProvider, Testability, TestabilityRegistry, Type, ɵHydrationConfig as HydrationConfig, ɵHydrationState as HydrationState, ɵINJECTOR_SCOPE as INJECTOR_SCOPE, ɵinternalCreateApplication as internalCreateApplication, ɵsetDocument, ɵTESTABILITY as TESTABILITY, ɵTESTABILITY_GETTER as TESTABILITY_GETTER} from '@angular/core';

import {BrowserDomAdapter} from './browser/browser_adapter';
import {SERVER_TRANSITION_PROVIDERS, TRANSITION_ID} from './browser/server-transition';
import {BrowserGetTestability} from './browser/testability';
import {BrowserXhr} from './browser/xhr';
import {DomRendererFactory2} from './dom/dom_renderer';
import {DomEventsPlugin} from './dom/events/dom_events';
import {EVENT_MANAGER_PLUGINS, EventManager} from './dom/events/event_manager';
import {KeyEventsPlugin} from './dom/events/key_events';
import {DomSharedStylesHost, SharedStylesHost} from './dom/shared_styles_host';

const NG_DEV_MODE = typeof ngDevMode === 'undefined' || !!ngDevMode;

/**
 * Set of config options available during the application bootstrap operation.
 *
 * @publicApi
 */
export interface ApplicationConfig {
  /**
   * List of providers that should be available to the root component and all its children.
   */
  providers: Array<Provider|EnvironmentProviders>;
}

/**
 * Bootstraps an instance of an Angular application and renders a standalone component as the
 * application's root component. More information about standalone components can be found in [this
 * guide](guide/standalone-components).
 *
 * @usageNotes
 * The root component passed into this function *must* be a standalone one (should have the
 * `standalone: true` flag in the `@Component` decorator config).
 *
 * ```typescript
 * @Component({
 *   standalone: true,
 *   template: 'Hello world!'
 * })
 * class RootComponent {}
 *
 * const appRef: ApplicationRef = await bootstrapApplication(RootComponent);
 * ```
 *
 * You can add the list of providers that should be available in the application injector by
 * specifying the `providers` field in an object passed as the second argument:
 *
 * ```typescript
 * await bootstrapApplication(RootComponent, {
 *   providers: [
 *     {provide: BACKEND_URL, useValue: 'https://yourdomain.com/api'}
 *   ]
 * });
 * ```
 *
 * The `importProvidersFrom` helper method can be used to collect all providers from any
 * existing NgModule (and transitively from all NgModules that it imports):
 *
 * ```typescript
 * await bootstrapApplication(RootComponent, {
 *   providers: [
 *     importProvidersFrom(SomeNgModule)
 *   ]
 * });
 * ```
 *
 * Note: the `bootstrapApplication` method doesn't include [Testability](api/core/Testability) by
 * default. You can add [Testability](api/core/Testability) by getting the list of necessary
 * providers using `provideProtractorTestingSupport()` function and adding them into the `providers`
 * array, for example:
 *
 * ```typescript
 * import {provideProtractorTestingSupport} from '@angular/platform-browser';
 *
 * await bootstrapApplication(RootComponent, {providers: [provideProtractorTestingSupport()]});
 * ```
 *
 * @param rootComponent A reference to a standalone component that should be rendered.
 * @param options Extra configuration for the bootstrap operation, see `ApplicationConfig` for
 *     additional info.
 * @returns A promise that returns an `ApplicationRef` instance once resolved.
 *
 * @publicApi
 */
export function bootstrapApplication(
    rootComponent: Type<unknown>, options?: ApplicationConfig): Promise<ApplicationRef> {
  return internalCreateApplication({rootComponent, ...createProvidersConfig(options)});
}

export function provideHydrationSupport(options?: {isStrictMode: boolean}) {
  const providers: Provider[] = [{
    provide: RendererFactory2,
    useClass: HydrationRendererFactory2,
  }];
  if (options) {
    providers.push({provide: HYDRATION_CONFIG, useValue: options});
  }
  return providers;
}

/**
 * Represents hydration state within this application.
 */
const HYDRATION_STATE = new InjectionToken<HydrationState>(NG_DEV_MODE ? 'HYDRATION_STATE' : '', {
  providedIn: 'root',
  factory: () => ({
    registry: new Map(),  // registry of all annotated elements found on a page
    debug: {},            // debug info collected during the invocation
    isRegistryPopulated: false,
    inDeoptMode: false,
  }),
});

/**
 * Represents hydration config setup at application creation time.
 */
const HYDRATION_CONFIG =
    new InjectionToken<HydrationConfig>(NG_DEV_MODE ? 'HYDRATION_CONFIG' : '', {
      providedIn: 'root',
      factory: () => ({
        isStrictMode: false,
      }),
    });

@Injectable()
export class HydrationRendererFactory2 implements RendererFactory2 {
  private document = inject(DOCUMENT);
  private state = inject(HYDRATION_STATE);
  private config = inject(HYDRATION_CONFIG);
  private delegateRendererFactory2: RendererFactory2;

  constructor() {
    // TODO: currently we use `DomRendererFactory2` as a delegate renderer,
    // but a renderer might be configured by developers, so we should find
    // a way to use a configured renderer instead.
    const delegateRendererFn = inject(DELEGATE_RENDERER_FACTORY_FN, {optional: true});
    const domRendererFactory = inject(DomRendererFactory2);
    this.delegateRendererFactory2 = delegateRendererFn?.(domRendererFactory) ?? domRendererFactory;
  }

  createRenderer(element: any, type: RendererType2|null): Renderer2 {
    const delegateRenderer = this.delegateRendererFactory2.createRenderer(element, type);
    return new HydrationRenderer(this.document, this.state, this.config, delegateRenderer);
  }

  begin() {}
  end() {}
}

/**
 * *** WARNING: EXTREMELY EXPERIMENTAL API! ***
 *
 * Hydrates an application, trying to pick up existing nodes from the DOM
 * instead of creating new ones like `bootstrapApplication` does. The DOM
 * structure *must* be produced by the serialization functions like
 * `renderModule` (for NgModule cases) and `renderApplication` (for standalone
 * components cases).
 *
 * @developerPreview
 * @publicApi
 */
export function hydrateApplication<T>(
    rootComponent: Type<T>, options?: {providers: Provider[]}): Promise<ApplicationRef> {
  const renderer: Provider[] = [
    {provide: RendererFactory2, useClass: HydrationRendererFactory2},
  ];
  const providers = [...(options?.providers || []), ...renderer];
  return bootstrapApplication(rootComponent, {providers});
}

/**
 * Create an instance of an Angular application without bootstrapping any components. This is useful
 * for the situation where one wants to decouple application environment creation (a platform and
 * associated injectors) from rendering components on a screen. Components can be subsequently
 * bootstrapped on the returned `ApplicationRef`.
 *
 * @param options Extra configuration for the application environment, see `ApplicationConfig` for
 *     additional info.
 * @returns A promise that returns an `ApplicationRef` instance once resolved.
 *
 * @publicApi
 */
export function createApplication(options?: ApplicationConfig) {
  return internalCreateApplication(createProvidersConfig(options));
}

function createProvidersConfig(options?: ApplicationConfig) {
  return {
    appProviders: [
      ...BROWSER_MODULE_PROVIDERS,
      ...(options?.providers ?? []),
    ],
    platformProviders: INTERNAL_BROWSER_PLATFORM_PROVIDERS
  };
}

/**
 * Returns a set of providers required to setup [Testability](api/core/Testability) for an
 * application bootstrapped using the `bootstrapApplication` function. The set of providers is
 * needed to support testing an application with Protractor (which relies on the Testability APIs
 * to be present).
 *
 * @returns An array of providers required to setup Testability for an application and make it
 *     available for testing using Protractor.
 *
 * @publicApi
 */
export function provideProtractorTestingSupport(): Provider[] {
  // Return a copy to prevent changes to the original array in case any in-place
  // alterations are performed to the `provideProtractorTestingSupport` call results in app code.
  return [...TESTABILITY_PROVIDERS];
}

export function initDomAdapter() {
  BrowserDomAdapter.makeCurrent();
}

export function errorHandler(): ErrorHandler {
  return new ErrorHandler();
}

export function _document(): any {
  // Tell ivy about the global document
  ɵsetDocument(document);
  return document;
}

export const INTERNAL_BROWSER_PLATFORM_PROVIDERS: StaticProvider[] = [
  {provide: PLATFORM_ID, useValue: PLATFORM_BROWSER_ID},
  {provide: PLATFORM_INITIALIZER, useValue: initDomAdapter, multi: true},
  {provide: DOCUMENT, useFactory: _document, deps: []},
];

/**
 * A factory function that returns a `PlatformRef` instance associated with browser service
 * providers.
 *
 * @publicApi
 */
export const platformBrowser: (extraProviders?: StaticProvider[]) => PlatformRef =
    createPlatformFactory(platformCore, 'browser', INTERNAL_BROWSER_PLATFORM_PROVIDERS);

/**
 * Internal marker to signal whether providers from the `BrowserModule` are already present in DI.
 * This is needed to avoid loading `BrowserModule` providers twice. We can't rely on the
 * `BrowserModule` presence itself, since the standalone-based bootstrap just imports
 * `BrowserModule` providers without referencing the module itself.
 */
const BROWSER_MODULE_PROVIDERS_MARKER =
    new InjectionToken(NG_DEV_MODE ? 'BrowserModule Providers Marker' : '');

const TESTABILITY_PROVIDERS = [
  {
    provide: TESTABILITY_GETTER,
    useClass: BrowserGetTestability,
    deps: [],
  },
  {
    provide: TESTABILITY,
    useClass: Testability,
    deps: [NgZone, TestabilityRegistry, TESTABILITY_GETTER]
  },
  {
    provide: Testability,  // Also provide as `Testability` for backwards-compatibility.
    useClass: Testability,
    deps: [NgZone, TestabilityRegistry, TESTABILITY_GETTER]
  }
];

const BROWSER_MODULE_PROVIDERS: Provider[] = [
  {provide: INJECTOR_SCOPE, useValue: 'root'},
  {provide: ErrorHandler, useFactory: errorHandler, deps: []}, {
    provide: EVENT_MANAGER_PLUGINS,
    useClass: DomEventsPlugin,
    multi: true,
    deps: [DOCUMENT, NgZone, PLATFORM_ID]
  },
  {provide: EVENT_MANAGER_PLUGINS, useClass: KeyEventsPlugin, multi: true, deps: [DOCUMENT]}, {
    provide: DomRendererFactory2,
    useClass: DomRendererFactory2,
    deps: [EventManager, DomSharedStylesHost, APP_ID]
  },
  {provide: RendererFactory2, useExisting: DomRendererFactory2},
  {provide: SharedStylesHost, useExisting: DomSharedStylesHost},
  {provide: DomSharedStylesHost, useClass: DomSharedStylesHost, deps: [DOCUMENT]},
  {provide: EventManager, useClass: EventManager, deps: [EVENT_MANAGER_PLUGINS, NgZone]},
  {provide: XhrFactory, useClass: BrowserXhr, deps: []},
  NG_DEV_MODE ? {provide: BROWSER_MODULE_PROVIDERS_MARKER, useValue: true} : []
];

/**
 * Exports required infrastructure for all Angular apps.
 * Included by default in all Angular apps created with the CLI
 * `new` command.
 * Re-exports `CommonModule` and `ApplicationModule`, making their
 * exports and providers available to all apps.
 *
 * @publicApi
 */
@NgModule({
  providers: [
    ...BROWSER_MODULE_PROVIDERS,  //
    ...TESTABILITY_PROVIDERS
  ],
  exports: [CommonModule, ApplicationModule],
})
export class BrowserModule {
  constructor(@Optional() @SkipSelf() @Inject(BROWSER_MODULE_PROVIDERS_MARKER)
              providersAlreadyPresent: boolean|null) {
    if (NG_DEV_MODE && providersAlreadyPresent) {
      throw new Error(
          `Providers from the \`BrowserModule\` have already been loaded. If you need access ` +
          `to common directives such as NgIf and NgFor, import the \`CommonModule\` instead.`);
    }
  }

  /**
   * Configures a browser-based app to transition from a server-rendered app, if
   * one is present on the page.
   *
   * @param params An object containing an identifier for the app to transition.
   * The ID must match between the client and server versions of the app.
   * @returns The reconfigured `BrowserModule` to import into the app's root `AppModule`.
   */
  static withServerTransition(params: {appId: string}): ModuleWithProviders<BrowserModule> {
    return {
      ngModule: BrowserModule,
      providers: [
        {provide: APP_ID, useValue: params.appId},
        {provide: TRANSITION_ID, useExisting: APP_ID},
        SERVER_TRANSITION_PROVIDERS,
      ],
    };
  }
}
