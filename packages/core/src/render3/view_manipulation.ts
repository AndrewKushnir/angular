/**
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */

import {Injector} from '../di/injector';
import {DehydratedContainerView} from '../hydration/interfaces';
import {assertDefined} from '../util/assert';

import {assertLContainer, assertLView} from './assert';
import {renderView} from './instructions/render';
import {createLView} from './instructions/shared';
import {CONTAINER_HEADER_OFFSET, LContainer, NATIVE} from './interfaces/container';
import {TContainerNode} from './interfaces/node';
import {RComment, RElement} from './interfaces/renderer_dom';
import {DECLARATION_LCONTAINER, FLAGS, LView, LViewFlags, QUERIES, RENDERER, T_HOST, TVIEW} from './interfaces/view';
import {addViewToDOM, destroyLView, detachView, getBeforeNodeForView, insertView, nativeParentNode} from './node_manipulation';

export function createAndRenderEmbeddedLView<T>(
    hostLView: LView<unknown>, templateTNode: TContainerNode, context: T,
    options?: {injector?: Injector, hydrationInfo?: DehydratedContainerView}): LView<T> {
  const embeddedTView = templateTNode.tView!;

  ngDevMode && assertDefined(embeddedTView, 'TView must be defined for a template node.');

  // Embedded views follow the change detection strategy of the view they're declared in.
  const isSignalView = hostLView[FLAGS] & LViewFlags.SignalView;
  const viewFlags = isSignalView ? LViewFlags.SignalView : LViewFlags.CheckAlways;
  const embeddedLView = createLView<T>(
      hostLView, embeddedTView, context, viewFlags, null, embeddedTView.declTNode, null, null, null,
      options?.injector ?? null, options?.hydrationInfo ?? null);

  const declarationLContainer = hostLView[templateTNode.index];
  ngDevMode && assertLContainer(declarationLContainer);
  embeddedLView[DECLARATION_LCONTAINER] = declarationLContainer;

  const declarationViewLQueries = hostLView[QUERIES];
  if (declarationViewLQueries !== null) {
    embeddedLView[QUERIES] = declarationViewLQueries.createEmbeddedView(embeddedTView);
  }

  // execute creation mode of a view
  renderView(embeddedTView, embeddedLView, context);

  return embeddedLView;
}

export function getLViewFromLContainer<T>(lContainer: LContainer, index: number): LView<T>|
    undefined {
  if (lContainer.length > CONTAINER_HEADER_OFFSET + index) {
    const lView = lContainer[CONTAINER_HEADER_OFFSET];
    ngDevMode && assertLView(lView);
    return lView as LView<T>;
  }
  return undefined;
}

export function addLViewToLContainer(
    lContainer: LContainer, lView: LView<unknown>, index: number, addTomDOM = true): void {
  const tView = lView[TVIEW];

  // insert to the view tree so the new view can be change-detected
  insertView(tView, lView, lContainer, index);

  // insert to the view to the DOM tree
  if (addTomDOM) {
    const beforeNode = getBeforeNodeForView(index, lContainer);
    const renderer = lView[RENDERER];
    const parentRNode = nativeParentNode(renderer, lContainer[NATIVE] as RElement | RComment);
    if (parentRNode !== null) {
      addViewToDOM(tView, lContainer[T_HOST], renderer, lView, parentRNode, beforeNode);
    }
  }
}

export function removeLViewFromLContainer(lContainer: LContainer, index: number): LView<unknown>|
    undefined {
  const lView = detachView(lContainer, index);
  if (lView !== undefined) {
    destroyLView(lView[TVIEW], lView);
  }
  return lView;
}
