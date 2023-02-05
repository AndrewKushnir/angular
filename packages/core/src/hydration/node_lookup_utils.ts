/**
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */

import {CONTAINERS, NghDom, NghView, NODES, NUM_ROOT_NODES, VIEWS} from '../hydration/interfaces';
import {TNode, TNodeType} from '../render3/interfaces/node';
import {RElement, RNode} from '../render3/interfaces/renderer_dom';
import {HEADER_OFFSET, LView, TView} from '../render3/interfaces/view';
import {ɵɵresolveBody} from '../render3/util/misc_utils';
import {getNativeByTNode, unwrapRNode} from '../render3/util/view_utils';
import {assertDefined} from '../util/assert';

import {compressNodeLocation, decompressNodeLocation} from './compression';

export const REFERENCE_NODE_HOST = 'h';
export const REFERENCE_NODE_BODY = 'b';

export enum NodeNavigationStep {
  FirstChild = 'f',
  NextSibling = 'n',
}

export class NoPathFoundError extends Error {}

function describeNode(node: Node): string {
  // TODO: if it's a text node - output `#text(CONTENT)`,
  // if it's a comment node - output `#comment(CONTENT)`.
  return (node as Element).tagName ?? node.nodeType;
}

/**
 * Generate a list of DOM navigation operations to get from node `start` to node `finish`.
 *
 * Note: assumes that node `start` occurs before node `finish` in an in-order traversal of the DOM
 * tree. That is, we should be able to get from `start` to `finish` purely by using `.firstChild`
 * and `.nextSibling` operations.
 */
export function navigateBetween(start: Node, finish: Node): NodeNavigationStep[] {
  if (start === finish) {
    return [];
  } else if (start.parentElement == null || finish.parentElement == null) {
    const startNodeInfo = describeNode(start);
    const finishNodeInfo = describeNode(finish);
    throw new NoPathFoundError(
        `Ran off the top of the document when navigating between nodes: ` +
        `'${startNodeInfo}' and '${finishNodeInfo}'.`);
  } else if (start.parentElement === finish.parentElement) {
    return navigateBetweenSiblings(start, finish);
  } else {
    // `finish` is a child of its parent, so the parent will always have a child.
    const parent = finish.parentElement!;
    return [
      // First navigate to `finish`'s parent.
      ...navigateBetween(start, parent),
      // Then to its first child.
      NodeNavigationStep.FirstChild,
      // And finally from that node to `finish` (maybe a no-op if we're already there).
      ...navigateBetween(parent.firstChild!, finish),
    ];
  }
}

function navigateBetweenSiblings(start: Node, finish: Node): NodeNavigationStep[] {
  const nav: NodeNavigationStep[] = [];
  let node: Node|null = null;
  for (node = start; node != null && node !== finish; node = node.nextSibling) {
    nav.push(NodeNavigationStep.NextSibling);
  }
  if (node === null) {
    // throw new Error(`Is finish before start? Hit end of siblings before finding start`);
    console.log(`Is finish before start? Hit end of siblings before finding start`);
    return [];
  }
  return nav;
}

export function calcPathBetween(from: Node, to: Node, parent: string): string|null {
  let path: NodeNavigationStep[] = [];
  try {
    path = navigateBetween(from, to);
  } catch (e: unknown) {
    if (e instanceof NoPathFoundError) {
      return null;
    }
  }
  return compressNodeLocation(parent, path);
}

function findExistingNode(host: Node, path: NodeNavigationStep[]): RNode {
  let node = host;
  for (const op of path) {
    if (!node) {
      // TODO: add a dev-mode assertion here.
      throw new Error(`findExistingNode: failed to find node at ${path}.`);
    }
    switch (op) {
      case NodeNavigationStep.FirstChild:
        node = node.firstChild!;
        break;
      case NodeNavigationStep.NextSibling:
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
  const [referenceNode, ...pathParts] = decompressNodeLocation(path);
  let ref: Element;
  if (referenceNode === REFERENCE_NODE_HOST) {
    ref = lView[0] as unknown as Element;
  } else if (referenceNode === REFERENCE_NODE_BODY) {
    ref = ɵɵresolveBody(lView[0] as unknown as RElement & {ownerDocument: Document});
  } else {
    const parentElementId = Number(referenceNode);
    ref = unwrapRNode((lView as any)[parentElementId + HEADER_OFFSET]) as Element;
  }
  return findExistingNode(ref, pathParts);
}

function calcViewContainerSize(views: NghView[]): number {
  let numNodes = 0;
  for (let view of views) {
    numNodes += view[NUM_ROOT_NODES];
  }
  return numNodes;
}

export function locateNextRNode<T extends RNode>(
    hydrationInfo: NghDom, tView: TView, lView: LView<unknown>, tNode: TNode,
    previousTNode: TNode|null, previousTNodeParent: boolean): T|null {
  let native: RNode|null = null;
  const adjustedIndex = tNode.index - HEADER_OFFSET;
  if (hydrationInfo[NODES]?.[adjustedIndex]) {
    // We know exact location of the node.
    native = locateRNodeByPath(hydrationInfo[NODES][adjustedIndex], lView);
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
      const nghContainer = hydrationInfo[CONTAINERS]?.[previousTNode!.index - HEADER_OFFSET];
      if (ngDevMode && !nghContainer) {
        // TODO: add better error message.
        throw new Error('Invalid state.');
      }
      native = nghContainer!.firstChild!;
    } else {
      // FIXME: this doesn't work for i18n :(
      // In i18n case, previous tNode is a parent element,
      // when in fact, it might be a text node in front of it.
      if (previousTNodeParent) {
        native = (previousRElement as any).firstChild;
      } else {
        const previousNodeHydrationInfo =
            hydrationInfo[CONTAINERS]?.[previousTNode!.index - HEADER_OFFSET];
        if (previousTNode!.type === TNodeType.Element && previousNodeHydrationInfo) {
          // If the previous node is an element, but it also has container info,
          // this means that we are processing a node like `<div #vcrTarget>`, which is
          // represented in live DOM as `<div></div>...<!--container-->`.
          // In this case, there are nodes *after* this element and we need to skip those.
          // `+1` stands for an anchor comment node after all the views in this container.
          const nodesToSkip = calcViewContainerSize(previousNodeHydrationInfo![VIEWS]!) + 1;
          previousRElement = siblingAfter(nodesToSkip, previousRElement)!;
          // TODO: add an assert that `previousRElement` is a comment node.
        }
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
