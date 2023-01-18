/**
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */

import {ENVIRONMENT_INITIALIZER, inject} from '@angular/core';
import {first} from 'rxjs/operators';

import {ApplicationRef} from '../application_ref';
import {InjectionToken} from '../di/injection_token';
import {assertDefined} from '../util/assert';

import {assertRComment} from './assert';
import {readPatchedLView} from './context_discovery';
import {CONTAINER_HEADER_OFFSET, DEHYDRATED_VIEWS, LContainer} from './interfaces/container';
import {TNode, TNodeType} from './interfaces/node';
import {RElement, RNode} from './interfaces/renderer_dom';
import {isLContainer, isRootView} from './interfaces/type_checks';
import {HEADER_OFFSET, LView, NghContainer, NghDom, NghView, TView, TVIEW} from './interfaces/view';
import {getNativeByTNode, unwrapRNode} from './util/view_utils';

export const IS_HYDRATION_ENABLED = new InjectionToken<boolean>('IS_HYDRATION_ENABLED');

/**
 * @publicApi
 * @developerPreview
 */
export function provideHydrationSupport() {
  // Note: this function can also bring more functionality in a tree-shakable way.
  // For example, by providing hydration-aware implementation of finding nodes vs
  // creating them.
  return [
    {
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
    },
    {
      provide: IS_HYDRATION_ENABLED,
      useValue: true,
    }
  ];
}

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
  let currentRNode = dehydratedView.firstChild;
  const numNodes = dehydratedView.numRootNodes;
  while (nodesRemoved < numNodes) {
    currentRNode.remove();
    currentRNode = currentRNode.nextSibling as HTMLElement;
    nodesRemoved++;
  }
}

type ClaimedNode = {
  __claimed?: boolean
};

// TODO: consider using WeakMap instead.
export function markRNodeAsClaimedForHydration(node: RNode) {
  if (!ngDevMode) {
    throw new Error('Calling `claimNode` in prod mode is not supported and likely a mistake.');
  }
  if (isRNodeClaimedForHydration(node)) {
    throw new Error('Trying to claim a node, which was claimed already.');
  }
  (node as ClaimedNode).__claimed = true;
}

export function isRNodeClaimedForHydration(node: RNode): boolean {
  return !!(node as ClaimedNode).__claimed;
}

export function findExistingNode(host: Node, path: string[]): RNode {
  let node = host;
  for (const op of path) {
    if (!node) {
      // TODO: add a dev-mode assertion here.
      throw new Error(`findExistingNode: failed to find node at ${path}.`);
    }
    switch (op) {
      case 'firstChild':
        node = node.firstChild!;
        break;
      case 'nextSibling':
        node = node.nextSibling!;
        break;
    }
  }
  if (!node) {
    // TODO: add a dev-mode assertion here.
    throw new Error(`findExistingNode: failed to find node at ${path}.`);
  }
  return node as unknown as RNode;
}

function locateRNodeByPath(path: string, lView: LView): RNode {
  const pathParts = path.split('.');
  // First element in a path is:
  // - either a parent node id: `12.nextSibling...`
  // - or a 'host' string to indicate that the search should start from the host node
  const firstPathPart = pathParts.shift();
  if (firstPathPart === 'host') {
    return findExistingNode(lView[0] as unknown as Element, pathParts);
  } else {
    const parentElementId = Number(firstPathPart!);
    const parentRNode = unwrapRNode((lView as any)[parentElementId + HEADER_OFFSET]);
    return findExistingNode(parentRNode as Element, pathParts);
  }
}

export function locateNextRNode<T extends RNode>(
    hydrationInfo: NghDom, tView: TView, lView: LView<unknown>, tNode: TNode,
    previousTNode: TNode|null, previousTNodeParent: boolean): T|null {
  let native: RNode|null = null;
  const adjustedIndex = tNode.index - HEADER_OFFSET;
  if (hydrationInfo.nodes[adjustedIndex]) {
    // We know exact location of the node.
    native = locateRNodeByPath(hydrationInfo.nodes[adjustedIndex], lView);
  } else if (tView.firstChild === tNode) {
    // We create a first node in this view.
    native = hydrationInfo.firstChild;
  } else {
    ngDevMode && assertDefined(previousTNode, 'Unexpected state: no current TNode found.');
    let previousRElement = getNativeByTNode(previousTNode!, lView) as RElement;
    // TODO: we may want to use this instead?
    // const closest = getClosestRElement(tView, previousTNode, lView);
    if (previousTNodeParent && previousTNode!.type === TNodeType.ElementContainer) {
      // Previous node was an `<ng-container>`, so this node is a first child
      // within an element container, so we can locate the container in ngh data
      // structure and use its first child.
      const nghContainer = hydrationInfo.containers[previousTNode!.index - HEADER_OFFSET];
      if (ngDevMode && !nghContainer) {
        // TODO: add better error message.
        throw new Error('Invalid state.');
      }
      native = nghContainer.firstChild!;
    } else {
      // FIXME: this doesn't work for i18n :(
      // In i18n case, previous tNode is a parent element,
      // when in fact, it might be a text node in front of it.
      if (previousTNodeParent) {
        native = (previousRElement as any).firstChild;
      } else {
        const previousNodeHydrationInfo =
            hydrationInfo.containers[previousTNode!.index - HEADER_OFFSET];
        if (previousTNode!.type === TNodeType.Element && previousNodeHydrationInfo) {
          // If the previous node is an element, but it also has container info,
          // this means that we are processing a node like `<div #vcrTarget>`, which is
          // represented in live DOM as `<div></div>...<!--container-->`.
          // In this case, there are nodes *after* this element and we need to skip those.
          // `+1` stands for an anchor comment node after all the views in this container.
          const nodesToSkip = calcViewContainerSize(previousNodeHydrationInfo.views) + 1;
          previousRElement = siblingAfter(nodesToSkip, previousRElement)!;
          // TODO: add an assert that `previousRElement` is a comment node.
        }
        native = previousRElement.nextSibling as RElement;
      }
    }
  }
  return native as T;
}

export function calcViewContainerSize(views: NghView[]): number {
  let numNodes = 0;
  for (let view of views) {
    numNodes += view.numRootNodes;
  }
  return numNodes;
}

export function siblingAfter<T extends RNode>(skip: number, from: RNode): T|null {
  let currentNode = from;
  for (let i = 0; i < skip; i++) {
    currentNode = currentNode.nextSibling!;
    ngDevMode && assertDefined(currentNode, 'Expected more siblings to be present');
  }
  return currentNode as T;
}

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

  ngDevMode && assertRComment(currentRNode, 'Expecting a comment node as a view container anchor');

  return [currentRNode, dehydratedViews];
}
