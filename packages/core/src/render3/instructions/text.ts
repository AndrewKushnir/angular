/**
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */
import {assertEqual, assertIndexInRange} from '../../util/assert';
import {assertRText} from '../assert';
import {locateNextRNode, markRNodeAsClaimedForHydration} from '../hydration';
import {TElementNode, TNodeType} from '../interfaces/node';
import {RText} from '../interfaces/renderer_dom';
import {HEADER_OFFSET, HYDRATION_INFO, RENDERER} from '../interfaces/view';
import {appendChild, createTextNode} from '../node_manipulation';
import {getBindingIndex, getCurrentTNode, getLView, getTView, isCurrentTNodeParent, isInNonHydratableBlock, setCurrentTNode} from '../state';

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

  let textNative: RText;
  const ngh = lView[HYDRATION_INFO];
  const isCreating = !ngh || isInNonHydratableBlock();
  if (isCreating) {
    textNative = createTextNode(lView[RENDERER], value);
  } else {
    // hydrating
    textNative =
        locateNextRNode(ngh, tView, lView, tNode, previousTNode, previousTNodeParent) as RText;
    ngDevMode &&
        assertRText(
            textNative,
            `Expecting a text node (with the '${value}' value) in the text instruction`);
    ngDevMode && markRNodeAsClaimedForHydration(textNative);
  }

  lView[adjustedIndex] = textNative;
  isCreating && appendChild(tView, lView, textNative, tNode);

  // Text nodes are self closing.
  setCurrentTNode(tNode, false);
}
