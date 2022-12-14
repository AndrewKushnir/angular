/**
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */
import {assertEqual, assertIndexInRange} from '../../util/assert';
import {TElementNode, TNodeType} from '../interfaces/node';
import {RText} from '../interfaces/renderer_dom';
import {DECLARATION_COMPONENT_VIEW, HEADER_OFFSET, HOST, HYDRATION_INFO, RENDERER, T_HOST} from '../interfaces/view';
import {appendChild, createTextNode, findExistingNode} from '../node_manipulation';
import {getBindingIndex, getLView, getTView, setCurrentTNode} from '../state';

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

  const ngh = lView[HYDRATION_INFO];


  ngDevMode &&
      assertEqual(
          getBindingIndex(), tView.bindingStartIndex,
          'text nodes should be created before any bindings');
  ngDevMode && assertIndexInRange(lView, adjustedIndex);

  const tNode = tView.firstCreatePass ?
      getOrCreateTNode(tView, adjustedIndex, TNodeType.Text, value, null) :
      tView.data[adjustedIndex] as TElementNode;

  let textNative: RText;
  if (ngh) {
    textNative =
        findExistingNode(
            lView[DECLARATION_COMPONENT_VIEW][HOST] as unknown as Node, ngh.nodes[index]) as RText;
  } else {
    textNative = createTextNode(lView[RENDERER], value);
  }

  lView[adjustedIndex] = textNative;
  !ngh && appendChild(tView, lView, textNative, tNode);

  // Text nodes are self closing.
  setCurrentTNode(tNode, false);
}
