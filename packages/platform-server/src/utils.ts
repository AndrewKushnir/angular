/**
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */

import {ApplicationRef, EnvironmentProviders, importProvidersFrom, InjectionToken, NgModuleFactory, NgModuleRef, PlatformRef, Provider, Renderer2, StaticProvider, Type, ɵcollectNativeNodes as collectNativeNodes, ɵCONTAINER_HEADER_OFFSET as CONTAINER_HEADER_OFFSET, ɵCONTEXT as CONTEXT, ɵgetLViewById as getLViewById, ɵHEADER_OFFSET as HEADER_OFFSET, ɵHOST as HOST, ɵinternalCreateApplication as internalCreateApplication, ɵisPromise, ɵisRootView as isRootView, ɵLContainer as LContainer, ɵLView as LView, ɵRNode as RNode, ɵTContainerNode as TContainerNode, ɵTNode as TNode, ɵTNodeType as TNodeType, ɵTVIEW as TVIEW, ɵTView as TView, ɵTViewType as TViewType, ɵTYPE as TYPE, ɵunwrapRNode as unwrapRNode,} from '@angular/core';
import {BrowserModule, ɵTRANSITION_ID} from '@angular/platform-browser';
import {first} from 'rxjs/operators';

import {navigateBetween, NodeNavigationStep} from './node_nav';
import {PlatformState} from './platform_state';
import {platformDynamicServer, platformServer, ServerModule} from './server';
import {BEFORE_APP_SERIALIZED, INITIAL_CONFIG} from './tokens';
import {TRANSFER_STATE_SERIALIZATION_PROVIDERS} from './transfer_state';

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

// TODO: import from `@angular/core` instead, this is just a copy.
export enum I18nCreateOpCode {
  SHIFT = 2,
  APPEND_EAGERLY = 0b01,
  COMMENT = 0b10,
}

export interface LiveDom {
  /* anchor is an index from LView */
  containers: Record<number, Container>;
  nodes: Record<number, string>;
  templates: Record<number, string>;
}

export interface Container {
  views: View[];
  // Describes the number of top level nodes in this container.
  // Only applicable to <ng-container>s.
  //
  // TODO: consider moving this info elsewhere to avoid confusion
  // between view containers (<div *ngIf>) and element containers
  // (<ng-container>s).
  numRootNodes?: number;
}

export interface View extends LiveDom {
  template: string;
  numRootNodes: number;
}

export function isLContainer(value: RNode|LView|LContainer|{}|null): value is LContainer {
  return Array.isArray(value) && value[TYPE] === true;
}

function firstRNodeInElementContainer(tView: TView, lView: LView, tNode: TNode): RNode|null {
  const rootNodes: any[] = [];
  // TODO: find more efficient way to do this. We don't need to traverse the entire
  // structure, we can just stop after examining the first node.
  collectNativeNodes(tView, lView, tNode, rootNodes);
  return rootNodes[0];
}

function isProjectionTNode(tNode: TNode): boolean {
  return (tNode.type & TNodeType.Projection) === TNodeType.Projection;
}

export function isTI18nNode(obj: any): boolean {
  // TODO: consider adding a node type to TI18n?
  return obj.hasOwnProperty('create') && obj.hasOwnProperty('update');
}

export function findClosestElementTNode(tNode: TNode|null): TNode|null {
  let parentTNode: TNode|null = tNode;
  // FIXME: this condition should also take into account whether
  // resulting tNode is not marked as `insertBeforeIndex`.
  while (parentTNode !== null &&
         ((parentTNode.type & TNodeType.Element) !== TNodeType.Element ||
          parentTNode.insertBeforeIndex !== null)) {
    tNode = parentTNode;
    parentTNode = tNode.parent;
  }
  return parentTNode;
}


function serializeLView(lView: LView, hostNode: Element): LiveDom {
  const ngh: LiveDom = {
    containers: {},
    templates: {},
    nodes: {},
  };

  const tView = lView[TVIEW];
  for (let i = HEADER_OFFSET; i < tView.bindingStartIndex; i++) {
    debugger;

    let targetNode: Node|null = null;
    const adjustedIndex = i - HEADER_OFFSET;
    const tNode = tView.data[i] as TContainerNode;
    // tNode may be null in the case of a localRef
    if (!tNode) {
      continue;
    }
    if (Array.isArray(tNode.projection)) {
      // TODO: handle `RNode[]` as well.
      for (const headTNode of (tNode.projection as any[])) {
        // We may have `null`s in slots with no projected content.
        // Also, if we process re-projected content (i.e. `<ng-content>`
        // appears at projection location), skip annotations for this content
        // since all DOM nodes in this projection were handled while processing
        // a parent lView, which contains those nodes.
        if (headTNode && !isProjectionTNode(headTNode)) {
          ngh.nodes[headTNode.index - HEADER_OFFSET] = calcPathForNode(tView, lView, headTNode);
        }
      }
    }
    if (isLContainer(lView[i])) {
      // this is a container
      const tNode = tView.data[i] as TContainerNode;
      const embeddedTView = tNode.tViews;
      if (embeddedTView !== null) {
        if (Array.isArray(embeddedTView)) {
          throw new Error(`Expecting tNode.tViews to be an object, but it's an array.`);
        }
        ngh.templates![i - HEADER_OFFSET] = getTViewSsrId(embeddedTView);
      }

      targetNode = unwrapRNode(lView[i][HOST]!) as Node;
      const container = serializeLContainer(lView[i], hostNode, adjustedIndex);
      ngh.containers![adjustedIndex] = container;
    } else if (Array.isArray(lView[i])) {
      // this is a component
      targetNode = unwrapRNode(lView[i][HOST]!) as Element;
      annotateForHydration(targetNode as Element, lView[i]);
    } else if (isTI18nNode(tNode)) {
      // Process i18n text nodes...
      const createOpCodes = (tNode as any).create;
      for (let i = 0; i < createOpCodes.length; i++) {
        const opCode = createOpCodes[i++] as any;
        const appendNow =
            (opCode & I18nCreateOpCode.APPEND_EAGERLY) === I18nCreateOpCode.APPEND_EAGERLY;
        const index = opCode >>> I18nCreateOpCode.SHIFT;
        const tNode = tView.data[index] as TNode;
        // if (appendNow) {
        const parentTNode = findClosestElementTNode(tNode);
        const path = calcPathForNode(tView, lView, tNode, parentTNode);
        ngh.nodes[tNode.index - HEADER_OFFSET] = path;
        // }
      }
    } else if (tNode.insertBeforeIndex) {
      debugger;
      if (Array.isArray(tNode.insertBeforeIndex) && tNode.insertBeforeIndex[0] !== null) {
        // A root node within i18n block.
        // TODO: add a comment on *why* we need a path here.
        const path = calcPathForNode(tView, lView, tNode);
        ngh.nodes[tNode.index - HEADER_OFFSET] = path;
      }
    } else {
      const tNodeType = tNode.type;
      // <ng-container> case
      if (tNodeType & TNodeType.ElementContainer) {
        const rootNodes: any[] = [];
        collectNativeNodes(tView, lView, tNode.child, rootNodes);

        // This is an "element" container (vs "view" container),
        // so it's only represented by the number of top-level nodes
        // as a shift to get to a corresponding comment node.
        const container: Container = {
          views: [],
          numRootNodes: rootNodes.length,
        };

        ngh.containers[adjustedIndex] = container;
      } else if (tNodeType & TNodeType.Projection) {
        // Current TNode has no DOM element associated with it,
        // so the following node would not be able to find an anchor.
        // Use full path instead.
        let nextTNode = tNode.next;
        while (nextTNode !== null && (nextTNode.type & TNodeType.Projection)) {
          nextTNode = nextTNode.next;
        }
        if (nextTNode) {
          const index = nextTNode.index - HEADER_OFFSET;
          const path = calcPathForNode(tView, lView, nextTNode);
          ngh.nodes[index] = path;
        }
      } else {
        // ... otherwise, this is a DOM element, for which we may need to
        // serialize in some cases.
        targetNode = lView[i] as Node;

        // Check if projection next is not the same as next, in which case
        // the node would not be found at creation time at runtime and we
        // need to provide a location to that node.
        if (tNode.projectionNext && tNode.projectionNext !== tNode.next) {
          const nextProjectedTNode = tNode.projectionNext;
          const index = nextProjectedTNode.index - HEADER_OFFSET;
          const path = calcPathForNode(tView, lView, nextProjectedTNode);
          ngh.nodes[index] = path;
        }
      }
    }
  }
  return ngh;
}

function calcPathForNode(
    tView: TView, lView: LView, tNode: TNode, parentTNode?: TNode|null): string {
  const index = tNode.index;
  // If `null` is passed explicitly, use this as a signal that we want to calculate
  // the path starting from `lView[HOST]`.
  parentTNode = parentTNode === null ? null : (parentTNode || tNode.parent!);
  const parentIndex = parentTNode === null ? 'host' : parentTNode.index;
  const parentRNode =
      parentTNode === null ? lView[HOST] : unwrapRNode(lView[parentIndex as number]);
  let rNode = unwrapRNode(lView[index]);
  if (tNode.type & TNodeType.AnyContainer) {
    // For <ng-container> nodes, instead of serializing a reference
    // to the anchor comment node, serialize a location of the first
    // DOM element. Paired with the container size (serialized as a part
    // of `ngh.containers`), it should give enough information for runtime
    // to hydrate nodes in this container.
    //
    // Note: for ElementContainers (i.e. `<ng-container>` elements), we use
    // a first child from the tNode data structures, since we want to collect
    // add root nodes starting from the first child node in a container.
    const childTNode = tNode.type & TNodeType.ElementContainer ? tNode.child : tNode;
    const firstRNode = firstRNodeInElementContainer(tView, lView, childTNode!);
    // If container is not empty, use a reference to the first element,
    // otherwise, rNode would point to an anchor comment node.
    if (firstRNode) {
      rNode = firstRNode;
    }
  }
  debugger;
  const path: string[] = navigateBetween(parentRNode as Node, rNode as Node).map(op => {
    switch (op) {
      case NodeNavigationStep.FirstChild:
        return 'firstChild';
      case NodeNavigationStep.NextSibling:
        return 'nextSibling';
    }
  });
  if (parentIndex === 'host') {
    // TODO: add support for `host` to the `locateNextRNode` fn.
    path.unshift(parentIndex);
  } else {
    path.unshift('' + (parentIndex - HEADER_OFFSET));
  }
  return path.join('.');
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
    views: [],
  };

  for (let i = CONTAINER_HEADER_OFFSET; i < lContainer.length; i++) {
    let childLView = lContainer[i] as LView;

    // Get LView for underlying component.
    if (isRootView(childLView)) {
      childLView = childLView[HEADER_OFFSET];
    }
    const childTView = childLView[TVIEW];

    let template;
    if (childTView.type === TViewType.Component) {
      const ctx = childLView[CONTEXT];
      // TODO: this is a hack (we capture a component host element name),
      // we need a more stable solution here, for ex. a way to generate
      // a component id.
      template = (ctx!.constructor as any)['ɵcmp'].selectors[0][0];
    } else {
      template = getTViewSsrId(childTView);
    }

    const rootNodes: any[] = [];
    collectNativeNodes(childTView, childLView, childTView.firstChild, rootNodes);

    container.views.push({
      template,  // from which template did this lView originate?
      numRootNodes: rootNodes.length,
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
  const rawNgh = serializeLView(lView, element);
  const serializedNgh = JSON.stringify(rawNgh);
  element.setAttribute('ngh', serializedNgh);
  debugger;
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
    ...TRANSFER_STATE_SERIALIZATION_PROVIDERS,
    ...(options.providers ?? []),
  ];
  return _render(platform, internalCreateApplication({rootComponent, appProviders}));
}

/**
 * Bootstraps an application using provided {@link NgModuleFactory} and serializes the page content
 * to string.
 *
 * @param moduleFactory An instance of the {@link NgModuleFactory} that should be used for
 *     bootstrap.
 * @param options Additional configuration for the render operation:
 *  - `document` - the document of the page to render, either as an HTML string or
 *                 as a reference to the `document` instance.
 *  - `url` - the URL for the current render request.
 *  - `extraProviders` - set of platform level providers for the current render request.
 *
 * @publicApi
 *
 * @deprecated
 * This symbol is no longer necessary as of Angular v13.
 * Use {@link renderModule} API instead.
 */
export function renderModuleFactory<T>(
    moduleFactory: NgModuleFactory<T>,
    options: {document?: string; url?: string; extraProviders?: StaticProvider[]}):
    Promise<string> {
  const {document, url, extraProviders: platformProviders} = options;
  const platform = _getPlatform(platformServer, {document, url, platformProviders});
  return _render(platform, platform.bootstrapModuleFactory(moduleFactory));
}
