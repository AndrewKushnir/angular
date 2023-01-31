/**
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */

import {NghContainer, NghDom, NghView} from '../hydration/interfaces';
import {assertDefined} from '../util/assert';

import {assertRComment} from './assert';
import {TNode, TNodeType} from './interfaces/node';
import {RElement, RNode} from './interfaces/renderer_dom';
import {HEADER_OFFSET, LView, TView} from './interfaces/view';
import {ɵɵresolveBody} from './util/misc_utils';
import {getNativeByTNode, unwrapRNode} from './util/view_utils';

type ClaimedNode = {
  __claimed?: boolean
};

// TODO: consider using WeakMap instead.
export function markRNodeAsClaimedForHydration(node: RNode, checkIfAlreadyClaimed = true) {
  if (!ngDevMode) {
    throw new Error('Calling `claimNode` in prod mode is not supported and likely a mistake.');
  }
  if (checkIfAlreadyClaimed && isRNodeClaimedForHydration(node)) {
    throw new Error('Trying to claim a node, which was claimed already.');
  }
  (node as ClaimedNode).__claimed = true;
  ngDevMode.hydratedNodes++;
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
  } else if (firstPathPart === 'body') {
    const body = ɵɵresolveBody(lView[0] as unknown as RElement & {ownerDocument: Document});
    return findExistingNode(body, pathParts);
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
    native = hydrationInfo.firstChild as RNode;
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

/**
 * Special marker that indicates that this node was dropped
 * during content projection. We need to re-create this node
 * from scratch during hydration.
 */
const DROPPED_PROJECTED_NODE = '-';

/**
 * Checks whether a node is annotated as "disconnected", i.e. not present
 * in live DOM at serialization time.
 */
export function isNodeDisconnected(hydrationInfo: NghDom, index: number): boolean {
  return hydrationInfo.nodes[index] === DROPPED_PROJECTED_NODE;
}