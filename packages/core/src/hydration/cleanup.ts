/**
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */

import {first} from 'rxjs/operators';

import {ApplicationRef, retrieveViewsFromApplicationRef} from '../application_ref';
import {CONTAINER_HEADER_OFFSET, DEHYDRATED_VIEWS, LContainer} from '../render3/interfaces/container';
import {isLContainer} from '../render3/interfaces/type_checks';
import {HEADER_OFFSET, HOST, LView, TVIEW} from '../render3/interfaces/view';

import {NghView} from './interfaces';
import {getComponentLView} from './utils';

export function cleanupDehydratedViews(appRef: ApplicationRef) {
  // Wait once an app becomes stable and cleanup all views that
  // were not claimed during the application bootstrap process.
  return appRef.isStable.pipe(first((isStable: boolean) => isStable)).toPromise().then(() => {
    const viewRefs = retrieveViewsFromApplicationRef(appRef);
    for (const viewRef of viewRefs) {
      const lView = getComponentLView(viewRef);
      // TODO: make sure that this lView represents
      // a component instance.
      const hostElement = lView[HOST];
      if (hostElement) {
        cleanupLView(lView);
      }
    }
  });
}

function cleanupLContainer(lContainer: LContainer) {
  // TODO: should we consider logging a warning here for cases
  // where there is something to cleanup, i.e. there was a delta
  // between a server and a client?
  if (lContainer[DEHYDRATED_VIEWS]) {
    const retainedViews = [];
    for (const view of lContainer[DEHYDRATED_VIEWS]) {
      // FIXME: this is a temporary check to keep "lazy" components
      // from being removed. This code is **only** needed for testing
      // purposes and must be removed.
      if (view.firstChild && !view.firstChild.hasAttribute('lazy')) {
        removeDehydratedView(view);
      } else {
        retainedViews.push(view);
      }
    }
    lContainer[DEHYDRATED_VIEWS] = retainedViews.length > 0 ? retainedViews : null;
  }
  for (let i = CONTAINER_HEADER_OFFSET; i < lContainer.length; i++) {
    const childView = lContainer[i] as LView;
    cleanupLView(childView);
  }
}

function cleanupLView(lView: LView) {
  const tView = lView[TVIEW];
  for (let i = HEADER_OFFSET; i < tView.bindingStartIndex; i++) {
    if (isLContainer(lView[i])) {
      const lContainer = lView[i];
      cleanupLContainer(lContainer);
    } else if (Array.isArray(lView[i])) {
      // This is a component, enter the `cleanupLView` recursively.
      cleanupLView(lView[i]);
    }
  }
}

/**
 * Helper function to remove all nodes from a dehydrated view.
 */
function removeDehydratedView(dehydratedView: NghView) {
  let nodesRemoved = 0;
  let currentRNode = dehydratedView.firstChild;
  if (currentRNode) {
    const numNodes = dehydratedView.numRootNodes;
    while (nodesRemoved < numNodes) {
      currentRNode.remove();
      currentRNode = currentRNode.nextSibling as HTMLElement;
      nodesRemoved++;
    }
  }
}
