/**
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */
import {assertDefined, assertEqual, assertIndexInRange} from '../../util/assert';
import {assertHasParent, assertRComment} from '../assert';
import {attachPatchData} from '../context_discovery';
import {registerPostOrderHooks} from '../hooks';
import {isNodeDisconnected, locateDehydratedViewsInContainer, locateNextRNode, markRNodeAsClaimedForHydration, siblingAfter} from '../hydration';
import {TAttributes, TElementContainerNode, TNodeType} from '../interfaces/node';
import {RComment, RElement} from '../interfaces/renderer_dom';
import {isContentQueryHost, isDirectiveHost} from '../interfaces/type_checks';
import {HEADER_OFFSET, HYDRATION_INFO, LView, NghView, RENDERER, TView} from '../interfaces/view';
import {assertTNodeType} from '../node_assert';
import {appendChild} from '../node_manipulation';
import {getBindingIndex, getCurrentTNode, getLView, getTView, isCurrentTNodeParent, isInNonHydratableBlock, setCurrentTNode, setCurrentTNodeAsNotParent} from '../state';
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

  const previousTNode = getCurrentTNode();
  const previousTNodeParent = isCurrentTNodeParent();

  const tNode = tView.firstCreatePass ?
      elementContainerStartFirstCreatePass(
          adjustedIndex, tView, lView, attrsIndex, localRefsIndex) :
      tView.data[adjustedIndex] as TElementContainerNode;

  let native: RComment;
  const ngh = lView[HYDRATION_INFO];
  const isCreating = !ngh || isInNonHydratableBlock() || isNodeDisconnected(ngh, index);
  if (isCreating) {
    ngDevMode && ngDevMode.rendererCreateComment++;
    native = lView[RENDERER].createComment(ngDevMode ? 'ng-container' : '');
  } else {
    const nghContainer = ngh.containers[index];
    ngDevMode &&
        assertDefined(
            nghContainer, 'There is no hydration info available for this element container');

    const currentRNode =
        locateNextRNode(ngh, tView, lView, tNode, previousTNode, previousTNodeParent);

    if (nghContainer.views.length > 0) {
      // This <ng-container> is also annotated as a view container.
      // Extract all dehydrated views following instructions from ngh
      // and store this info for later reuse in `createContainerRef`.
      const [anchorRNode, views] = locateDehydratedViewsInContainer(currentRNode!, nghContainer);

      native = anchorRNode as RComment;

      if (views.length > 0) {
        // Store dehydrated views info in ngh data structure for later reuse
        // while creating a ViewContainerRef instance, see `createContainerRef`.
        nghContainer.dehydratedViews = views;
      }
    } else {
      // This is a plain `<ng-container>`, which is *not* used
      // as the ViewContainerRef anchor, so we can rely on `numRootNodes`.
      //
      // Store a reference to the first node in a container,
      // so it can be referenced while invoking further instructions.
      nghContainer.firstChild = currentRNode as HTMLElement;

      native = siblingAfter<RComment>(nghContainer.numRootNodes!, currentRNode!)!;
    }

    ngDevMode && assertRComment(native, 'Expecting a comment node in elementContainer instruction');
    ngDevMode && markRNodeAsClaimedForHydration(native);
  }
  lView[adjustedIndex] = native;

  setCurrentTNode(tNode, true);

  isCreating && appendChild(tView, lView, native, tNode);
  attachPatchData(native, lView);

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
