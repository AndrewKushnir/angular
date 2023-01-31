/**
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */

import {ApplicationRef} from '../application_ref';
import {APP_BOOTSTRAP_LISTENER} from '../application_tokens';
import {InjectionToken} from '../di/injection_token';
import {inject} from '../di/injector_compatibility';
import {enableLocateOrCreateContainerRefImpl} from '../linker/view_container_ref';
import {enableLocateOrCreateElementNodeImpl} from '../render3/instructions/element';
import {enableLocateOrCreateElementContainerNodeImpl} from '../render3/instructions/element_container';
import {enableLocateOrCreateLContainerNodeImpl} from '../render3/instructions/template';
import {enableLocateOrCreateTextNodeImpl} from '../render3/instructions/text';

import {cleanupDehydratedViews} from './cleanup';
import {enableRetrieveNghInfoImpl} from './utils';
import {enableFindMatchingDehydratedViewImpl} from './views';

export const IS_HYDRATION_ENABLED = new InjectionToken<boolean>('IS_HYDRATION_ENABLED');

let isHydrationImplementationEnabled = false;

/**
 * @publicApi
 * @developerPreview
 */
export function provideHydrationSupport() {
  if (!isHydrationImplementationEnabled) {
    isHydrationImplementationEnabled = true;
    enableRetrieveNghInfoImpl();
    enableFindMatchingDehydratedViewImpl();
    enableLocateOrCreateElementNodeImpl();
    enableLocateOrCreateLContainerNodeImpl();
    enableLocateOrCreateTextNodeImpl();
    enableLocateOrCreateElementContainerNodeImpl();
    enableLocateOrCreateContainerRefImpl();
  }
  return [
    {
      provide: APP_BOOTSTRAP_LISTENER,
      useFactory: () => {
        const appRef = inject(ApplicationRef);
        return () => cleanupDehydratedViews(appRef);
      },
      multi: true,
    },
    {
      provide: IS_HYDRATION_ENABLED,
      useValue: true,
    }
  ];
}
