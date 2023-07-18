/**
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */
import {TemplateRef} from '../../linker';
import {createLazyTemplateRef, createTemplateRef} from '../../linker/template_ref';
import {injectViewContainerRef} from '../../linker/view_container_ref';
import {bindingUpdated} from '../bindings';
import {DEFER_DETAILS, DeferState, LDeferDetails} from '../interfaces/container';
import {ComponentTemplate} from '../interfaces/definition';
import {TDeferDetails, TNode} from '../interfaces/node';
import {isDestroyed} from '../interfaces/type_checks';
import {HEADER_OFFSET, LView, TVIEW} from '../interfaces/view';
import {getCurrentTNode, getLView, getSelectedTNode, nextBindingIndex} from '../state';
import {NO_CHANGE} from '../tokens';
import {getTNode, storeLViewOnDestroy} from '../util/view_utils';

import {DeferredDepsFn, templateInternal} from './template';

// ***** IMPLEMENTATION DETAILS *****
//
// TNode to store extra info:
// - loading tmpl index
// - error tmpl index
// - placeholder tmpl index
// - config for each block (e.g. {:loading after 100ms})
// - conditions for {#defer}
// - the "loading" Promise reference?
//   - it's ok for it to be on TNode, since it's the same for all instances
//
// LView[idx] to store:
// - corresponding LContainer (created by the `template` instruction)
// - update LContainer's header to include currently activated case info
//
// Questions:
// - how dow we want to store things like IntersectionObserver?
//   should it be a instance per application (e.g. `providedIn: root`) or per-LView?
// - do we need a new TNode type or we can get away with TNodeType.Container?
//   - the benefit of using TNodeType.Container is that it should "just work"
//     with content projections, hydration, etc
// - how would hydration pick up currently activated case?
// - how do we make conditions tree-shakable?
//   - for ex. for {:loading after 100ms} - it'd be great to have extra "loading"
//     code be tree-shaken away if unused. Generate extra fn in compiler?
// - do we need smth like `deferApply` that would activate the necessary logic?
//   - for ex. if we need to use IntersectionObserver, we want to activate it during
//     the "update" phase?
// - how do we deal with prefetch? do we need a special flag for prefetch status?
//
// Important notes:
// - we should make sure to store cleanup fns to cleanup on destroy
// - we should check if LView is destroyed when we get a resolved "loading" promise

// TODO: add docs here
export function ɵɵdefer(
    index: number, templateFn: ComponentTemplate<any>|null, deferredDepsFn: DeferredDepsFn,
    decls: number, vars: number, loadingTmplIndex: number|null = null,
    placeholderTmplIndex: number|null = null, errorTmplIndex: number|null = null,
    loadingConfigIndex: number|null = null, placeholderConfigIndex: number|null = null) {
  // TODO: move `deferredDepsFn` to `TDeferDetails`?
  deferredDepsFn = deferredDepsFn ?? (() => []);

  const deferConfig: TDeferDetails = {
    loadingTmplIndex,
    loadingConfigIndex,
    placeholderTmplIndex,
    placeholderConfigIndex,
    errorTmplIndex,
    loadingPromise: null,
    loaded: false,
  };

  return templateInternal(index, templateFn, deferredDepsFn, decls, vars, deferConfig);
}

// TODO: add docs
export function ɵɵdeferWhen<T>(rawValue: T) {
  const lView = getLView();
  const bindingIndex = nextBindingIndex();
  const value = !!rawValue;  // handle truthy or falsy values
  const oldValue = lView[bindingIndex];
  // If an old value was `true` - don't enter the path that triggers
  // lazy loading.
  if (oldValue !== true && bindingUpdated(lView, bindingIndex, value)) {
    const tNode = getSelectedTNode();
    renderDeferBlock(lView, tNode, oldValue, value);
    // TODO: store relevant bits of info here to support better error messages
    // (mostly "expression changed ..." one)
    // ngDevMode && storePropertyBindingMetadata(tView.data, tNode, propName, bindingIndex);
  }
}

// TODO: add docs
export function ɵɵdeferOnIdle() {
  const lView = getLView();
  const tNode = getCurrentTNode()!;

  // TODO: would this produce a flicker?
  // TODO: should this be an extended diagnostic (i.e. when you
  // provide `{:placeholder}` and `on idle` condition)?
  renderPlaceholder(lView, tNode);

  // TODO: implement a better shim
  const _requestIdleCallback =
      typeof requestIdleCallback !== 'undefined' ? requestIdleCallback : setTimeout;
  const _cancelIdleCallback =
      typeof cancelIdleCallback !== 'undefined' ? cancelIdleCallback : clearTimeout;

  const id = _requestIdleCallback(() => {
    renderDeferBlock(lView, tNode, NO_CHANGE, true);
    cancelIdleCallback(id as number);
  });
  storeLViewOnDestroy(lView, () => _cancelIdleCallback(id as number));
}

// TODO: add docs
export function ɵɵdeferOnImmediate() {
  const lView = getLView();
  const tNode = getCurrentTNode()!;
  // TODO: should we render right away without microtask?
  //       It doesn't look great that we may kick off lazy loading
  //       both synchronously and asynchronously (we should always
  //       do it async?)
  queueMicrotask(() => {
    renderDeferBlock(lView, tNode, NO_CHANGE, true);
  });
}

// TODO: add docs
export function ɵɵdeferOnHover(target?: string) {
  // TODO: implement this function
}

// TODO: add docs
export function ɵɵdeferOnInteraction(target?: string) {
  // TODO: implement this function
}

// TODO: add docs
export function ɵɵdeferOnViewport(target?: string) {
  // TODO: implement this function
}

// TODO: add docs
export function ɵɵdeferOnTimer(timeout: number) {
  const lView = getLView();
  const tNode = getCurrentTNode()!;

  renderPlaceholder(lView, tNode);

  const id = setTimeout(() => {
    renderDeferBlock(lView, tNode, NO_CHANGE, true);
    clearTimeout(id);
  }, timeout);
  storeLViewOnDestroy(lView, () => clearTimeout(id));
}

function renderPlaceholder(lView: LView, tNode: TNode) {
  renderDeferBlock(lView, tNode, NO_CHANGE, false);
}

function renderDeferState(
    lView: LView, lDetails: LDeferDetails, newState: DeferState,
    stateTmpl: number|TemplateRef<unknown>): boolean {
  const vcRef = lDetails.viewContainerRef;
  // Note: we transition to the next state if the previous state was
  // less than the next state. For example, if the current state is "loading",
  // we should not show a placeholder.
  if (lDetails.state < newState) {
    lDetails.state = newState;
    const templateRef = typeof stateTmpl == 'number' ?  //
        getTemplateRef(lView, stateTmpl) :
        stateTmpl;
    if (templateRef) {
      vcRef.clear();
      vcRef.createEmbeddedView(templateRef);
      return true;
    }
  }
  return false;
}

function getTemplateRef(lView: LView, index: number): TemplateRef<unknown>|null {
  if (index === null) {
    return null;
  }
  const tView = lView[TVIEW];
  const adjustedIndex = index + HEADER_OFFSET;
  const tNode = getTNode(tView, adjustedIndex);
  return createTemplateRef(tNode, lView)!;
}

// TODO: consider doing all operations without going through the ViewContainerRef.
//       We can use internal data structures directly.
// TODO: intersect the state based on `when` with the state based on `on`!
//       we might be in the "loading" or "complete" state already
// TODO: handle this case: {#for}{#defer}...{/defer}{/for}, when
//       lazy loading got kicked off, but ɵɵdeferWhen was invoked multiple
//       times. Make sure that we only act once per view in this case.
function renderDeferBlock(
    lView: LView, tNode: TNode, oldValue: boolean|NO_CHANGE, newValue: boolean) {
  const lContainer = lView[tNode.index];
  // TODO: add an assert that we have an LContainer instance here

  if (!lContainer[DEFER_DETAILS]) {
    lContainer[DEFER_DETAILS] = {
      state: DeferState.INITIAL,
      viewContainerRef: injectViewContainerRef()
    };
  }

  const lDetails = lContainer[DEFER_DETAILS];
  const tDetails = tNode.value;

  if (oldValue === NO_CHANGE && newValue === false) {
    // We set the value for the first time, render a placeholder.
    renderDeferState(lView, lDetails, DeferState.PLACEHOLDER, tDetails.placeholderTmplIndex);

  } else if (newValue === true) {
    // Condition is triggered, render loading and start downloading.
    renderDeferState(lView, lDetails, DeferState.LOADING, tDetails.loadingTmplIndex);

    const lazyTemplateRef = createLazyTemplateRef(tNode, lView)!;
    lazyTemplateRef.load()
        .then(templateRef => {
          if (!isDestroyed(lView)) {
            // Everything is loaded, show the primary block content
            renderDeferState(lView, lDetails, DeferState.COMPLETE, templateRef);
          }
        })
        .catch((error: unknown) => {
          // There was an error, render an error template
          const wasContentRendered =
              renderDeferState(lView, lDetails, DeferState.ERROR, tDetails.errorTmplIndex);

          console.error(error);
          if (!wasContentRendered) {
            // TODO: if there was no "error" template, we should log an error into the console.
          }
        });
  }
}
