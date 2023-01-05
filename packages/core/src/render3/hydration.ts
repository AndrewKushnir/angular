/**
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */

import {first} from 'rxjs/operators';

import {ApplicationRef} from '../application_ref';
import {ENVIRONMENT_INITIALIZER, inject} from '../di';

import {readPatchedLView} from './context_discovery';
import {CONTAINER_HEADER_OFFSET, DEHYDRATED_VIEWS, LContainer} from './interfaces/container';
import {isLContainer, isRootView} from './interfaces/type_checks';
import {HEADER_OFFSET, LView, NghView, TVIEW} from './interfaces/view';

export function getLViewFromRootElement(element: Element): LView|null {
  let lView = readPatchedLView(element);
  if (lView && isRootView(lView)) {
    lView = lView[HEADER_OFFSET];
  }
  return lView;
}

function cleanupLContainer(lContainer: LContainer) {
  // TODO: we may consider doing it an error instead?
  if (lContainer[DEHYDRATED_VIEWS]) {
    for (const view of lContainer[DEHYDRATED_VIEWS]) {
      removeDehydratedView(view);
    }
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
      // this is a container
      const lContainer = lView[i];
      cleanupLContainer(lContainer);
    }
  }
}

function cleanupDehydratedViews(appRef: ApplicationRef) {
  // Wait once an app becomes stable and cleanup all views that
  // were not claimed during the application bootstrap process.
  return appRef.isStable.pipe(first((isStable: boolean) => isStable)).toPromise().then(() => {
    appRef.components.forEach((componentRef) => {
      const element = componentRef.location.nativeElement;
      if (element) {
        const lView = getLViewFromRootElement(element);
        if (lView !== null) {
          cleanupLView(lView);
        }
      }
    });
  });
}

/**
 * Helper function to remove all nodes from a dehydrated view.
 */
function removeDehydratedView(dehydratedView: NghView) {
  let nodesRemoved = 0;
  let currentRNode = (dehydratedView as any).firstChild;
  const numNodes = (dehydratedView as any).numTopLevelNodes;
  while (nodesRemoved < numNodes) {
    currentRNode.remove();
    currentRNode = currentRNode.nextSibling;
    nodesRemoved++;
  }
}

/**
 * @publicApi
 * @developerPreview
 */
export function withHydrationSupport() {
  // Note: this function can also bring more functionality in a tree-shakable way.
  // For example, by providing hydration-aware implementation of finding nodes vs
  // creating them.
  return [{
    provide: ENVIRONMENT_INITIALIZER,
    useValue: () => {
      const appRef = inject(ApplicationRef);
      // FIXME: there is no need to use a timeout, we need to
      // use a lifecycle hook to start the cleanup after an app
      // becomes stable (similar to how this is handled at SSR time).
      setTimeout(() => {
        cleanupDehydratedViews(appRef);
      }, 0);
    },
    multi: true,
  }];
}
