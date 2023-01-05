/**
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */
import {assertEqual, assertIndexInRange} from '../../util/assert';
import {assertRText} from '../assert';
import {TElementNode, TNodeType} from '../interfaces/node';
import {RElement, RText} from '../interfaces/renderer_dom';
import {DECLARATION_COMPONENT_VIEW, HEADER_OFFSET, HOST, HYDRATION_INFO, RENDERER, T_HOST} from '../interfaces/view';
import {appendChild, createTextNode, findExistingNode} from '../node_manipulation';
import {getBindingIndex, getCurrentTNode, getLView, getTView, isCurrentTNodeParent, setCurrentTNode} from '../state';
import {getNativeByTNode} from '../util/view_utils';

import {getOrCreateTNode, locateNextRNode} from './shared';



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
  if (ngh) {
    debugger;
    textNative =
        locateNextRNode(ngh, tView, lView, tNode, previousTNode, previousTNodeParent) as RText;
    ngDevMode && assertRText(textNative, 'Expecting a text node in the `text` instruction');
  } else {
    textNative = createTextNode(lView[RENDERER], value);
  }

  lView[adjustedIndex] = textNative;
  !ngh && appendChild(tView, lView, textNative, tNode);

  // Text nodes are self closing.
  setCurrentTNode(tNode, false);
}
