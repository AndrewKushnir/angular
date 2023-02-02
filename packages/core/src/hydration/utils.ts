/**
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */

import {ViewRef} from '../linker';
import {getDocument} from '../render3/interfaces/document';
import {RElement, RNode} from '../render3/interfaces/renderer_dom';
import {isRootView} from '../render3/interfaces/type_checks';
import {HEADER_OFFSET} from '../render3/interfaces/view';

import {decompressNghInfo} from './compression';
import {NghDom} from './interfaces';

export const NGH_ATTR_NAME = 'ngh';
export const EMPTY_TEXT_NODE_COMMENT = 'ngetn';
export const TEXT_NODE_SEPARATOR_COMMENT = 'ngtns';

/**
 * Reference to a function that reads `ngh` attribute from
 * a given RNode. Returns `null` by default, when hydration is not enabled.
 * @param rNode
 */
let _retrieveNghInfoImpl: typeof retrieveNghInfoImpl = (rNode: RElement) => null;

function retrieveNghInfoImpl(rNode: RElement): NghDom|null {
  let nghInfo: NghDom|null = null;
  const nghAttrValue = (rNode as HTMLElement).getAttribute(NGH_ATTR_NAME);
  if (nghAttrValue) {
    nghInfo = decompressNghInfo(nghAttrValue);
    nghInfo.firstChild = (rNode as HTMLElement).firstChild as HTMLElement;
    rNode.removeAttribute(NGH_ATTR_NAME);
    // Note: don't check whether this node was claimed for hydration,
    // because this node might've been previously claimed while processing
    // template instructions.
    ngDevMode && markRNodeAsClaimedForHydration(rNode, /* checkIfAlreadyClaimed */ false);
    ngDevMode && ngDevMode.hydratedComponents++;
  }
  return nghInfo;
}

export function enableRetrieveNghInfoImpl() {
  _retrieveNghInfoImpl = retrieveNghInfoImpl;
}

export function retrieveNghInfo(rNode: RElement): NghDom|null {
  return _retrieveNghInfoImpl(rNode);
}

export function getComponentLView(viewRef: ViewRef) {
  let lView = (viewRef as any)._lView;
  if (isRootView(lView)) {
    lView = lView[HEADER_OFFSET];
  }
  return lView;
}


type ClaimedNode = {
  __claimed?: boolean
};

export let processTextNodeMarkersBeforeHydration: typeof processTextNodeMarkersBeforeHydrationImpl =
    (node: HTMLElement) => {};  // noop by default

export function enableTextNodeMarkersProcessing() {
  processTextNodeMarkersBeforeHydration = processTextNodeMarkersBeforeHydrationImpl;
}

export function processTextNodeMarkersBeforeHydrationImpl(node: HTMLElement) {
  const doc = getDocument();
  const commentIterator = doc.createNodeIterator(node, NodeFilter.SHOW_COMMENT, {
    acceptNode(node) {
      const content = node.textContent;
      const isTextNodeMarker =
          content === EMPTY_TEXT_NODE_COMMENT || content === TEXT_NODE_SEPARATOR_COMMENT;
      return isTextNodeMarker ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
    }
  });
  let currentNode: Comment;
  while (currentNode = commentIterator.nextNode() as Comment) {
    if (currentNode.textContent === EMPTY_TEXT_NODE_COMMENT) {
      currentNode.replaceWith(doc.createTextNode(''));
    } else {
      currentNode.remove();
    }
  }
}

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
