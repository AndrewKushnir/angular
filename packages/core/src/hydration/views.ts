/**
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */

import {assertRComment} from '../render3/assert';
import {DEHYDRATED_VIEWS, LContainer} from '../render3/interfaces/container';
import {RElement, RNode} from '../render3/interfaces/renderer_dom';

import {NghContainer, NghView} from './interfaces';
import {siblingAfter} from './node_lookup_utils';


/**
 * Given a current DOM node and an ngh container definition,
 * walks over the DOM structure, collecting the list of dehydrated views.
 *
 * @param currentRNode
 * @param nghContainer
 */
export function locateDehydratedViewsInContainer(
    currentRNode: RNode, nghContainer: NghContainer): [RNode, NghView[]] {
  const dehydratedViews: NghView[] = [];
  if (nghContainer.views) {
    for (const nghView of nghContainer.views) {
      const view = {...nghView};
      if (view.numRootNodes > 0) {
        // Keep reference to the first node in this view,
        // so it can be accessed while invoking template instructions.
        view.firstChild = currentRNode as HTMLElement;

        // Move over to the first node after this view, which can
        // either be a first node of the next view or an anchor comment
        // node after the last view in a container.
        currentRNode = siblingAfter(view.numRootNodes, currentRNode as RElement)!;
      }

      dehydratedViews.push(view);
    }
  }

  ngDevMode && assertRComment(currentRNode, 'Expecting a comment node as a view container anchor');

  return [currentRNode, dehydratedViews];
}

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
