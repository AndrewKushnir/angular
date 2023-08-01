/**
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */

import {assertDefined} from '../../util/assert';
import {assertLContainer} from '../assert';
import {bindingUpdated} from '../bindings';
import {getComponentDef, getDirectiveDef, getPipeDef} from '../definition';
import {DEFER_BLOCK_DETAILS, DeferInstanceState, LContainer} from '../interfaces/container';
import {ComponentTemplate, DependencyResolverFn, DirectiveDefList, PipeDefList} from '../interfaces/definition';
import {DeferDepsLoadingState, TContainerNode, TDeferBlockDetails, TNode} from '../interfaces/node';
import {isDestroyed} from '../interfaces/type_checks';
import {HEADER_OFFSET, LView, PARENT, TVIEW} from '../interfaces/view';
import {getCurrentTNode, getLView, getSelectedTNode, nextBindingIndex} from '../state';
import {NO_CHANGE} from '../tokens';
import {getTNode, storeLViewOnDestroy} from '../util/view_utils';
import {addLViewToLContainer, createAndRenderEmbeddedLView, removeLViewFromLContainer} from '../view_manipulation';

import {templateInternal} from './template';

// ***** IMPLEMENTATION DETAILS *****
//
// Questions:
// - how dow we want to store things like IntersectionObserver?
//   should it be a instance per application (e.g. `providedIn: root`) or per-LView?
// - do we need smth like `deferApply` that would activate the necessary logic?
//   - for ex. if we need to use IntersectionObserver, we want to activate it during
//     the "update" phase?
//
// Important notes:
// - we should make sure to store cleanup fns to cleanup on destroy

// TODO: add docs here
export function ɵɵdefer(
    index: number, templateFn: ComponentTemplate<any>|null,
    dependencyResolverFn: DependencyResolverFn|null, decls: number, vars: number,
    loadingTmplIndex: number|null = null, placeholderTmplIndex: number|null = null,
    errorTmplIndex: number|null = null, loadingConfigIndex: number|null = null,
    placeholderConfigIndex: number|null = null) {
  const deferConfig: TDeferBlockDetails = {
    loadingTmplIndex,
    loadingConfigIndex,
    placeholderTmplIndex,
    placeholderConfigIndex,
    errorTmplIndex,
    dependencyResolverFn,
    loadingPromise: null,
    loadingState: DeferDepsLoadingState.NOT_STARTED,
    loadingFailedReason: null,
  };

  templateInternal(index, templateFn, decls, vars, deferConfig);

  const lView = getLView();
  const adjustedIndex = index + HEADER_OFFSET;
  const lContainer = lView[adjustedIndex];

  // Init instance-specific defer details for this LContainer.
  lContainer[DEFER_BLOCK_DETAILS] = {state: DeferInstanceState.INITIAL};
}

// TODO: add docs
export function ɵɵdeferWhen<T>(rawValue: T) {
  const lView = getLView();
  const bindingIndex = nextBindingIndex();
  const value = !!rawValue;  // handle truthy or falsy values
  const oldValue = lView[bindingIndex];
  // If an old value was `true` - don't enter the path that triggers
  // defer loading.
  if (oldValue !== true && bindingUpdated(lView, bindingIndex, value)) {
    const tNode = getSelectedTNode();
    renderDeferBlock(lView, tNode, oldValue, value);
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

/**
 * Transitions a defer block to the new state. Updates the  necessary
 * data structures and renders corresponding block.
 *
 * @param newState New state that should be applied to the defer block.
 * @param lContainer Represents an instance of a defer block.
 * @param tNode Represents defer block info shared across all instances.
 */
function renderDeferState(
    newState: DeferInstanceState, lContainer: LContainer, stateTemplate: TNode|number|null): void {
  const hostLView = lContainer[PARENT];

  // Check if this view is not destroyed. Since the loading process was async,
  // the view might end up being destroyed by the time rendering happens.
  if (isDestroyed(hostLView)) return;

  ngDevMode &&
      assertDefined(
          lContainer[DEFER_BLOCK_DETAILS],
          'Expected an LContainer that represents ' +
              'a defer block, but got a regular LContainer');
  const lDetails = lContainer[DEFER_BLOCK_DETAILS]!;

  // Note: we transition to the next state if the previous state was
  // less than the next state. For example, if the current state is "loading",
  // we should not show a placeholder.
  if ((lDetails.state < newState) && stateTemplate !== null) {
    lDetails.state = newState;
    const hostTView = hostLView[TVIEW];
    let tNode = stateTemplate;
    if (typeof stateTemplate === 'number') {
      const adjustedIndex = stateTemplate + HEADER_OFFSET;
      tNode = getTNode(hostTView, adjustedIndex);
    }
    if (tNode) {
      removeLViewFromLContainer(lContainer, 0);
      const embeddedLView = createAndRenderEmbeddedLView(hostLView, tNode as TContainerNode, {});
      addLViewToLContainer(lContainer, embeddedLView, 0);
    }
  }
}

/**
 * Trigger loading of defer block dependencies if the process hasn't started yet.
 *
 * @param tNode Represents Defer block info shared between instances.
 */
function triggerResourceLoading(tNode: TNode) {
  const tView = tNode.tView!;
  const tDetails = tNode.value as TDeferBlockDetails;

  if (tDetails.loadingState !== DeferDepsLoadingState.NOT_STARTED) {
    // If the loading status is different from initial one, it means that
    // the loading of dependencies is in progress and there is nothing to do
    // in this function. All details can be obtained from the `tDetails` object.
    return;
  }

  // Switch from NOT_STARTED -> IN_PROGRESS state.
  tDetails.loadingState = DeferDepsLoadingState.IN_PROGRESS;

  // The `dependenciesFn` might be `null` when all dependencies within
  // a given `{#defer}` block were eagerly references elsewhere in a file,
  // thus no dynamic `import()`s were produced.
  const dependenciesFn = tDetails.dependencyResolverFn;
  if (!dependenciesFn) {
    tDetails.loadingPromise = Promise.resolve().then(() => {
      tDetails.loadingState = DeferDepsLoadingState.COMPLETE;
    });
    return;
  }

  // Start downloading...
  tDetails.loadingPromise = Promise.allSettled(dependenciesFn()).then(results => {
    let failedReason = null;
    const directiveDefs: DirectiveDefList = [];
    const pipeDefs: PipeDefList = [];

    for (const result of results) {
      if (result.status === 'fulfilled') {
        const dependency = result.value;
        const directiveDef = getComponentDef(dependency) || getDirectiveDef(dependency);
        if (directiveDef) {
          directiveDefs.push(directiveDef);
        } else {
          const pipeDef = getPipeDef(dependency);
          if (pipeDef) {
            pipeDefs.push(pipeDef);
          }
        }
      } else {
        failedReason = result.reason;
        break;
      }
    }

    // Loading is completed, we no longer need this Promise.
    tDetails.loadingPromise = null;

    if (failedReason) {
      tDetails.loadingState = DeferDepsLoadingState.FAILED;
      tDetails.loadingFailedReason = failedReason;
    } else {
      tDetails.loadingState = DeferDepsLoadingState.COMPLETE;

      // Update directive and pipe registries to add newly downloaded dependencies.
      if (directiveDefs.length > 0) {
        tView.directiveRegistry = tView.directiveRegistry ?
            [...tView.directiveRegistry, ...directiveDefs] :
            directiveDefs;
      }
      if (pipeDefs.length > 0) {
        tView.pipeRegistry = tView.pipeRegistry ? [...tView.pipeRegistry, ...pipeDefs] : pipeDefs;
      }
    }
  });
}

/**
 * Subscribes to the "loading" Promise and renders corresponding defer sub-block,
 * based on the loading results.
 *
 * @param lContainer Represents an instance of a defer block.
 * @param tNode Represents defer block info shared across all instances.
 */
function renderDeferStateAfterResourceLoading(lContainer: LContainer, tNode: TNode) {
  const tDetails = tNode.value as TDeferBlockDetails;

  ngDevMode &&
      assertDefined(
          tDetails.loadingPromise, 'Expected loading Promise to exist on this defer block');

  tDetails.loadingPromise!.then(() => {
    if (tDetails.loadingState === DeferDepsLoadingState.COMPLETE) {
      // Everything is loaded, show the primary block content
      renderDeferState(DeferInstanceState.COMPLETE, lContainer, tNode);

    } else if (tDetails.loadingState === DeferDepsLoadingState.FAILED) {
      const hostLView = lContainer[PARENT];
      renderDeferState(DeferInstanceState.ERROR, lContainer, tDetails.errorTmplIndex);
      if (!isDestroyed(hostLView)) {
        console.error(tDetails.loadingFailedReason);
      }
    }
  });
}

// TODO: handle this case: {#for}{#defer}...{/defer}{/for}, when
//       lazy loading got kicked off, but ɵɵdeferWhen was invoked multiple
//       times. Make sure that we only act once per view in this case.
function renderDeferBlock(
    lView: LView, tNode: TNode, oldValue: boolean|NO_CHANGE, newValue: boolean) {
  const lContainer = lView[tNode.index];
  ngDevMode && assertLContainer(lContainer);

  const tDetails = tNode.value as TDeferBlockDetails;

  if (oldValue === NO_CHANGE && newValue === false) {
    // We set the value for the first time, render a placeholder.
    renderDeferState(DeferInstanceState.PLACEHOLDER, lContainer, tDetails.placeholderTmplIndex);

  } else if (newValue === true) {
    // Condition is triggered, render loading state and start downloading.
    renderDeferState(DeferInstanceState.LOADING, lContainer, tDetails.loadingTmplIndex);

    switch (tDetails.loadingState) {
      case DeferDepsLoadingState.NOT_STARTED:
        triggerResourceLoading(tNode);
        // The `loadingState` might have changed to "loading".
        if ((tDetails.loadingState as DeferDepsLoadingState) ===
            DeferDepsLoadingState.IN_PROGRESS) {
          renderDeferStateAfterResourceLoading(lContainer, tNode);
        }
        break;
      case DeferDepsLoadingState.IN_PROGRESS:
        renderDeferStateAfterResourceLoading(lContainer, tNode);
        break;
      case DeferDepsLoadingState.COMPLETE:
        renderDeferState(DeferInstanceState.COMPLETE, lContainer, tNode);
        break;
      case DeferDepsLoadingState.FAILED:
        renderDeferState(DeferInstanceState.ERROR, lContainer, tDetails.errorTmplIndex);
        break;
      default:
        if (ngDevMode) {
          throw new Error('Unknown defer block state');
        }
    }
  }
}
