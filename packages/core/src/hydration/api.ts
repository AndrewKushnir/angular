/**
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */

import {ApplicationRef} from '../application_ref';
import {APP_BOOTSTRAP_LISTENER, APP_ID, PLATFORM_ID} from '../application_tokens';
import {EnvironmentProviders, makeEnvironmentProviders, Provider} from '../di';
import {ENVIRONMENT_INITIALIZER} from '../di/initializer_token';
import {InjectionToken} from '../di/injection_token';
import {inject} from '../di/injector_compatibility';
import {enableLocateOrCreateContainerRefImpl} from '../linker/view_container_ref';
import {enableLocateOrCreateElementNodeImpl} from '../render3/instructions/element';
import {enableLocateOrCreateElementContainerNodeImpl} from '../render3/instructions/element_container';
import {setLocateHostElementImpl} from '../render3/instructions/shared';
import {enableLocateOrCreateLContainerNodeImpl} from '../render3/instructions/template';
import {enableLocateOrCreateTextNodeImpl} from '../render3/instructions/text';

import {cleanupDehydratedViews} from './cleanup';
import {enableRetrieveNghInfoImpl, locateHostElementImpl} from './utils';
import {enableFindMatchingDehydratedViewImpl} from './views';

const NG_DEV_MODE = typeof ngDevMode === 'undefined' || !!ngDevMode;

/**
 * Internal token that specifies whether hydration is enabled.
 */
export const IS_HYDRATION_FEATURE_ENABLED =
    new InjectionToken<boolean>(NG_DEV_MODE ? 'IS_HYDRATION_FEATURE_ENABLED' : '');

let isHydrationSupportEnabled = false;

// TODO: update this implementation to allow a "rollback".
// This would be needed for tests, so that we reset the logic
// back before we SSR the next component.
function enableHydrationRuntimeSupport() {
  if (!isHydrationSupportEnabled) {
    isHydrationSupportEnabled = true;
    enableRetrieveNghInfoImpl();
    enableFindMatchingDehydratedViewImpl();
    enableLocateOrCreateElementNodeImpl();
    enableLocateOrCreateLContainerNodeImpl();
    enableLocateOrCreateTextNodeImpl();
    enableLocateOrCreateElementContainerNodeImpl();
    enableLocateOrCreateContainerRefImpl();
    setLocateHostElementImpl(locateHostElementImpl);
  }
}

function isBrowser() {
  const platformId = inject(PLATFORM_ID);
  return platformId === 'browser';
}

/**
 * TODO: add more precise typings for features, see `provideRouter`
 * TODO: add docs
 *
 * @publicApi
 * @developerPreview
 */
export function provideSsrSupport(appId: string, ...features: Provider[]): EnvironmentProviders {
  return makeEnvironmentProviders([
    {provide: APP_ID, useValue: appId},
    ...features,
  ]);
}

/**
 * TODO: add more precise typings for features, see `provideRouter`
 * TODO: add docs
 *
 * @publicApi
 * @developerPreview
 */
export function withHydration(): Provider[] {
  return [
    {
      provide: ENVIRONMENT_INITIALIZER,
      useValue: () => {
        if (isBrowser()) {
          enableHydrationRuntimeSupport();
        }
      },
      multi: true,
    },
    {
      provide: APP_BOOTSTRAP_LISTENER,
      useFactory: () => {
        if (isBrowser()) {
          const appRef = inject(ApplicationRef);
          return () => cleanupDehydratedViews(appRef);
        }
        return () => {};  // noop
      },
      multi: true,
    },
    {
      provide: IS_HYDRATION_FEATURE_ENABLED,
      useValue: true,
    }
  ];
}
