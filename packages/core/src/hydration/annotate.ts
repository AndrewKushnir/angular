/**
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */

import {ApplicationRef, retrieveViewsFromApplicationRef} from '../application_ref';
import {collectNativeNodes} from '../render3/collect_native_nodes';
import {CONTAINER_HEADER_OFFSET, LContainer} from '../render3/interfaces/container';
import {TContainerNode, TNode, TNodeFlags, TNodeType} from '../render3/interfaces/node';
import {RNode} from '../render3/interfaces/renderer_dom';
import {isComponentHost, isLContainer, isProjectionTNode, isRootView} from '../render3/interfaces/type_checks';
import {CONTEXT, HEADER_OFFSET, HOST, LView, TView, TVIEW, TViewType} from '../render3/interfaces/view';
import {unwrapRNode} from '../render3/util/view_utils';

import {compressNghInfo} from './compression';
import {NghContainer, NghDom} from './interfaces';
import {calcPathBetween} from './node_navigation';
import {isInNonHydratableBlock, NON_HYDRATABLE_ATTR_NAME} from './non_hydratable';
import {getComponentLView, NGH_ATTR_NAME} from './utils';


/**
 * Annotates all components bootstrapped in a given ApplicationRef
 * with info needed for hydration.
 *
 * @param appRef A current instance of an ApplicationRef.
 */
export function annotateForHydration(appRef: ApplicationRef) {
  const viewRefs = retrieveViewsFromApplicationRef(appRef);
  for (const viewRef of viewRefs) {
    const lView = getComponentLView(viewRef);
    // TODO: make sure that this lView represents
    // a component instance.
    const hostElement = lView[HOST];
    if (hostElement) {
      annotateHostElementForHydration(hostElement, lView);
    }
  }
}

function firstRNodeInElementContainer(tView: TView, lView: LView, tNode: TNode): RNode|null {
  const rootNodes: any[] = [];
  // TODO: find more efficient way to do this. We don't need to traverse the entire
  // structure, we can just stop after examining the first node.
  collectNativeNodes(tView, lView, tNode, rootNodes);
  return rootNodes[0];
}

export function isTI18nNode(obj: any): boolean {
  // TODO: consider adding a node type to TI18n?
  return obj.hasOwnProperty('create') && obj.hasOwnProperty('update');
}

export function findClosestElementTNode(tNode: TNode|null): TNode|null {
  let parentTNode: TNode|null = tNode;
  // FIXME: this condition should also take into account whether
  // resulting tNode is not marked as `insertBeforeIndex`.
  while (parentTNode !== null &&
         ((parentTNode.type & TNodeType.Element) !== TNodeType.Element ||
          parentTNode.insertBeforeIndex !== null)) {
    tNode = parentTNode;
    parentTNode = tNode.parent;
  }
  return parentTNode;
}

function serializeLView(lView: LView, hostNode: Element): NghDom {
  const ngh: NghDom = {
    containers: {},
    templates: {},
    nodes: {},
  };

  const tView = lView[TVIEW];
  for (let i = HEADER_OFFSET; i < tView.bindingStartIndex; i++) {
    let targetNode: Node|null = null;
    const adjustedIndex = i - HEADER_OFFSET;
    const tNode = tView.data[i] as TContainerNode;
    // tNode may be null in the case of a localRef
    if (!tNode) {
      continue;
    }
    if (Array.isArray(tNode.projection)) {
      // TODO: handle `RNode[]` as well.
      for (const headTNode of (tNode.projection as any[])) {
        // We may have `null`s in slots with no projected content.
        // Also, if we process re-projected content (i.e. `<ng-content>`
        // appears at projection location), skip annotations for this content
        // since all DOM nodes in this projection were handled while processing
        // a parent lView, which contains those nodes.
        if (headTNode && !isProjectionTNode(headTNode)) {
          if (!isInNonHydratableBlock(headTNode, lView)) {
            ngh.nodes[headTNode.index - HEADER_OFFSET] = calcPathForNode(tView, lView, headTNode);
          }
        }
      }
    }
    if (isLContainer(lView[i])) {
      // this is a container
      const tNode = tView.data[i] as TContainerNode;
      const embeddedTView = tNode.tViews;
      if (embeddedTView !== null) {
        if (Array.isArray(embeddedTView)) {
          throw new Error(`Expecting tNode.tViews to be an object, but it's an array.`);
        }
        ngh.templates![i - HEADER_OFFSET] = getTViewSsrId(embeddedTView);
      }
      const hostNode = lView[i][HOST]!;
      // LView[i][HOST] can be 2 different types:
      // - either a DOM Node
      // - or an LView Array that represents a component
      // We only handle the DOM Node case here
      if (Array.isArray(hostNode)) {
        // this is a component
        // Check to see if it has ngNonHydratable
        // TODO: should we check `NON_HYDRATABLE_ATTR_NAME` in tNode.mergedAttrs?
        targetNode = unwrapRNode(hostNode as LView) as Element;
        if (!(targetNode as HTMLElement).hasAttribute(NON_HYDRATABLE_ATTR_NAME)) {
          annotateHostElementForHydration(targetNode as Element, hostNode as LView);
        }
      } else {
        // this is a regular node
        targetNode = unwrapRNode(hostNode) as Node;
      }
      const container = serializeLContainer(lView[i], hostNode);
      ngh.containers![adjustedIndex] = container;
    } else if (Array.isArray(lView[i])) {
      // This is a component
      // Check to see if it has ngNonHydratable
      // TODO: should we check `NON_HYDRATABLE_ATTR_NAME` in tNode.mergedAttrs?
      targetNode = unwrapRNode(lView[i][HOST]!) as Element;
      if (!(targetNode as HTMLElement).hasAttribute(NON_HYDRATABLE_ATTR_NAME)) {
        annotateHostElementForHydration(targetNode as Element, lView[i]);
      }
    } else if (isTI18nNode(tNode) || tNode.insertBeforeIndex) {
      // TODO: implement hydration for i18n nodes
      throw new Error('Hydration for i18n nodes is not implemented.');
    } else {
      const tNodeType = tNode.type;
      // <ng-container> case
      if (tNodeType & TNodeType.ElementContainer) {
        const rootNodes: any[] = [];
        collectNativeNodes(tView, lView, tNode.child, rootNodes);

        // This is an "element" container (vs "view" container),
        // so it's only represented by the number of top-level nodes
        // as a shift to get to a corresponding comment node.
        const container: NghContainer = {
          views: [],
          numRootNodes: rootNodes.length,
        };

        ngh.containers[adjustedIndex] = container;
      } else if (tNodeType & TNodeType.Projection) {
        // Current TNode has no DOM element associated with it,
        // so the following node would not be able to find an anchor.
        // Use full path instead.
        let nextTNode = tNode.next;
        while (nextTNode !== null && (nextTNode.type & TNodeType.Projection)) {
          nextTNode = nextTNode.next;
        }
        if (nextTNode) {
          const index = nextTNode.index - HEADER_OFFSET;
          if (!isInNonHydratableBlock(nextTNode, lView)) {
            const path = calcPathForNode(tView, lView, nextTNode);
            ngh.nodes[index] = path;
          }
        }
      } else {
        if (isDroppedProjectedNode(tNode)) {
          // This is a case where a node used in content projection
          // doesn't make it into one of the content projection slots
          // (for example, when there is no default <ng-content /> slot
          // in projector component's template).
          ngh.nodes[adjustedIndex] = DROPPED_PROJECTED_NODE;
        } else if (tNode.projectionNext && tNode.projectionNext !== tNode.next) {
          // Check if projection next is not the same as next, in which case
          // the node would not be found at creation time at runtime and we
          // need to provide a location to that node.
          const nextProjectedTNode = tNode.projectionNext;
          const index = nextProjectedTNode.index - HEADER_OFFSET;
          if (!isInNonHydratableBlock(nextProjectedTNode, lView)) {
            const path = calcPathForNode(tView, lView, nextProjectedTNode);
            ngh.nodes[index] = path;
          }
        }
      }
    }
  }
  return ngh;
}

function isRootLevelProjectionNode(tNode: TNode): boolean {
  return (tNode.flags & TNodeFlags.isProjected) === TNodeFlags.isProjected;
}

/**
 * Special marker that indicates that this node was dropped
 * during content projection. We need to re-create this node
 * from scratch during hydration.
 */
const DROPPED_PROJECTED_NODE = '-';

/**
 * Detect a case where a node used in content projection,
 * but doesn't make it into one of the content projection slots
 * (for example, when there is no default <ng-content /> slot
 * in projector component's template).
 */
function isDroppedProjectedNode(tNode: TNode): boolean {
  let currentTNode = tNode;
  let seenComponentHost = false;
  while (currentTNode !== null) {
    if (isComponentHost(currentTNode)) {
      seenComponentHost = true;
      break;
    }
    // If we come across a root projected node, return true.
    if (isRootLevelProjectionNode(currentTNode)) {
      return false;
    }
    currentTNode = currentTNode.parent as TNode;
  }
  // If we've seen a component host, but there was no root level
  // projection node, this indicates that this not was not projected.
  return seenComponentHost;
}

function calcPathForNode(
    tView: TView, lView: LView, tNode: TNode, parentTNode?: TNode|null): string {
  const index = tNode.index;
  // If `null` is passed explicitly, use this as a signal that we want to calculate
  // the path starting from `lView[HOST]`.
  parentTNode = parentTNode === null ? null : (parentTNode || tNode.parent!);
  const parentIndex = parentTNode === null ? 'host' : parentTNode.index;
  const parentRNode =
      parentTNode === null ? lView[HOST] : unwrapRNode(lView[parentIndex as number]);
  let rNode = unwrapRNode(lView[index]);
  if (tNode.type & TNodeType.AnyContainer) {
    // For <ng-container> nodes, instead of serializing a reference
    // to the anchor comment node, serialize a location of the first
    // DOM element. Paired with the container size (serialized as a part
    // of `ngh.containers`), it should give enough information for runtime
    // to hydrate nodes in this container.
    //
    // Note: for ElementContainers (i.e. `<ng-container>` elements), we use
    // a first child from the tNode data structures, since we want to collect
    // add root nodes starting from the first child node in a container.
    const childTNode = tNode.type & TNodeType.ElementContainer ? tNode.child : tNode;
    const firstRNode = firstRNodeInElementContainer(tView, lView, childTNode!);
    // If container is not empty, use a reference to the first element,
    // otherwise, rNode would point to an anchor comment node.
    if (firstRNode) {
      rNode = firstRNode;
    }
  }
  const parentId = parentIndex === 'host' ? parentIndex : '' + (parentIndex - HEADER_OFFSET);
  let path: string[] = calcPathBetween(parentRNode as Node, rNode as Node, parentId);
  if (path.length === 0 && parentRNode !== rNode) {
    // Searching for a path between elements within a host node failed.
    // Trying to find a path to an element starting from the `document.body` instead.
    path =
        calcPathBetween((parentRNode as Node).ownerDocument!.body as Node, rNode as Node, 'body');

    if (path.length === 0) {
      // If path is still empty, it's likely that this node is detached and
      // won't be found during hydration.
      // TODO: add a better error message, potentially suggesting `ngNonHydratable`.
      throw new Error('Unable to locate element on a page.');
    }
  }
  return path.join('.');
}

let ssrId: number = 0;
const ssrIdMap = new Map<TView, string>();

function getTViewSsrId(tView: TView): string {
  if (!ssrIdMap.has(tView)) {
    ssrIdMap.set(tView, `t${ssrId++}`);
  }
  return ssrIdMap.get(tView)!;
}

function serializeLContainer(lContainer: LContainer, hostNode: Element): NghContainer {
  const container: NghContainer = {
    views: [],
  };

  for (let i = CONTAINER_HEADER_OFFSET; i < lContainer.length; i++) {
    let childLView = lContainer[i] as LView;

    // Get LView for underlying component.
    if (isRootView(childLView)) {
      childLView = childLView[HEADER_OFFSET];
    }
    const childTView = childLView[TVIEW];

    let template;
    let numRootNodes = 0;
    if (childTView.type === TViewType.Component) {
      const ctx = childLView[CONTEXT];
      // TODO: this is a hack (we capture a component host element name),
      // we need a more stable solution here, for ex. a way to generate
      // a component id, see https://github.com/angular/angular/pull/48253.
      template = (ctx!.constructor as any)['ɵcmp'].selectors[0][0];

      // This is a component view, which has only 1 root node: the component
      // host node itself (other nodes would be inside that host node).
      numRootNodes = 1;
    } else {
      template = getTViewSsrId(childTView);  // from which template did this lView originate?

      // Collect root nodes within this view.
      const rootNodes: any[] = [];
      collectNativeNodes(childTView, childLView, childTView.firstChild, rootNodes);
      numRootNodes = rootNodes.length;
    }

    container.views.push({
      template,
      numRootNodes,
      ...serializeLView(lContainer[i] as LView, hostNode),
    });
  }

  return container;
}

export function annotateHostElementForHydration(element: Element, lView: LView): void {
  const rawNgh = serializeLView(lView, element);
  const serializedNgh = compressNghInfo(rawNgh);
  element.setAttribute(NGH_ATTR_NAME, serializedNgh);
}
