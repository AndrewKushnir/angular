/**
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */

import {PLATFORM_ID, TRANSFER_STATE} from '../application_tokens';
import {Injector} from '../di/injector';
import {ViewRef} from '../linker';
import {ViewEncapsulation} from '../metadata/view';
import {getDocument} from '../render3/interfaces/document';
import {Renderer} from '../render3/interfaces/renderer';
import {RElement, RNode} from '../render3/interfaces/renderer_dom';
import {isRootView} from '../render3/interfaces/type_checks';
import {HEADER_OFFSET} from '../render3/interfaces/view';
import {assertDefined} from '../util/assert';

import {NGH_DATA_KEY} from './annotate';
import {IS_HYDRATION_FEATURE_ENABLED} from './api';
import {NghDom, NghDomInstance, NODES} from './interfaces';

export const NGH_ATTR_NAME = 'ngh';
export const EMPTY_TEXT_NODE_COMMENT = 'ngetn';
export const TEXT_NODE_SEPARATOR_COMMENT = 'ngtns';

/**
 * Reference to a function that reads `ngh` attribute from
 * a given RNode. Returns `null` by default, when hydration is not enabled.
 * @param rNode
 */
let _retrieveNghInfoImpl: typeof retrieveNghInfoImpl = (rNode: RElement, injector: Injector) =>
    null;

function retrieveNghInfoImpl(rNode: RElement, injector: Injector): NghDomInstance|null {
  const nghAttrValue = (rNode as HTMLElement).getAttribute(NGH_ATTR_NAME);
  const transferState = injector.get(TRANSFER_STATE, null, {optional: true});
  if (transferState !== null) {
    const nghData = transferState.get(NGH_DATA_KEY, []) ?? [];
    if (nghAttrValue != null) {
      let data: NghDom = {};
      if (nghAttrValue !== '') {
        data = nghData[Number(nghAttrValue)];

        // If the `ngh` attribute exists and has a non-empty value,
        // the hydration info *must* be present in the TransferState.
        // If there is no data for some reasons, this is an error.
        ngDevMode &&
            assertDefined(data, 'Unable to retrieve hydration info from the TransferState.');
      }
      const nghDomInstance: NghDomInstance = {
        data,
        firstChild: (rNode as HTMLElement).firstChild as HTMLElement,
      };
      rNode.removeAttribute(NGH_ATTR_NAME);
      // Note: don't check whether this node was claimed for hydration,
      // because this node might've been previously claimed while processing
      // template instructions.
      ngDevMode && markRNodeAsClaimedForHydration(rNode, /* checkIfAlreadyClaimed */ false);
      ngDevMode && ngDevMode.hydratedComponents++;

      return nghDomInstance;
    }
  }
  return null;
}

export function enableRetrieveNghInfoImpl() {
  _retrieveNghInfoImpl = retrieveNghInfoImpl;
}

export function retrieveNghInfo(rNode: RElement, injector: Injector): NghDomInstance|null {
  return _retrieveNghInfoImpl(rNode, injector);
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

export function processTextNodeMarkersBeforeHydration(node: HTMLElement) {
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

export function locateHostElementImpl(
    renderer: Renderer, elementOrSelector: RElement|string, encapsulation: ViewEncapsulation,
    injector: Injector): RElement {
  const isHydrationEnabled = injector.get(IS_HYDRATION_FEATURE_ENABLED, false);

  // FIXME: this is a fix to the problem that happens in tests :(
  // We load extra code from `provideHydrationSupport` fn, but it is retained
  // throughout the execution of all tests, thus also making it into
  // SSR code path. We should investigate how to avoid this check here.
  const isBrowser = injector.get(PLATFORM_ID) === 'browser';

  const preserveContent =
      (isBrowser && isHydrationEnabled) || encapsulation === ViewEncapsulation.ShadowDom;
  const rootElement = renderer.selectRootElement(elementOrSelector, preserveContent);
  if (isHydrationEnabled) {
    processTextNodeMarkersBeforeHydration(rootElement as HTMLElement);
  }
  return rootElement;
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

/**
 * Special marker that indicates that this node was dropped
 * during content projection. We need to re-create this node
 * from scratch during hydration.
 */
export const DROPPED_PROJECTED_NODE = 'd';

/**
 * Checks whether a node is annotated as "disconnected", i.e. not present
 * in live DOM at serialization time.
 */
export function isNodeDisconnected(hydrationInfo: NghDomInstance, index: number): boolean {
  return hydrationInfo.data[NODES]?.[index] === DROPPED_PROJECTED_NODE;
}
