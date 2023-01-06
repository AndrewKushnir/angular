/**
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */
import {assertDefined} from '../../util/assert';
import {assertFirstCreatePass, assertRComment} from '../assert';
import {attachPatchData} from '../context_discovery';
import {registerPostOrderHooks} from '../hooks';
import {locateNextRNode, markRNodeAsClaimedForHydration, siblingAfter} from '../hydration';
import {DEHYDRATED_VIEWS} from '../interfaces/container';
import {ComponentTemplate} from '../interfaces/definition';
import {LocalRefExtractor, TAttributes, TContainerNode, TNodeType} from '../interfaces/node';
import {RComment, RElement} from '../interfaces/renderer_dom';
import {isDirectiveHost} from '../interfaces/type_checks';
import {HEADER_OFFSET, HYDRATION_INFO, LView, RENDERER, TView, TViewType} from '../interfaces/view';
import {appendChild} from '../node_manipulation';
import {getCurrentTNode, getLView, getTView, isCurrentTNodeParent, setCurrentTNode} from '../state';
import {getConstant} from '../util/view_utils';

import {addToViewTree, createDirectivesInstances, createLContainer, createTView, getOrCreateTNode, resolveDirectives, saveResolvedLocalsInData} from './shared';

function templateFirstCreatePass(
    index: number, tView: TView, lView: LView, templateFn: ComponentTemplate<any>|null,
    decls: number, vars: number, tagName?: string|null, attrsIndex?: number|null,
    localRefsIndex?: number|null): TContainerNode {
  ngDevMode && assertFirstCreatePass(tView);
  ngDevMode && ngDevMode.firstCreatePass++;
  const tViewConsts = tView.consts;
  const adjustedIndex = index + HEADER_OFFSET;
  const ngh = lView[HYDRATION_INFO];
  let ssrId = (ngh && ngh.templates[index]) || null;
  // TODO(pk): refactor getOrCreateTNode to have the "create" only version
  const tNode = getOrCreateTNode(
      tView, adjustedIndex, TNodeType.Container, tagName || null,
      getConstant<TAttributes>(tViewConsts, attrsIndex), ssrId);

  resolveDirectives(tView, lView, tNode, getConstant<string[]>(tViewConsts, localRefsIndex));
  registerPostOrderHooks(tView, tNode);

  const embeddedTView = tNode.tViews = createTView(
      TViewType.Embedded, tNode, templateFn, decls, vars, tView.directiveRegistry,
      tView.pipeRegistry, null, tView.schemas, tViewConsts);

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
  const lView = getLView();
  const tView = getTView();
  const adjustedIndex = index + HEADER_OFFSET;

  const previousTNode = getCurrentTNode();
  const previousTNodeParent = isCurrentTNodeParent();

  const tNode = tView.firstCreatePass ?
      templateFirstCreatePass(
          index, tView, lView, templateFn, decls, vars, tagName, attrsIndex, localRefsIndex) :
      tView.data[adjustedIndex] as TContainerNode;

  let comment: RComment;
  const dehydratedViews: any[] = [];
  const ngh = lView[HYDRATION_INFO];
  if (ngh) {
    debugger;
    let currentRNode =
        locateNextRNode(ngh, tView, lView, tNode, previousTNode, previousTNodeParent);

    const sContainer = ngh.containers[index];
    ngDevMode &&
        assertDefined(sContainer, 'There is no hydration info available for this template');

    const sViews = sContainer.views as any;
    for (const sView of sViews) {
      const view = {...sView};
      if (view.numRootNodes > 0) {
        debugger;
        // Keep reference to the first node in this view,
        // so it can be accessed while invoking template instructions.
        view.firstChild = currentRNode;

        // Move over to the first node after this view, which can
        // either be a first node of the next view or an anchor comment
        // node after the last view in a container.
        currentRNode = siblingAfter(view.numRootNodes, currentRNode as RElement);
      }
      dehydratedViews.push(view);
    }
    // After processing of all views, the `currentRNode` points
    // to the first node *after* the last view, which must be a
    // comment node which acts as an anchor.
    comment = currentRNode as RComment;

    ngDevMode && assertRComment(comment, 'Expecting a comment node in template instruction');
    ngDevMode && markRNodeAsClaimedForHydration(comment);
  } else {
    comment = lView[RENDERER].createComment(ngDevMode ? 'container' : '');
  }
  setCurrentTNode(tNode, false);
  !ngh && appendChild(tView, lView, comment, tNode);
  attachPatchData(comment, lView);

  const lContainer = createLContainer(comment, lView, comment, tNode);
  lView[adjustedIndex] = lContainer;

  if (ngh) {
    lContainer[DEHYDRATED_VIEWS] = dehydratedViews;
  }
  addToViewTree(lView, lContainer);

  if (isDirectiveHost(tNode)) {
    createDirectivesInstances(tView, lView, tNode);
  }

  if (localRefsIndex != null) {
    saveResolvedLocalsInData(lView, tNode, localRefExtractor);
  }
}
