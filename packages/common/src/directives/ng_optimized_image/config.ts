/**
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */

import {InjectFlags, InjectionToken, Injector} from '@angular/core';

/**
 * TODO: add docs.
 *
 * @publicApi
 * @developerPreview
 */
export interface NgOptimizedImageConfig {
  preconnectCheckBlocklist?: string[];
}

/**
 * TODO: add docs.
 *
 * @publicApi
 * @developerPreview
 */
export const NG_OPTIMIZED_IMAGE_CONFIG =
    new InjectionToken<NgOptimizedImageConfig>(ngDevMode ? 'NG_OPTIMIZED_IMAGE_CONFIG' : '');

export function getDirectiveConfig(injector: Injector) {
  return injector.get(NG_OPTIMIZED_IMAGE_CONFIG, {}, InjectFlags.Optional) ?? {};
}
