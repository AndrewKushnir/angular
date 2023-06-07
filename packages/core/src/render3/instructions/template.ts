/**
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */
import {validateMatchingNode, validateNodeExists} from '../../hydration/error_handling';
import {TEMPLATES} from '../../hydration/interfaces';
import {locateNextRNode, siblingAfter} from '../../hydration/node_lookup_utils';
import {calcSerializedContainerSize, isDisconnectedNode, markRNodeAsClaimedByHydration, setSegmentHead} from '../../hydration/utils';
import {Type} from '../../interface/type';
import {TemplateRef} from '../../linker';
import {createLazyTemplateRef, createTemplateRef, injectLazyTemplateRef} from '../../linker/template_ref';
import {injectViewContainerRef} from '../../linker/view_container_ref';
import {assertEqual} from '../../util/assert';
import {assertFirstCreatePass} from '../assert';
import {bindingUpdated} from '../bindings';
import {attachPatchData} from '../context_discovery';
import {registerPostOrderHooks} from '../hooks';
import {DEFER_DETAILS, DeferState, LDeferDetails} from '../interfaces/container';
import {ComponentTemplate, DependencyTypeList} from '../interfaces/definition';
import {LocalRefExtractor, TAttributes, TContainerNode, TDeferDetails, TNode, TNodeType} from '../interfaces/node';
import {RComment} from '../interfaces/renderer_dom';
import {isDestroyed, isDirectiveHost} from '../interfaces/type_checks';
import {HEADER_OFFSET, HYDRATION, LView, RENDERER, TVIEW, TView, TViewType} from '../interfaces/view';
import {appendChild} from '../node_manipulation';
import {getLView, getSelectedTNode, getTView, isInSkipHydrationBlock, lastNodeWasCreated, nextBindingIndex, setCurrentTNode, wasLastNodeCreated} from '../state';
import {NO_CHANGE} from '../tokens';
import {getConstant, getTNode} from '../util/view_utils';

import {addToViewTree, createDirectivesInstances, createLContainer, createTView, getOrCreateTNode, resolveDirectives, saveResolvedLocalsInData} from './shared';

export type DeferredDepsFn = () => Array<Promise<Type<unknown>>|Type<unknown>>;

// TODO: move all `defer` logic to a new file (defer.ts)

export function templateFirstCreatePass(
    index: number, tView: TView, lView: LView, templateFn: ComponentTemplate<any>|null,
    deferredDepsFn: DeferredDepsFn|null, decls: number, vars: number,
    value?: string|TDeferDetails|null, attrsIndex?: number|null,
    localRefsIndex?: number|null): TContainerNode {
  ngDevMode && assertFirstCreatePass(tView);
  ngDevMode && ngDevMode.firstCreatePass++;
  const tViewConsts = tView.consts;

  // TODO(pk): refactor getOrCreateTNode to have the "create" only version
  const tNode = getOrCreateTNode(
      tView, index, TNodeType.Container, value || null,
      getConstant<TAttributes>(tViewConsts, attrsIndex));

  resolveDirectives(tView, lView, tNode, getConstant<string[]>(tViewConsts, localRefsIndex));
  registerPostOrderHooks(tView, tNode);

  const embeddedTView = tNode.tView = createTView(
      TViewType.Embedded, tNode, templateFn, decls, vars, tView.directiveRegistry,
      tView.pipeRegistry, null, tView.schemas, tViewConsts, null /* ssrId */);

  embeddedTView.dependencies = deferredDepsFn;

  if (tView.queries !== null) {
    tView.queries.template(tView, tNode);
    embeddedTView.queries = tView.queries.embeddedTView(tNode);
  }

  return tNode;
}

/**
 * Creates an LContainer for an ng-template (dynamically-inserted view), e.g.
 *
 * <ng-template #foo>
 *    <div></div>
 * </ng-template>
 *
 * @param index The index of the container in the data array
 * @param templateFn Inline template
 * @param decls The number of nodes, local refs, and pipes for this template
 * @param vars The number of bindings for this template
 * @param tagName The name of the container element, if applicable
 * @param attrsIndex Index of template attributes in the `consts` array.
 * @param localRefs Index of the local references in the `consts` array.
 * @param localRefExtractor A function which extracts local-refs values from the template.
 *        Defaults to the current element associated with the local-ref.
 *
 * @codeGenApi
 */
export function ɵɵtemplate(
    index: number, templateFn: ComponentTemplate<any>|null, decls: number, vars: number,
    tagName?: string|null, attrsIndex?: number|null, localRefsIndex?: number|null,
    localRefExtractor?: LocalRefExtractor) {
  return templateInternal(
      index, templateFn, null, decls, vars, tagName, attrsIndex, localRefsIndex, localRefExtractor);
}


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
export function ɵɵdeferredTemplate(
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
  debugger;
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
  // TODO: implement this function
}

// TODO: add docs
export function ɵɵdeferOnImmediate() {
  // TODO: implement this function
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
  // TODO: implement this function
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
          debugger;
          if (!isDestroyed(lView)) {
            // Everything is loaded, show the primary block content
            renderDeferState(lView, lDetails, DeferState.COMPLETE, templateRef);
          }
        })
        .catch((error: unknown) => {
          debugger;

          // There was an error, render an error template
          const wasContentRendered =
              renderDeferState(lView, lDetails, DeferState.ERROR, tDetails.errorTmplIndex);

          if (!wasContentRendered) {
            // TODO: if there was no "error" template, we should log an error into the console.
          }
        });
  }
}

export function templateInternal(
    index: number, templateFn: ComponentTemplate<any>|null, deferredDepsFn: DeferredDepsFn|null,
    decls: number, vars: number, value?: string|TDeferDetails|null, attrsIndex?: number|null,
    localRefsIndex?: number|null, localRefExtractor?: LocalRefExtractor) {
  const lView = getLView();
  const tView = getTView();
  const adjustedIndex = index + HEADER_OFFSET;

  const tNode = tView.firstCreatePass ? templateFirstCreatePass(
                                            adjustedIndex, tView, lView, templateFn, deferredDepsFn,
                                            decls, vars, value, attrsIndex, localRefsIndex) :
                                        tView.data[adjustedIndex] as TContainerNode;
  setCurrentTNode(tNode, false);

  const comment = _locateOrCreateContainerAnchor(tView, lView, tNode, index) as RComment;

  if (wasLastNodeCreated()) {
    appendChild(tView, lView, comment, tNode);
  }
  attachPatchData(comment, lView);

  addToViewTree(lView, lView[adjustedIndex] = createLContainer(comment, lView, comment, tNode));

  if (isDirectiveHost(tNode)) {
    createDirectivesInstances(tView, lView, tNode);
  }

  if (localRefsIndex != null) {
    saveResolvedLocalsInData(lView, tNode, localRefExtractor);
  }
}

let _locateOrCreateContainerAnchor = createContainerAnchorImpl;

/**
 * Regular creation mode for LContainers and their anchor (comment) nodes.
 */
function createContainerAnchorImpl(
    tView: TView, lView: LView, tNode: TNode, index: number): RComment {
  lastNodeWasCreated(true);
  return lView[RENDERER].createComment(ngDevMode ? 'container' : '');
}

/**
 * Enables hydration code path (to lookup existing elements in DOM)
 * in addition to the regular creation mode for LContainers and their
 * anchor (comment) nodes.
 */
function locateOrCreateContainerAnchorImpl(
    tView: TView, lView: LView, tNode: TNode, index: number): RComment {
  const hydrationInfo = lView[HYDRATION];
  const isNodeCreationMode =
      !hydrationInfo || isInSkipHydrationBlock() || isDisconnectedNode(hydrationInfo, index);
  lastNodeWasCreated(isNodeCreationMode);

  // Regular creation mode.
  if (isNodeCreationMode) {
    return createContainerAnchorImpl(tView, lView, tNode, index);
  }

  const ssrId = hydrationInfo.data[TEMPLATES]?.[index] ?? null;

  // Apply `ssrId` value to the underlying TView if it was not previously set.
  //
  // There might be situations when the same component is present in a template
  // multiple times and some instances are opted-out of using hydration via
  // `ngSkipHydration` attribute. In this scenario, at the time a TView is created,
  // the `ssrId` might be `null` (if the first component is opted-out of hydration).
  // The code below makes sure that the `ssrId` is applied to the TView if it's still
  // `null` and verifies we never try to override it with a different value.
  if (ssrId !== null && tNode.tView !== null) {
    if (tNode.tView.ssrId === null) {
      tNode.tView.ssrId = ssrId;
    } else {
      ngDevMode &&
          assertEqual(tNode.tView.ssrId, ssrId, 'Unexpected value of the `ssrId` for this TView');
    }
  }

  // Hydration mode, looking up existing elements in DOM.
  const currentRNode = locateNextRNode(hydrationInfo, tView, lView, tNode)!;
  ngDevMode && validateNodeExists(currentRNode, lView, tNode);

  setSegmentHead(hydrationInfo, index, currentRNode);
  const viewContainerSize = calcSerializedContainerSize(hydrationInfo, index);
  const comment = siblingAfter<RComment>(viewContainerSize, currentRNode)!;

  if (ngDevMode) {
    validateMatchingNode(comment, Node.COMMENT_NODE, null, lView, tNode);
    markRNodeAsClaimedByHydration(comment);
  }

  return comment;
}

export function enableLocateOrCreateContainerAnchorImpl() {
  _locateOrCreateContainerAnchor = locateOrCreateContainerAnchorImpl;
}
