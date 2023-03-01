/**
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */

import {validateMatchingNode} from '../../hydration/error_handling';
import {CONTAINERS, NUM_ROOT_NODES, VIEWS} from '../../hydration/interfaces';
import {locateNextRNode, siblingAfter} from '../../hydration/node_lookup_utils';
import {isNodeDisconnected, markRNodeAsClaimedForHydration} from '../../hydration/utils';
import {locateDehydratedViewsInContainer} from '../../hydration/views';
import {assertDefined, assertEqual, assertIndexInRange} from '../../util/assert';
import {assertHasParent} from '../assert';
import {attachPatchData} from '../context_discovery';
import {registerPostOrderHooks} from '../hooks';
import {TAttributes, TElementContainerNode, TNode, TNodeType} from '../interfaces/node';
import {RComment} from '../interfaces/renderer_dom';
import {isContentQueryHost, isDirectiveHost} from '../interfaces/type_checks';
import {HEADER_OFFSET, HYDRATION, LView, RENDERER, TView} from '../interfaces/view';
import {assertTNodeType} from '../node_assert';
import {appendChild} from '../node_manipulation';
import {getBindingIndex, getCurrentTNode, getLView, getTView, isCurrentTNodeParent, isInSkipHydrationBlock, setCurrentTNode, setCurrentTNodeAsNotParent} from '../state';
import {computeStaticStyling} from '../styling/static_styling';
import {getConstant} from '../util/view_utils';

import {createDirectivesInstances, executeContentQueries, getOrCreateTNode, resolveDirectives, saveResolvedLocalsInData} from './shared';

function elementContainerStartFirstCreatePass(
    index: number, tView: TView, lView: LView, attrsIndex?: number|null,
    localRefsIndex?: number): TElementContainerNode {
  ngDevMode && ngDevMode.firstCreatePass++;

  const tViewConsts = tView.consts;
  const attrs = getConstant<TAttributes>(tViewConsts, attrsIndex);
  const tNode = getOrCreateTNode(tView, index, TNodeType.ElementContainer, 'ng-container', attrs);

  // While ng-container doesn't necessarily support styling, we use the style context to identify
  // and execute directives on the ng-container.
  if (attrs !== null) {
    computeStaticStyling(tNode, attrs, true);
  }

  const localRefs = getConstant<string[]>(tViewConsts, localRefsIndex);
  resolveDirectives(tView, lView, tNode, localRefs);

  if (tView.queries !== null) {
    tView.queries.elementStart(tView, tNode);
  }

  return tNode;
}

/**
 * Creates a logical container for other nodes (<ng-container>) backed by a comment node in the DOM.
 * The instruction must later be followed by `elementContainerEnd()` call.
 *
 * @param index Index of the element in the LView array
 * @param attrsIndex Index of the container attributes in the `consts` array.
 * @param localRefsIndex Index of the container's local references in the `consts` array.
 * @returns This function returns itself so that it may be chained.
 *
 * Even if this instruction accepts a set of attributes no actual attribute values are propagated to
 * the DOM (as a comment node can't have attributes). Attributes are here only for directive
 * matching purposes and setting initial inputs of directives.
 *
 * @codeGenApi
 */
export function ɵɵelementContainerStart(
    index: number, attrsIndex?: number|null,
    localRefsIndex?: number): typeof ɵɵelementContainerStart {
  const lView = getLView();
  const tView = getTView();
  const adjustedIndex = index + HEADER_OFFSET;

  ngDevMode && assertIndexInRange(lView, adjustedIndex);
  ngDevMode &&
      assertEqual(
          getBindingIndex(), tView.bindingStartIndex,
          'element containers should be created before any bindings');

  const tNode = tView.firstCreatePass ?
      elementContainerStartFirstCreatePass(
          adjustedIndex, tView, lView, attrsIndex, localRefsIndex) :
      tView.data[adjustedIndex] as TElementContainerNode;

  const [isNewlyCreatedNode, comment] =
      _locateOrCreateElementContainerNode(tView, lView, tNode, adjustedIndex);
  lView[adjustedIndex] = comment;

  setCurrentTNode(tNode, true);

  isNewlyCreatedNode && appendChild(tView, lView, comment, tNode);
  attachPatchData(comment, lView);

  if (isDirectiveHost(tNode)) {
    createDirectivesInstances(tView, lView, tNode);
    executeContentQueries(tView, tNode, lView);
  }

  if (localRefsIndex != null) {
    saveResolvedLocalsInData(lView, tNode);
  }

  return ɵɵelementContainerStart;
}

/**
 * Mark the end of the <ng-container>.
 * @returns This function returns itself so that it may be chained.
 *
 * @codeGenApi
 */
export function ɵɵelementContainerEnd(): typeof ɵɵelementContainerEnd {
  let currentTNode = getCurrentTNode()!;
  const tView = getTView();
  if (isCurrentTNodeParent()) {
    setCurrentTNodeAsNotParent();
  } else {
    ngDevMode && assertHasParent(currentTNode);
    currentTNode = currentTNode.parent!;
    setCurrentTNode(currentTNode, false);
  }

  ngDevMode && assertTNodeType(currentTNode, TNodeType.ElementContainer);

  if (tView.firstCreatePass) {
    registerPostOrderHooks(tView, currentTNode);
    if (isContentQueryHost(currentTNode)) {
      tView.queries!.elementEnd(currentTNode);
    }
  }
  return ɵɵelementContainerEnd;
}

/**
 * Creates an empty logical container using {@link elementContainerStart}
 * and {@link elementContainerEnd}
 *
 * @param index Index of the element in the LView array
 * @param attrsIndex Index of the container attributes in the `consts` array.
 * @param localRefsIndex Index of the container's local references in the `consts` array.
 * @returns This function returns itself so that it may be chained.
 *
 * @codeGenApi
 */
export function ɵɵelementContainer(
    index: number, attrsIndex?: number|null, localRefsIndex?: number): typeof ɵɵelementContainer {
  ɵɵelementContainerStart(index, attrsIndex, localRefsIndex);
  ɵɵelementContainerEnd();
  return ɵɵelementContainer;
}

let _locateOrCreateElementContainerNode: typeof locateOrCreateElementContainerNode =
    (tView: TView, lView: LView, tNode: TNode, adjustedIndex: number) => {
      const comment = lView[RENDERER].createComment(ngDevMode ? 'ng-container' : '');
      return [true, comment];
    }

function locateOrCreateElementContainerNode(
    tView: TView, lView: LView, tNode: TNode, adjustedIndex: number): [boolean, RComment] {
  let comment: RComment;
  const index = adjustedIndex - HEADER_OFFSET;
  const ngh = lView[HYDRATION];
  const isCreating = !ngh || isInSkipHydrationBlock() || isNodeDisconnected(ngh, index);
  if (isCreating) {
    ngDevMode && ngDevMode.rendererCreateComment++;
    comment = lView[RENDERER].createComment(ngDevMode ? 'ng-container' : '');
  } else {
    const nghContainer = ngh.data[CONTAINERS]?.[index]!;
    ngh.elementContainers ??= {};

    ngDevMode &&
        assertDefined(
            nghContainer, 'There is no hydration info available for this element container');

    const currentRNode = locateNextRNode(ngh, tView, lView, tNode);

    if (nghContainer[VIEWS] && nghContainer[VIEWS].length > 0) {
      // This <ng-container> is also annotated as a view container.
      // Extract all dehydrated views following instructions from ngh
      // and store this info for later reuse in `createContainerRef`.
      const [anchorRNode, dehydratedViews] =
          locateDehydratedViewsInContainer(currentRNode!, nghContainer);

      comment = anchorRNode as RComment;

      if (dehydratedViews.length > 0) {
        // Store dehydrated views info in ngh data structure for later reuse
        // while creating a ViewContainerRef instance, see `createContainerRef`.
        ngh.elementContainers[index] = {dehydratedViews};
      }
    } else {
      // This is a plain `<ng-container>`, which is *not* used
      // as the ViewContainerRef anchor, so we can rely on `numRootNodes`.
      //
      // Store a reference to the first node in a container,
      // so it can be referenced while invoking further instructions.
      ngh.elementContainers[index] = {firstChild: currentRNode as HTMLElement};

      comment = siblingAfter<RComment>(nghContainer[NUM_ROOT_NODES]!, currentRNode!)!;
    }

    ngDevMode &&
        validateMatchingNode(comment as unknown as Node, Node.COMMENT_NODE, null, lView, tNode);
    ngDevMode && markRNodeAsClaimedForHydration(comment);
  }
  return [isCreating, comment];
}

export function enableLocateOrCreateElementContainerNodeImpl() {
  _locateOrCreateElementContainerNode = locateOrCreateElementContainerNode;
}
