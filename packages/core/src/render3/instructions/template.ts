/**
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */
import {validateMatchingNode} from '../../hydration/error_handling';
import {CONTAINERS, NghViewInstance, TEMPLATES} from '../../hydration/interfaces';
import {locateNextRNode} from '../../hydration/node_lookup_utils';
import {isNodeDisconnected, markRNodeAsClaimedForHydration} from '../../hydration/utils';
import {locateDehydratedViewsInContainer} from '../../hydration/views';
import {assertDefined} from '../../util/assert';
import {assertFirstCreatePass} from '../assert';
import {attachPatchData} from '../context_discovery';
import {registerPostOrderHooks} from '../hooks';
import {DEHYDRATED_VIEWS, LContainer} from '../interfaces/container';
import {ComponentTemplate} from '../interfaces/definition';
import {LocalRefExtractor, TAttributes, TContainerNode, TNode, TNodeType} from '../interfaces/node';
import {RComment} from '../interfaces/renderer_dom';
import {isDirectiveHost} from '../interfaces/type_checks';
import {HEADER_OFFSET, HYDRATION, LView, RENDERER, TView, TViewType} from '../interfaces/view';
import {appendChild} from '../node_manipulation';
import {getLView, getTView, isInSkipHydrationBlock, setCurrentTNode} from '../state';
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
  const ngh = lView[HYDRATION];
  let ssrId = (ngh && ngh.data[TEMPLATES]?.[index]) || null;
  // TODO(pk): refactor getOrCreateTNode to have the "create" only version
  const tNode = getOrCreateTNode(
      tView, adjustedIndex, TNodeType.Container, tagName || null,
      getConstant<TAttributes>(tViewConsts, attrsIndex), ssrId);

  resolveDirectives(tView, lView, tNode, getConstant<string[]>(tViewConsts, localRefsIndex));
  registerPostOrderHooks(tView, tNode);

  // TODO: we can probably just move `ssrId` from TNode -> TView?
  const embeddedTView = tNode.tViews = createTView(
      TViewType.Embedded, tNode, templateFn, decls, vars, tView.directiveRegistry,
      tView.pipeRegistry, null, tView.schemas, tViewConsts, null);

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

  const tNode = tView.firstCreatePass ?
      templateFirstCreatePass(
          index, tView, lView, templateFn, decls, vars, tagName, attrsIndex, localRefsIndex) :
      tView.data[adjustedIndex] as TContainerNode;

  const [isNewlyCreatedNode, comment, lContainer] =
      _locateOrCreateLContainerNode(tView, lView, tNode, adjustedIndex);

  setCurrentTNode(tNode, false);
  isNewlyCreatedNode && appendChild(tView, lView, comment, tNode);
  attachPatchData(comment, lView);

  lView[adjustedIndex] = lContainer;

  addToViewTree(lView, lContainer);

  if (isDirectiveHost(tNode)) {
    createDirectivesInstances(tView, lView, tNode);
  }

  if (localRefsIndex != null) {
    saveResolvedLocalsInData(lView, tNode, localRefExtractor);
  }
}

let _locateOrCreateLContainerNode: typeof locateOrCreateLContainerNodeImpl =
    (tView: TView, lView: LView, tNode: TNode, adjustedIndex: number) => {
      const comment = lView[RENDERER].createComment(ngDevMode ? 'container' : '');
      const lContainer = createLContainer(comment, lView, comment, tNode);
      return [true, comment, lContainer];
    }

function locateOrCreateLContainerNodeImpl(
    tView: TView, lView: LView, tNode: TNode, adjustedIndex: number):
    [boolean, RComment, LContainer] {
      let comment: RComment;
      let dehydratedViews: NghViewInstance[] = [];
      const ngh = lView[HYDRATION];
      const index = adjustedIndex - HEADER_OFFSET;
      const isCreating = !ngh || isInSkipHydrationBlock() || isNodeDisconnected(ngh, index);
      if (isCreating) {
        comment = lView[RENDERER].createComment(ngDevMode ? 'container' : '');
      } else {
        let currentRNode = locateNextRNode(ngh, tView, lView, tNode);

        const nghContainer = ngh.data[CONTAINERS]?.[index]!;
        ngDevMode &&
            assertDefined(nghContainer, 'There is no hydration info available for this template');

        const [anchorRNode, views] = locateDehydratedViewsInContainer(currentRNode!, nghContainer);

        comment = anchorRNode as RComment;
        dehydratedViews = views;

        ngDevMode &&
            validateMatchingNode(comment as unknown as Node, Node.COMMENT_NODE, null, lView, tNode);
        ngDevMode && markRNodeAsClaimedForHydration(comment);
      }
      const lContainer = createLContainer(comment, lView, comment, tNode);
      if (ngh && dehydratedViews.length > 0) {
        lContainer[DEHYDRATED_VIEWS] = dehydratedViews;
      }
      return [isCreating, comment, lContainer];
    }

export function enableLocateOrCreateLContainerNodeImpl() {
  _locateOrCreateLContainerNode = locateOrCreateLContainerNodeImpl;
}
