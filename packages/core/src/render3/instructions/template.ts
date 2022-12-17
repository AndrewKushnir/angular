/**
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */
import {assertFirstCreatePass} from '../assert';
import {attachPatchData} from '../context_discovery';
import {registerPostOrderHooks} from '../hooks';
import {DEHYDRATED_VIEWS} from '../interfaces/container';
import {ComponentTemplate} from '../interfaces/definition';
import {LocalRefExtractor, TAttributes, TContainerNode, TNodeType} from '../interfaces/node';
import {RComment} from '../interfaces/renderer_dom';
import {isDirectiveHost} from '../interfaces/type_checks';
import {DECLARATION_COMPONENT_VIEW, HEADER_OFFSET, HOST, HYDRATION_INFO, LView, NghView, RENDERER, TView, TViewType} from '../interfaces/view';
import {appendChild, findExistingNode} from '../node_manipulation';
import {getLView, getTView, setCurrentTNode} from '../state';
import {getConstant} from '../util/view_utils';

import {addToViewTree, createDirectivesInstances, createLContainer, createTView, getOrCreateTNode, resolveDirectives, saveResolvedLocalsInData} from './shared';



function templateFirstCreatePass(
    index: number, tView: TView, lView: LView, templateFn: ComponentTemplate<any>|null,
    decls: number, vars: number, tagName?: string|null, attrsIndex?: number|null,
    localRefsIndex?: number|null): TContainerNode {
  ngDevMode && assertFirstCreatePass(tView);
  ngDevMode && ngDevMode.firstCreatePass++;
  const tViewConsts = tView.consts;
  // TODO(pk): refactor getOrCreateTNode to have the "create" only version
  const tNode = getOrCreateTNode(
      tView, index, TNodeType.Container, tagName || null,
      getConstant<TAttributes>(tViewConsts, attrsIndex));


  const ngh = lView[HYDRATION_INFO];
  const adjustedIndex = index - HEADER_OFFSET;
  if (ngh && ngh.templates[adjustedIndex]) {
    tNode.ssrId = ngh.templates[adjustedIndex];
  }

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

  const tNode = tView.firstCreatePass ? templateFirstCreatePass(
                                            adjustedIndex, tView, lView, templateFn, decls, vars,
                                            tagName, attrsIndex, localRefsIndex) :
                                        tView.data[adjustedIndex] as TContainerNode;
  setCurrentTNode(tNode, false);

  let comment: RComment;

  const ngh = lView[HYDRATION_INFO];
  if (ngh) {
    comment = findExistingNode(
                  lView[DECLARATION_COMPONENT_VIEW][HOST] as unknown as Element,
                  ngh.nodes[index]) as RComment;
  } else {
    comment = lView[RENDERER].createComment(ngDevMode ? 'container' : '');
    appendChild(tView, lView, comment, tNode);
  }
  attachPatchData(comment, lView);

  const lContainer = createLContainer(comment, lView, comment, tNode);
  lView[adjustedIndex] = lContainer;

  if (ngh) {
    // Look for all views within this container.
    const nghContainer = ngh.containers.find(c => c.anchor === index);
    if (nghContainer) {
      // Copy the views object, since we'll be removing elements
      // from it later.
      // TODO: consider doing DOM lookup here and store DOM nodes instead.
      lContainer[DEHYDRATED_VIEWS] = [...nghContainer.views];
    }
  }
  addToViewTree(lView, lContainer);

  if (isDirectiveHost(tNode)) {
    createDirectivesInstances(tView, lView, tNode);
  }

  if (localRefsIndex != null) {
    saveResolvedLocalsInData(lView, tNode, localRefExtractor);
  }
}
