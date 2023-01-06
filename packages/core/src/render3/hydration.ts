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
import {assertDefined} from '../util/assert';

import {readPatchedLView} from './context_discovery';
import {CONTAINER_HEADER_OFFSET, DEHYDRATED_VIEWS, LContainer} from './interfaces/container';
import {TNode, TNodeType} from './interfaces/node';
import {RElement, RNode} from './interfaces/renderer_dom';
import {isLContainer, isRootView} from './interfaces/type_checks';
import {HEADER_OFFSET, LView, NghDom, NghView, TView, TVIEW} from './interfaces/view';
import {getNativeByTNode, unwrapRNode} from './util/view_utils';

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
      debugger;
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
    debugger;
    throw new Error(`findExistingNode: failed to find node at ${path}.`);
  }
  return node as unknown as RNode;
}

function locateRNodeByPath(path: string, lView: LView): RNode {
  const pathParts = path.split('.');
  // First element is a parent node id: `12.nextSibling...`.
  const parentElementId = Number(pathParts.shift()!);
  const parentRNode = unwrapRNode((lView as any)[parentElementId + HEADER_OFFSET]);
  return findExistingNode(parentRNode as Element, pathParts);
}

export function locateNextRNode<T extends RNode>(
    hydrationInfo: NghDom, tView: TView, lView: LView<unknown>, tNode: TNode,
    previousTNode: TNode|null, previousTNodeParent: boolean): T|null {
  let native: RNode|null = null;
  const adjustedIndex = tNode.index - HEADER_OFFSET;
  if (hydrationInfo.nodes[adjustedIndex]) {
    // We know exact location of the node.
    native = locateRNodeByPath(hydrationInfo.nodes[adjustedIndex], lView);
    debugger;
  } else if (tView.firstChild === tNode) {
    // We create a first node in this view.
    native = hydrationInfo.firstChild;
  } else {
    ngDevMode && assertDefined(previousTNode, 'Unexpected state: no current TNode found.');
    const previousRElement = getNativeByTNode(previousTNode!, lView) as RElement;
    // TODO: we may want to use this instead?
    // const closest = getClosestRElement(tView, previousTNode, lView);
    if (previousTNodeParent && previousTNode!.type === TNodeType.ElementContainer) {
      // Previous node was an `<ng-container>`, so this node is a first child
      // within an element container, so we can locate the container in ngh data
      // structure and use its first child.
      const sContainer = hydrationInfo.containers[previousTNode!.index - HEADER_OFFSET];
      if (ngDevMode && !sContainer) {
        throw new Error('Invalid state.');
      }
      native = sContainer.firstChild!;
    } else {
      if (previousTNodeParent) {
        native = (previousRElement as any).firstChild;
      } else {
        native = previousRElement.nextSibling as RElement;
      }
    }
  }
  return native as T;
}

export function siblingAfter<T extends RNode>(skip: number, from: RNode): T|null {
  let currentNode = from;
  for (let i = 0; i < skip; i++) {
    currentNode = currentNode.nextSibling!;
    ngDevMode && assertDefined(currentNode, 'Expected more siblings to be present');
  }
  return currentNode as T;
}
