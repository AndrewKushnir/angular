/**
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */

import {inject, Injectable, InjectFlags, InjectionToken, Injector, ɵformatRuntimeError as formatRuntimeError, ɵRuntimeError as RuntimeError} from '@angular/core';

import {DOCUMENT} from '../../dom_tokens';
import {RuntimeErrorCode} from '../../errors';

import {assertDevMode} from './asserts';
import {getDirectiveConfig} from './config';
import {imgDirectiveDetails} from './error_helper';
import {extractHostname, getUrl} from './url';

// Set of origins that are always excluded from the preconnect checks.
const INTERNAL_PRECONNECT_CHECK_BLOCKLIST = new Set(['localhost', '127.0.0.1', '0.0.0.0']);

/**
 * TODO: rewrite the doc to indicate that this token is internal.
 *
 * Multi-provider injection token to configure which origins should be excluded
 * from the preconnect checks. It can either be a single string or an array of strings
 * to represent a group of origins, for example:
 *
 * ```typescript
 *  {provide: PRECONNECT_CHECK_BLOCKLIST, multi: true, useValue: 'https://your-domain.com'}
 * ```
 *
 * or:
 *
 * ```typescript
 *  {provide: PRECONNECT_CHECK_BLOCKLIST, multi: true,
 *   useValue: ['https://your-domain-1.com', 'https://your-domain-2.com']}
 * ```
 */
export const PRECONNECT_CHECK_BLOCKLIST =
    new InjectionToken<Array<string|string[]>>('PRECONNECT_CHECK_BLOCKLIST');

/**
 * Contains the logic to detect whether an image, marked with the "priority" attribute
 * has a corresponding `<link rel="preconnect">` tag in the `document.head`.
 *
 * Note: this is a dev-mode only class, which should not appear in prod bundles,
 * thus there is no `ngDevMode` use in the code.
 */
@Injectable({providedIn: 'root'})
export class PreconnectLinkChecker {
  private document = inject(DOCUMENT);

  /**
   * Set of <link rel="preconnect"> tags found on this page.
   * The `null` value indicates that there was no DOM query operation performed.
   */
  private preconnectLinks: Set<string>|null = null;

  /*
   * Keep track of all already seen origin URLs to avoid repeating the same check.
   */
  private alreadySeen = new Set<string>();

  private window: Window|null = null;

  constructor() {
    assertDevMode('preconnect link checker');
    const win = this.document.defaultView;
    if (typeof win !== 'undefined') {
      this.window = win;
    }
  }

  /**
   * Checks that a preconnect resource hint exists in the head fo rthe
   * given src.
   *
   * @param rewrittenSrc src formatted with loader
   * @param originalNgSrc ngSrc value
   * @param injector Current injector of the NgOptimizedImage directive
   *
   * TODO: add more info on why we pass an injector here (so that we can pull tokens from the node
   * injector if they are defined on that level).
   */
  assertPreconnect(rewrittenSrc: string, originalNgSrc: string, injector: Injector): void {
    if (!this.window) return;

    const blocklist = this.getPreconnectCheckBlocklist(injector);
    const imgUrl = getUrl(rewrittenSrc, this.window);
    if (blocklist.has(imgUrl.hostname) || this.alreadySeen.has(imgUrl.origin)) return;

    // Register this origin as seen, so we don't check it again later.
    this.alreadySeen.add(imgUrl.origin);

    if (!this.preconnectLinks) {
      // Note: we query for preconnect links only *once* and cache the results
      // for the entire lifespan of an application, since it's unlikely that the
      // list would change frequently. This allows to make sure there are no
      // performance implications of making extra DOM lookups for each image.
      this.preconnectLinks = this.queryPreconnectLinks();
    }

    if (!this.preconnectLinks.has(imgUrl.origin)) {
      console.warn(formatRuntimeError(
          RuntimeErrorCode.PRIORITY_IMG_MISSING_PRECONNECT_TAG,
          `${imgDirectiveDetails(originalNgSrc)} there is no preconnect tag present for this ` +
              `image. Preconnecting to the origin(s) that serve priority images ensures that these ` +
              `images are delivered as soon as possible. To fix this, please add the following ` +
              `element into the <head> of the document:\n` +
              `  <link rel="preconnect" href="${imgUrl.origin}">`));
    }
  }

  private queryPreconnectLinks(): Set<string> {
    const preconnectUrls = new Set<string>();
    const selector = 'link[rel=preconnect]';
    const links: HTMLLinkElement[] = Array.from(this.document.querySelectorAll(selector));
    for (let link of links) {
      const url = getUrl(link.href, this.window!);
      preconnectUrls.add(url.origin);
    }
    return preconnectUrls;
  }

  /**
   * TODO: add docs.
   *
   * @param injector
   * @returns
   */
  private getPreconnectCheckBlocklist(injector: Injector): Set<string> {
    const fromUserConfig = getDirectiveConfig(injector).preconnectCheckBlocklist ?? [];

    if (!Array.isArray(fromUserConfig)) {
      // TODO: update error message
      throw new RuntimeError(
          RuntimeErrorCode.INVALID_PRECONNECT_CHECK_BLOCKLIST,
          `The blocklist for the preconnect check was not provided as an array. ` +
              `Check that the \`NG_OPTIMIZED_IMAGE_CONFIG\` token value has the right shape.`);
    }

    const fromLoaderConfig =
        injector.get(PRECONNECT_CHECK_BLOCKLIST, undefined, InjectFlags.Optional) ?? [];
    const blocklist =
        [...INTERNAL_PRECONNECT_CHECK_BLOCKLIST, ...fromUserConfig, ...flatten(fromLoaderConfig)];
    return new Set(blocklist.map(extractHostname));
  }

  ngOnDestroy() {
    this.preconnectLinks?.clear();
    this.alreadySeen.clear();
  }
}

/**
 * Flattens single-level nested arrays.
 */
export function flatten<T>(arr: (T|T[])[]): T[] {
  return Array.prototype.concat.apply([], arr);
}
