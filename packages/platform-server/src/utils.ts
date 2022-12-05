/**
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */

import {ApplicationRef, EnvironmentProviders, importProvidersFrom, InjectionToken, NgModuleFactory, NgModuleRef, PlatformRef, Provider, Renderer2, StaticProvider, Type, ɵinternalCreateApplication as internalCreateApplication, ɵisPromise, ɵreadHydrationKey as readHydrationKey} from '@angular/core';
import {BrowserModule, ɵTRANSITION_ID} from '@angular/platform-browser';
import {first} from 'rxjs/operators';

import {PlatformState} from './platform_state';
import {platformDynamicServer, platformServer, ServerModule} from './server';
import {BEFORE_APP_SERIALIZED, INITIAL_CONFIG} from './tokens';
import {TRANSFER_STATE_SERIALIZATION_PROVIDERS} from './transfer_state';

/**
 * Enables extra profiling output in the console (such as
 * an execution time of a particular function/subsystem).
 */
const ENABLE_PROFILING = true;

// Make sure this flag is in sync with a similar one in `core`.
// TODO: remove this flag eventually, we should always produce optimized keys.
const ENABLE_HYDRATION_KEY_COMPRESSION = false;

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
    extraProviders
  ]);
}

/**
 * Adds the `ng-server-context` attribute to host elements of all bootstrapped components
 * within a given application.
 */
function appendServerContextInfo(serverContext: string, applicationRef: ApplicationRef) {
  applicationRef.components.forEach(componentRef => {
    const renderer = componentRef.injector.get(Renderer2);
    const element = componentRef.location.nativeElement;
    if (element) {
      renderer.setAttribute(element, 'ng-server-context', serverContext);
    }
  });
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
    return applicationRef.isStable.pipe((first((isStable: boolean) => isStable)))
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
            let preAnnotatedOutput: string|null = null;
            if (ENABLE_PROFILING) {
              // Check the HTML output size before we add extra markers.
              preAnnotatedOutput = platformState.renderToString();
              console.log('Pre-annotated output size: ', preAnnotatedOutput.length);
            }

            const doc = platformState.getDocument();
            applicationRef.components.forEach(componentRef => {
              const element = componentRef.location.nativeElement;
              if (element) {
                annotateForHydration(doc, element);
                if (ENABLE_HYDRATION_KEY_COMPRESSION) {
                  compressHydrationKeys(element);
                }
              }
            });

            ENABLE_PROFILING && console.time('renderToString');
            let output = platformState.renderToString();
            ENABLE_PROFILING && console.timeEnd('renderToString');

            // Shortens `<!--1|5-->` to `<!1|5>`.
            output = compressCommentNodes(output);

            if (ENABLE_PROFILING) {
              const overheadInBytes = output.length - preAnnotatedOutput!.length;
              const overheadInPercent = Math.round((overheadInBytes / output.length) * 10000) / 100;
              console.log(
                  '* Hydration annotation HTML size overhead: ', overheadInBytes, ' chars, ',
                  overheadInPercent, '%');
            }

            platform.destroy();
            return output;
          };

          if (asyncPromises.length === 0) {
            return complete();
          }

          return Promise
              .all(asyncPromises.map(asyncPromise => {
                return asyncPromise.catch(e => {
                  console.warn('Ignoring BEFORE_APP_SERIALIZED Exception: ', e);
                });
              }))
              .then(complete);
        });
  });
}

/**
 * Helper function to replace serialized comment nodes with
 * a more compact representation, i.e. `<!--1|5-->` -> `<!1|5>`.
 * Ideally, it should be a part of Domino and there should be
 * no need to go over the HTML string once again, but Domino
 * doesn't support this at the moment.
 */
function compressCommentNodes(content: string): string {
  // Match patterns like: `*|<number>`, `*?<number>` and `*?vcr<number>`.
  const shorten = () => content.replace(/<!--(.*?([|?]\d+|vcr\d+))-->/g, '<!$1>');

  if (ENABLE_PROFILING) {
    const lengthBefore = content.length;
    console.time('compactCommentNodes');

    content = shorten();

    const lengthAfter = content.length;
    console.timeEnd('compactCommentNodes');
    console.log(
        'compactCommentNodes: original size: ', lengthBefore, ', new size: ', lengthAfter,
        ', saved: ', lengthBefore - lengthAfter);
  } else {
    content = shorten();  // same as above, but without extra logging
  }
  return content;
}

/**
 * Compresses hydration keys to avoid repeating long strings,
 * and only append the delta at each level.
 *
 * NOTE: this logic should eventually be folded into
 * the `annotateForHydration` function, so that there is no
 * extra DOM walk, but keep it separate for now for profiling
 * and debugging purposes.
 *
 * TODO:
 * - move compression/decompression logic to a separate file,
 * - move all inner functions outside of the `compressHydrationKeys` fn.
 */
function compressHydrationKeys(root: Element) {
  /* Returns: [viewSegments, elementId, isTextMarker] */
  type ParsedHydrationKey =
      [string[] /* viewSegments */, string /* elementId */, boolean /* isTextMarker */];
  const parseKey = (key: string): ParsedHydrationKey => {
    const isTextMarker = key.indexOf('?') > -1;
    const delim = isTextMarker ? '?' : '|';
    const parts = key.split(delim);
    const elementId = parts.pop()!;
    const viewSegments = parts.pop()!.split(':');
    return [viewSegments, elementId, isTextMarker];
  };
  const computeTransformCommand = (parent: string[], child: string[]) => {
    let diffStartsAt = parent.length === child.length ?  //
        -1 :
        Math.min(parent.length, child.length);
    let i = 0;
    let rmCommand = '';
    while (i < parent.length && i < child.length) {
      if (parent[i] !== child[i]) {
        diffStartsAt = i;
        break;
      }
      i++;
    }
    if (diffStartsAt === -1) {
      // No difference in keys, return an empty array.
      return [];
    } else {
      // Starting from the diff point, until the end of the parent
      // segments, add `d` as an indicator that one segment should
      // be dropped (thus "d"). The following number indicated the number
      // of segments to be dropped. If there is just one segment (most
      // common case), just `d` is printed. Otherwise, the value would
      // look like `d5` (drop 5 segments).
      const segmentsToDrop = parent.length - diffStartsAt;
      if (segmentsToDrop > 0) {
        rmCommand = 'd' + (segmentsToDrop > 1 ? segmentsToDrop : '');
      }
      const command = rmCommand || 'a';  // 'a' stands for "append"
      return [command, ...child.slice(diffStartsAt)];
    }
  };
  const makeHydrationKey =
      (viewSegments: string[], elementId: string, isTextMarker: boolean): string => {
        return viewSegments.join(':') + (isTextMarker ? '?' : '|') + elementId;
      };

  const visitNode = (parentKey: ParsedHydrationKey, node: any) => {
    let parsedNodeKey: ParsedHydrationKey|null = null;
    const nodeKey = extractHydrationKey(node);
    if (nodeKey) {
      parsedNodeKey = parseKey(nodeKey);
      const [viewSegments, elementId, isTextMarker] = parsedNodeKey;
      // We have both node and current keys, compute transform command
      // (between view segments only).
      const newViewSegments = computeTransformCommand(parentKey[0], viewSegments);
      const newKey = makeHydrationKey(newViewSegments, elementId, isTextMarker);
      if (node.nodeType === Node.COMMENT_NODE) {
        node.textContent = newKey;
      } else {  // Node.ELEMENT_NODE
        node.setAttribute('ngh', newKey);
      }
    }

    let childNode = node.firstChild;
    while (childNode) {
      // If the current node doesn't have its own key,
      // use parent node key instead, so that child key
      // is computed based on it.
      visitNode(parsedNodeKey ?? parentKey, childNode);
      childNode = childNode.nextSibling;
    }
  };

  // Start the process for all child nodes of the root node.
  if (root.childNodes.length > 0) {
    const rootKey = parseKey(extractHydrationKey(root)!);
    root.childNodes.forEach((child: any) => {
      visitNode(rootKey, child);
    });
  }
}

function extractHydrationKey(node: any): string|null {
  if (node.nodeType === Node.COMMENT_NODE) {
    return node.textContent;
  } else if (node.nodeType === Node.ELEMENT_NODE) {
    return node.getAttribute('ngh');
  }
  return null;
}

/**
 * Annotates document nodes with extra info needed for hydration on a client later:
 * - for comment nodes: insert hydration key as a content
 * - for element nodes: add a new `ngh` attribute
 * - for text nodes: create a new comment node with a key
 *                   and append this comment node after the text node
 */
function annotateForHydration(doc: Document, element: Element) {
  ENABLE_PROFILING && console.time('* Hydration annotation exec time overhead');

  const visitNode = (node: any) => {
    const hydrationKey = readHydrationKey(node);
    if (hydrationKey) {
      if (node.nodeType === Node.COMMENT_NODE) {
        node.textContent = hydrationKey;
      } else if (node.nodeType === Node.ELEMENT_NODE) {
        node.setAttribute('ngh', hydrationKey);
      } else if (node.nodeType === Node.TEXT_NODE) {
        // Note: `?` is a special marker that represents a marker for a text node.
        const key = hydrationKey.replace('|', '?');
        const marker = doc.createComment(key);
        node.after(marker);
      }
    }

    let current = node.firstChild;
    while (current) {
      visitNode(current);
      current = current.nextSibling;
    }
  };
  visitNode(element);

  ENABLE_PROFILING && console.timeEnd('* Hydration annotation exec time overhead');
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
export function renderModule<T>(moduleType: Type<T>, options: {
  document?: string|Document,
  url?: string,
  extraProviders?: StaticProvider[],
}): Promise<string> {
  ENABLE_PROFILING && console.log('--------------');
  ENABLE_PROFILING && console.time('renderModule (total time)');
  const {document, url, extraProviders: platformProviders} = options;
  ENABLE_PROFILING && console.time('createPlatform');
  const platform = _getPlatform(platformDynamicServer, {document, url, platformProviders});
  ENABLE_PROFILING && console.timeEnd('createPlatform');
  return _render(platform, platform.bootstrapModule(moduleType)).then((result: string) => {
    ENABLE_PROFILING && console.timeEnd('renderModule (total time)');
    ENABLE_PROFILING && console.log('--------------');
    return result;
  });
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
  appId: string,
  document?: string|Document,
  url?: string,
  providers?: Array<Provider|EnvironmentProviders>,
  platformProviders?: Provider[],
}): Promise<string> {
  ENABLE_PROFILING && console.log('--------------');
  ENABLE_PROFILING && console.time('renderApplication (total time)');
  const {document, url, platformProviders, appId} = options;
  ENABLE_PROFILING && console.time('createPlatform');
  const platform = _getPlatform(platformDynamicServer, {document, url, platformProviders});
  ENABLE_PROFILING && console.timeEnd('createPlatform');
  const appProviders = [
    importProvidersFrom(BrowserModule.withServerTransition({appId})),
    importProvidersFrom(ServerModule),
    ...TRANSFER_STATE_SERIALIZATION_PROVIDERS,
    ...(options.providers ?? []),
  ];
  return _render(platform, internalCreateApplication({rootComponent, appProviders}))
      .then((result: string) => {
        ENABLE_PROFILING && console.timeEnd('renderApplication (total time)');
        ENABLE_PROFILING && console.log('--------------');
        return result;
      });
}

/**
 * Bootstraps an application using provided {@link NgModuleFactory} and serializes the page
 * content to string.
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
export function renderModuleFactory<T>(moduleFactory: NgModuleFactory<T>, options: {
  document?: string,
  url?: string,
  extraProviders?: StaticProvider[],
}): Promise<string> {
  const {document, url, extraProviders: platformProviders} = options;
  const platform = _getPlatform(platformServer, {document, url, platformProviders});
  return _render(platform, platform.bootstrapModuleFactory(moduleFactory));
}
