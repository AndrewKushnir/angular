/**
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */

import {ComponentTemplate} from '../interfaces/definition';
import {TBlockNode, TNodeType} from '../interfaces/node';
import {HEADER_OFFSET, TView, TViewType} from '../interfaces/view';
import {getLView, getTView, setCurrentTNode} from '../state';

import {addToViewTree, createLContainer, createTView, getOrCreateTNode} from './shared';

/**
 * Represents a template that was created as a result of processing native control flow
 * constructs. For example, in the `{#if}...{:else}...{/if}` case, there will be 2 block
 * instructions generated and an extra instruction that orchestrates them (render corresponding
 * block based on a condition).
 *
 * @param index The index of the container in the data array
 * @param templateFn Inline template function
 * @param decls The number of nodes, local refs, and pipes for this template
 * @param vars The number of bindings for this template
 *
 * @codeGenApi
 */
export function ɵɵblock(
    index: number, templateFn: ComponentTemplate<any>|null, decls: number, vars: number) {
  const lView = getLView();
  const tView = getTView();
  const adjustedIndex = index + HEADER_OFFSET;

  const tNode = tView.firstCreatePass ?
      blockCreateFirstPass(tView, adjustedIndex, templateFn, decls, vars) :
      tView.data[adjustedIndex] as TBlockNode;

  // TODO: we will need a "lighter" version of LContainer for queries - in reality it is not about
  // LContainer but more about ability of reporting creation of views stamped out from this block
  addToViewTree(lView, lView[adjustedIndex] = createLContainer(null!, lView, null!, tNode));

  setCurrentTNode(tNode, false);
}

function blockCreateFirstPass(
    tView: TView, index: number, templateFn: ComponentTemplate<any>|null, decls: number,
    vars: number) {
  const tNode = getOrCreateTNode(tView, index, TNodeType.Block, null, null);

  const embeddedTView = tNode.tView = createTView(
      TViewType.Embedded, tNode, templateFn, decls, vars, tView.directiveRegistry,
      tView.pipeRegistry, null, tView.schemas, null /* consts */, null /* ssrId */);

  if (tView.queries !== null) {
    embeddedTView.queries = tView.queries.embeddedTView(tNode);
  }

  return tNode;
}
