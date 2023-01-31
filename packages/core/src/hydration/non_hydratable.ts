/**
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */

import {assertTNodeForLView} from '../render3/assert';
import {getTNodeFromLView} from '../render3/di';
import {TContainerNode, TElementNode, TNode} from '../render3/interfaces/node';
import {DECLARATION_VIEW, LView} from '../render3/interfaces/view';

export const NON_HYDRATABLE_ATTR_NAME = 'ngNonHydratable';

/**
 * Helper function to walk up parent nodes using TNode data structure, crossing
 * view boundaries if needed, calling `predicateFn` at each level (with the current
 * TNode as an argument). The process stops when predicate return `true` for
 * the first time. If `predicateFn` never returned `true` after reaching the root
 * view, the function returns `false`.
 *
 * @param tNode
 * @param lView
 * @param predicateFn
 * @returns
 */
export function navigateParentTNodes(
    tNode: TNode, lView: LView, predicateFn: (tNode: TNode) => boolean): TNode|null {
  let currentTNode: TNode|null = tNode;
  let currentLView: LView|null = lView;

  while (currentTNode !== null && currentLView !== null) {
    ngDevMode && assertTNodeForLView(currentTNode, currentLView);

    if (predicateFn(currentTNode)) {
      return currentTNode;
    }

    // Has an explicit type due to a TS bug: https://github.com/microsoft/TypeScript/issues/33191
    let parentTNode: TElementNode|TContainerNode|null = currentTNode.parent;

    // `TNode.parent` includes the parent within the current view only. If it doesn't exist,
    // it means that we've hit the view boundary and we need to go up to the next view.
    if (!parentTNode) {
      // Keep going up the tree.
      parentTNode = getTNodeFromLView(currentLView);
      currentLView = currentLView[DECLARATION_VIEW];
    }

    currentTNode = parentTNode;
  }

  return null;
}

export function hasNgNonHydratableAttr(tNode: TNode): boolean {
  // TODO: we need to iterate over `tNode.mergedAttrs` better
  // to avoid cases when `ngNonHydratable` is an attribute value,
  // e.g. `<div title="ngNonHydratable"></div>`.
  return !!tNode.mergedAttrs?.includes(NON_HYDRATABLE_ATTR_NAME);
}

export function isInNonHydratableBlock(tNode: TNode, lView: LView): boolean {
  const foundTNode = navigateParentTNodes(tNode as TNode, lView, hasNgNonHydratableAttr);
  // We are in a non-hydratable block when:
  // - we have a TNode
  // - the tNode is different than the root node
  return foundTNode !== null && foundTNode !== tNode;
}
