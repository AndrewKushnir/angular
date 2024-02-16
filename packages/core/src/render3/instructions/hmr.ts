/**
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */

import {Type, ViewRef} from '../../core';
import {getComponentDef} from '../definition';
import {NG_COMP_DEF} from '../fields';
import {CONTAINER_HEADER_OFFSET, LContainer} from '../interfaces/container';
import {ComponentDef} from '../interfaces/definition';
import {TElementNode, TNode} from '../interfaces/node';
import {RElement} from '../interfaces/renderer_dom';
import {isLContainer, isLView} from '../interfaces/type_checks';
import {CONTEXT, HEADER_OFFSET, HOST, LView, PARENT, TVIEW} from '../interfaces/view';
import {clearElementContents, destroyLView} from '../node_manipulation';
import {unwrapRNode} from '../util/view_utils';
import {ViewRef as R3ViewRef} from '../view_ref';

import {refreshView} from './change_detection';
import {renderView} from './render';
import {addComponentLogic} from './shared';

export function hmr(
    component: Type<unknown>, newComponentDef: ComponentDef<unknown>, viewRef: ViewRef) {
  visitLView((viewRef as R3ViewRef<any>)._lView, component, newComponentDef);
}

function visitLContainer(
    lContainer: LContainer, component: Type<unknown>, newComponentDef: ComponentDef<unknown>) {
  for (let i = CONTAINER_HEADER_OFFSET; i < lContainer.length; i++) {
    visitLView(lContainer[i] as LView, component, newComponentDef);
  }
}

function visitLView(
    lView: LView, component: Type<unknown>, newComponentDef: ComponentDef<unknown>) {
  const tView = lView[TVIEW];
  if (lView[CONTEXT] instanceof component) {
    // This LView corresponds to a component that we want to refresh,
    // perform the necessary updates and exit, since all child elements
    // will be recreated.
    applyHmrUpdate(lView, component, newComponentDef);
    return;
  }
  for (let i = HEADER_OFFSET; i < tView.bindingStartIndex; i++) {
    if (isLContainer(lView[i])) {
      const lContainer = lView[i];
      visitLContainer(lContainer, component, newComponentDef);
    } else if (isLView(lView[i])) {
      // This is a component, enter the `visitLView` recursively.
      visitLView(lView[i], component, newComponentDef);
    }
  }
}

function getTNodeByLViewInstance(parentLView: LView, lView: LView): TNode {
  const parentTView = parentLView[TVIEW];
  for (let i = HEADER_OFFSET; i < parentTView.bindingStartIndex; i++) {
    if (parentLView[i] === lView) {
      return parentTView.data[i] as TNode;
    }
  }
  throw new Error('Unexpected state: LView doesn\'t belong to a given parent LView.');
}

function applyHmrUpdate(
    lView: LView<unknown>, component: Type<unknown>, newComponentDef: ComponentDef<unknown>) {
  // Apply an updated component def to this component type.
  // Carry over some fields from an old component def to a new one.
  const oldComponentDef = getComponentDef(component);
  (newComponentDef as any).id = oldComponentDef?.id;
  (newComponentDef as any).type = oldComponentDef?.type;
  (component as any)[NG_COMP_DEF] = newComponentDef;

  const tView = lView[TVIEW];
  const context = lView[CONTEXT];  // instance of the component

  // TODO: this needs a better handling for LContainer cases.
  const parentLView = lView[PARENT] as LView;
  const tNode = getTNodeByLViewInstance(parentLView, lView);

  // Update LView data structures.
  // TODO: this would also trigger `ngOnDestroy` hooks,
  // which we probably want to avoid during HMR?
  destroyLView(tView, lView);

  // Remove DOM nodes from a host element.
  const rElement = unwrapRNode(lView[HOST]!);
  const childNodes = Array.from((rElement as HTMLElement).childNodes);
  for (let childNode of childNodes) {
    // Note: avoid using `clearElementContents` here, since it retains emulated
    // DOM in a weird state, which breaks things afterwards.
    childNode.remove();
  }

  // Create a new LView and TView for an updated version of a component.
  const componentLView = addComponentLogic(parentLView, tNode as TElementNode, newComponentDef);
  const componentTView = componentLView[TVIEW];

  // Update context to use an existing instance.
  componentLView[CONTEXT] = context;

  // Creation mode.
  // TODO: we may want to disable lifecycle hooks.
  renderView(componentTView, componentLView, context);

  // Update mode (change detection).
  // TODO: we may want to disable lifecycle hooks.
  refreshView(componentTView, componentLView, componentTView.template, context);
}
