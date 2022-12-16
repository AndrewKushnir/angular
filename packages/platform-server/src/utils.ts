/**
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */

import {ApplicationRef, EnvironmentProviders, importProvidersFrom, InjectionToken, NgModuleRef, PlatformRef, Provider, Renderer2, StaticProvider, Type, ɵgetLViewById as getLViewById, ɵinternalCreateApplication as internalCreateApplication, ɵisPromise} from '@angular/core';
import {CONTAINER_HEADER_OFFSET, LContainer, TYPE} from '@angular/core/src/render3/interfaces/container';
import {TContainerNode, TNode} from '@angular/core/src/render3/interfaces/node';
import {RElement, RNode} from '@angular/core/src/render3/interfaces/renderer_dom';
import {isRootView} from '@angular/core/src/render3/interfaces/type_checks';
import {FLAGS, HEADER_OFFSET, HOST, LView, TVIEW, TView, TViewType} from '@angular/core/src/render3/interfaces/view';
import {unwrapRNode} from '@angular/core/src/render3/util/view_utils';
import {BrowserModule, ɵTRANSITION_ID} from '@angular/platform-browser';
import {first} from 'rxjs/operators';

import {navigateBetween, NodeNavigationStep} from './node_nav';
import {PlatformState} from './platform_state';
import {platformDynamicServer, ServerModule} from './server';
import {BEFORE_APP_SERIALIZED, INITIAL_CONFIG} from './tokens';

interface PlatformOptions {
  document?: string|Document;
  url?: string;
  platformProviders?: Provider[];
}

function _getPlatform(
    platformFactory: (extraProviders: StaticProvider[]) => PlatformRef,
    options: PlatformOptions): PlatformRef {
  const extraProviders = options.platformProviders ?? [];
  return platformFactory([
    {provide: INITIAL_CONFIG, useValue: {document: options.document, url: options.url}},
    extraProviders,
  ]);
}

/**
 * Adds the `ng-server-context` attribute to host elements of all bootstrapped components
 * within a given application.
 */
function appendServerContextInfo(serverContext: string, applicationRef: ApplicationRef) {
  applicationRef.components.forEach((componentRef) => {
    const renderer = componentRef.injector.get(Renderer2);
    const element = componentRef.location.nativeElement;
    if (element) {
      renderer.setAttribute(element, 'ng-server-context', serverContext);
    }
  });
}

export interface LiveDom {
  nodes: Array<string[]>;
  containers: Container[];
  templates: Record<number, string>;
}

export interface Container {
  anchor: number; /* index from 'nodes' */
  views: View[];
}

export interface View extends LiveDom {
  template: string;
}

export function isLContainer(value: RNode|LView|LContainer|{}|null): value is LContainer {
  return Array.isArray(value) && value[TYPE] === true;
}

function serializeLView(lView: LView, hostNode: Element): LiveDom {
  const ngh: LiveDom = {
    nodes: [],
    containers: [],
    templates: {},
  };
  const tView = lView[TVIEW];
  for (let i = HEADER_OFFSET; i < tView.bindingStartIndex; i++) {
    let targetNode: Node|null = null;
    if (isLContainer(lView[i])) {
      // this is a container
      const tNode = tView.data[i] as TContainerNode;
      const embeddedTView = tNode.tViews;
      if (embeddedTView !== null) {
        if (Array.isArray(embeddedTView)) {
          throw new Error(`Expecting tNode.tViews to be an object, but it's an array.`);
        }
        ngh.templates[i - HEADER_OFFSET] = getTViewSsrId(embeddedTView);
      }

      targetNode = unwrapRNode(lView[i][HOST]!) as Node;
      const container = serializeLContainer(lView[i], hostNode, i - HEADER_OFFSET);
      ngh.containers.push(container);
    } else if (Array.isArray(lView[i])) {
      // this is a component
      targetNode = unwrapRNode(lView[i][HOST]!) as Element;
      annotateForHydration(targetNode as Element, lView[i]);
    } else {
      // this is a DOM element
      targetNode = lView[i] as Node;
    }

    if (targetNode !== null) {
      // TODO: support cases when a DOM element is moved outside of the app host node,
      // for ex. material modal dialog root element that is moved to the `<body>`.
      ngh.nodes[i - HEADER_OFFSET] = navigateBetween(hostNode, targetNode).map(op => {
        switch (op) {
          case NodeNavigationStep.FirstChild:
            return 'firstChild';
          case NodeNavigationStep.NextSibling:
            return 'nextSibling';
        }
      });
    }
  }
  return ngh;
}

let ssrId: number = 0;
const ssrIdMap = new Map<TView, string>();

function getTViewSsrId(tView: TView): string {
  if (!ssrIdMap.has(tView)) {
    ssrIdMap.set(tView, `t${ssrId++}`);
  }
  return ssrIdMap.get(tView)!;
}

function serializeLContainer(lContainer: LContainer, hostNode: Element, anchor: number): Container {
  const container: Container = {
    anchor,
    views: [],
  };

  for (let i = CONTAINER_HEADER_OFFSET; i < lContainer.length; i++) {
    const childView = lContainer[i] as LView;

    const ssrId = getTViewSsrId(childView[TVIEW]);

    // from which template did this lView originate?
    container.views.push({
      template: ssrId,
      ...serializeLView(lContainer[i] as LView, hostNode),
    });
  }

  return container;
}

export function getLViewFromRootElement(element: Element): LView {
  const MONKEY_PATCH_KEY_NAME = '__ngContext__';
  const data = (element as any)[MONKEY_PATCH_KEY_NAME];
  let lView = typeof data === 'number' ? getLViewById(data) : data || null;
  if (!lView) throw new Error('not found');  // TODO: is it possible?

  if (isRootView(lView)) {
    lView = lView[HEADER_OFFSET];
  }
  return lView;
}

export function annotateForHydration(element: Element, lView: LView): void {
  const ngh = JSON.stringify(serializeLView(lView, element))
  element.setAttribute('ngh', ngh);
  console.log('ngh', ngh);
}

function _render<T>(
    platform: PlatformRef,
    bootstrapPromise: Promise<NgModuleRef<T>|ApplicationRef>): Promise<string> {
  return bootstrapPromise.then((moduleOrApplicationRef) => {
    const environmentInjector = moduleOrApplicationRef.injector;
    const transitionId = environmentInjector.get(ɵTRANSITION_ID, null);
    if (!transitionId) {
      throw new Error(
          `renderModule[Factory]() requires the use of BrowserModule.withServerTransition() to ensure
the server-rendered app can be properly bootstrapped into a client app.`);
    }
    const applicationRef: ApplicationRef = moduleOrApplicationRef instanceof ApplicationRef ?
        moduleOrApplicationRef :
        environmentInjector.get(ApplicationRef);
    const serverContext =
        sanitizeServerContext(environmentInjector.get(SERVER_CONTEXT, DEFAULT_SERVER_CONTEXT));
    return applicationRef.isStable.pipe(first((isStable: boolean) => isStable))
        .toPromise()
        .then(() => {
          appendServerContextInfo(serverContext, applicationRef);

          const platformState = platform.injector.get(PlatformState);

          const asyncPromises: Promise<any>[] = [];

          // Run any BEFORE_APP_SERIALIZED callbacks just before rendering to string.
          const callbacks = environmentInjector.get(BEFORE_APP_SERIALIZED, null);

          if (callbacks) {
            for (const callback of callbacks) {
              try {
                const callbackResult = callback();
                if (ɵisPromise(callbackResult)) {
                  // TODO: in TS3.7, callbackResult is void.
                  asyncPromises.push(callbackResult as any);
                }
              } catch (e) {
                // Ignore exceptions.
                console.warn('Ignoring BEFORE_APP_SERIALIZED Exception: ', e);
              }
            }
          }

          const complete = () => {
            const doc = platformState.getDocument();
            applicationRef.components.forEach((componentRef) => {
              const element = componentRef.location.nativeElement;
              if (element) {
                annotateForHydration(element, getLViewFromRootElement(element));
              }
            });

            const output = platformState.renderToString();
            platform.destroy();
            return output;
          };

          if (asyncPromises.length === 0) {
            return complete();
          }

          return Promise
              .all(asyncPromises.map((asyncPromise) => {
                return asyncPromise.catch((e) => {
                  console.warn('Ignoring BEFORE_APP_SERIALIZED Exception: ', e);
                });
              }))
              .then(complete);
        });
  });
}

/**
 * Specifies the value that should be used if no server context value has been provided.
 */
const DEFAULT_SERVER_CONTEXT = 'other';

/**
 * An internal token that allows providing extra information about the server context
 * (e.g. whether SSR or SSG was used). The value is a string and characters other
 * than [a-zA-Z0-9\-] are removed. See the default value in `DEFAULT_SERVER_CONTEXT` const.
 */
export const SERVER_CONTEXT = new InjectionToken<string>('SERVER_CONTEXT');

/**
 * Sanitizes provided server context:
 * - removes all characters other than a-z, A-Z, 0-9 and `-`
 * - returns `other` if nothing is provided or the string is empty after sanitization
 */
function sanitizeServerContext(serverContext: string): string {
  const context = serverContext.replace(/[^a-zA-Z0-9\-]/g, '');
  return context.length > 0 ? context : DEFAULT_SERVER_CONTEXT;
}

/**
 * Bootstraps an application using provided NgModule and serializes the page content to string.
 *
 * @param moduleType A reference to an NgModule that should be used for bootstrap.
 * @param options Additional configuration for the render operation:
 *  - `document` - the document of the page to render, either as an HTML string or
 *                 as a reference to the `document` instance.
 *  - `url` - the URL for the current render request.
 *  - `extraProviders` - set of platform level providers for the current render request.
 *
 * @publicApi
 */
export function renderModule<T>(
    moduleType: Type<T>,
    options: {document?: string|Document; url?: string; extraProviders?: StaticProvider[]}):
    Promise<string> {
  const {document, url, extraProviders: platformProviders} = options;
  const platform = _getPlatform(platformDynamicServer, {document, url, platformProviders});
  return _render(platform, platform.bootstrapModule(moduleType));
}

/**
 * Bootstraps an instance of an Angular application and renders it to a string.
 *
 * Note: the root component passed into this function *must* be a standalone one (should have the
 * `standalone: true` flag in the `@Component` decorator config).
 *
 * ```typescript
 * @Component({
 *   standalone: true,
 *   template: 'Hello world!'
 * })
 * class RootComponent {}
 *
 * const output: string = await renderApplication(RootComponent, {appId: 'server-app'});
 * ```
 *
 * @param rootComponent A reference to a Standalone Component that should be rendered.
 * @param options Additional configuration for the render operation:
 *  - `appId` - a string identifier of this application. The appId is used to prefix all
 *              server-generated stylings and state keys of the application in TransferState
 *              use-cases.
 *  - `document` - the document of the page to render, either as an HTML string or
 *                 as a reference to the `document` instance.
 *  - `url` - the URL for the current render request.
 *  - `providers` - set of application level providers for the current render request.
 *  - `platformProviders` - the platform level providers for the current render request.
 *
 * @returns A Promise, that returns serialized (to a string) rendered page, once resolved.
 *
 * @publicApi
 * @developerPreview
 */
export function renderApplication<T>(rootComponent: Type<T>, options: {
  appId: string;
  document?: string | Document;
  url?: string;
  providers?: Array<Provider|EnvironmentProviders>;
  platformProviders?: Provider[];
}): Promise<string> {
  const {document, url, platformProviders, appId} = options;
  const platform = _getPlatform(platformDynamicServer, {document, url, platformProviders});
  const appProviders = [
    importProvidersFrom(BrowserModule.withServerTransition({appId})),
    importProvidersFrom(ServerModule),
    ...(options.providers ?? []),
  ];
  return _render(platform, internalCreateApplication({rootComponent, appProviders}));
}
