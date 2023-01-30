/**
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */

import {DEHYDRATED_VIEWS, LContainer} from '../render3/interfaces/container';
import {NghView} from '../render3/interfaces/view';

/**
 * Reference to a function that searches for a matching dehydrated views
 * stored on a given lContainer.
 * Returns `null` by default, when hydration is not enabled.
 */
let _findMatchingDehydratedViewImpl: typeof findMatchingDehydratedViewImpl =
    (lContainer: LContainer, template: string) => null;

function findMatchingDehydratedViewImpl(lContainer: LContainer, template: string): NghView|null {
  let hydrationInfo: NghView|null = null;
  if (lContainer !== null && lContainer[DEHYDRATED_VIEWS]) {
    // Does the target container have a view?
    const dehydratedViews = lContainer[DEHYDRATED_VIEWS];
    if (dehydratedViews.length > 0) {
      // TODO: take into account an index of a view within ViewContainerRef,
      // otherwise, we may end up reusing wrong nodes from live DOM?
      const dehydratedViewIndex = dehydratedViews.findIndex(view => view.template === template);

      if (dehydratedViewIndex > -1) {
        hydrationInfo = dehydratedViews[dehydratedViewIndex];

        // Drop this view from the list of de-hydrated ones.
        dehydratedViews.splice(dehydratedViewIndex, 1);
      }
    }
  }
  return hydrationInfo;
}

export function enableFindMatchingDehydratedViewImpl() {
  _findMatchingDehydratedViewImpl = findMatchingDehydratedViewImpl;
}

export function findMatchingDehydratedView(lContainer: LContainer, template: string): NghView|null {
  return _findMatchingDehydratedViewImpl(lContainer, template);
}
