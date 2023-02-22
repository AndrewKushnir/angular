/**
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */

import {validateMatchingNode} from '../../hydration/error_handling';
import {locateNextRNode} from '../../hydration/node_lookup_utils';
import {isNodeDisconnected, markRNodeAsClaimedForHydration} from '../../hydration/utils';
import {assertEqual, assertIndexInRange} from '../../util/assert';
import {TElementNode, TNode, TNodeType} from '../interfaces/node';
import {RText} from '../interfaces/renderer_dom';
import {HEADER_OFFSET, HYDRATION_INFO, LView, RENDERER, TView} from '../interfaces/view';
import {appendChild, createTextNode} from '../node_manipulation';
import {getBindingIndex, getCurrentTNode, getLView, getTView, isCurrentTNodeParent, isInSkipHydrationBlock, setCurrentTNode} from '../state';

import {getOrCreateTNode} from './shared';



/**
 * Create static text node
 *
 * @param index Index of the node in the data array
 * @param value Static string value to write.
 *
 * @codeGenApi
 */
export function ɵɵtext(index: number, value: string = ''): void {
  const lView = getLView();
  const tView = getTView();
  const adjustedIndex = index + HEADER_OFFSET;

  ngDevMode &&
      assertEqual(
          getBindingIndex(), tView.bindingStartIndex,
          'text nodes should be created before any bindings');
  ngDevMode && assertIndexInRange(lView, adjustedIndex);

  const previousTNode = getCurrentTNode();
  const previousTNodeParent = isCurrentTNodeParent();

  const tNode = tView.firstCreatePass ?
      getOrCreateTNode(tView, adjustedIndex, TNodeType.Text, value, null) :
      tView.data[adjustedIndex] as TElementNode;

  const [isNewlyCreatedNode, textNative] = _locateOrCreateTextNode(
      tView, lView, tNode, adjustedIndex, value, previousTNode!, previousTNodeParent);

  lView[adjustedIndex] = textNative;
  isNewlyCreatedNode && appendChild(tView, lView, textNative, tNode);

  // Text nodes are self closing.
  setCurrentTNode(tNode, false);
}

let _locateOrCreateTextNode: typeof locateOrCreateTextNodeImpl =
    (tView: TView, lView: LView, tNode: TNode, adjustedIndex: number, value: string,
     previousTNode: TNode, previousTNodeParent: boolean) => {
      return [true, createTextNode(lView[RENDERER], value)];
    }

function locateOrCreateTextNodeImpl(
    tView: TView, lView: LView, tNode: TNode, adjustedIndex: number, value: string,
    previousTNode: TNode, previousTNodeParent: boolean): [boolean, RText] {
  const ngh = lView[HYDRATION_INFO];
  const index = adjustedIndex - HEADER_OFFSET;
  const isCreating = !ngh || isInSkipHydrationBlock() || isNodeDisconnected(ngh, index);
  let textNative: RText;
  if (isCreating) {
    textNative = createTextNode(lView[RENDERER], value);
  } else {
    // hydrating
    textNative =
        locateNextRNode(ngh, tView, lView, tNode, previousTNode, previousTNodeParent) as RText;

    ngDevMode &&
        validateMatchingNode(
            textNative as Node, Node.TEXT_NODE, null, tNode,
            previousTNodeParent ? null : previousTNode);
    ngDevMode && markRNodeAsClaimedForHydration(textNative);
  }
  return [isCreating, textNative];
}

export function enableLocateOrCreateTextNodeImpl() {
  _locateOrCreateTextNode = locateOrCreateTextNodeImpl;
}
