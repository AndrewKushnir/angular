/**
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */

import {ApplicationRef, retrieveViewsFromApplicationRef} from '../application_ref';
import {Type} from '../interface/type';
import {collectNativeNodes} from '../render3/collect_native_nodes';
import {getComponentDef, getComponentId} from '../render3/definition';
import {CONTAINER_HEADER_OFFSET, LContainer} from '../render3/interfaces/container';
import {TContainerNode, TNode, TNodeFlags, TNodeType} from '../render3/interfaces/node';
import {isComponentHost, isLContainer, isProjectionTNode, isRootView} from '../render3/interfaces/type_checks';
import {CONTEXT, FLAGS, HEADER_OFFSET, HOST, LView, LViewFlags, TView, TVIEW, TViewType} from '../render3/interfaces/view';
import {getFirstNativeNode} from '../render3/node_manipulation';
import {unwrapRNode} from '../render3/util/view_utils';
import {makeStateKey, TransferState} from '../transfer_state';

import {TRANSFER_STATE_TOKEN_ID} from './api';
import {nodeNotFoundError} from './error_handling';
import {CONTAINERS, LAZY, MULTIPLIER, NghContainer, NghDom, NghView, NODES, NUM_ROOT_NODES, TEMPLATE, TEMPLATES, VIEWS} from './interfaces';
import {calcPathBetween, REFERENCE_NODE_BODY, REFERENCE_NODE_HOST} from './node_lookup_utils';
import {SsrPerfMetrics, SsrProfiler} from './profiler';
import {isInSkipHydrationBlock, SKIP_HYDRATION_ATTR_NAME} from './skip_hydration';
import {DROPPED_PROJECTED_NODE, EMPTY_TEXT_NODE_COMMENT, getComponentLView, NGH_ATTR_NAME, TEXT_NODE_SEPARATOR_COMMENT} from './utils';

/**
 * Registry that keeps track of unique TView ids throughout
 * the serialization process. This is needed to identify
 * dehydrated views at runtime properly (pick up dehydrated
 * views created based on a certain TView).
 */
class TViewSsrIdRegistry {
  private registry = new WeakMap<TView, string>();
  private currentId = 0;

  get(tView: TView): string {
    if (!this.registry.has(tView)) {
      this.registry.set(tView, `t${this.currentId++}`);
    }
    return this.registry.get(tView)!;
  }
}

/**
 * Keeps track of all produced `ngh` annotations and avoids
 * duplication. If the same annotation is being added, the collection
 * remains the same and an index of that annotation is returned instead.
 * This helps minimize the amount of annotations needed on a page.
 */
class NghAnnotationCollection {
  private data: NghDom[] = [];
  private indexByContent = new Map<string, number>();

  add(ngh: NghDom): number {
    const nghAsString = JSON.stringify(ngh);
    if (!this.indexByContent.has(nghAsString)) {
      const index = this.data.length;
      this.data.push(ngh);
      this.indexByContent.set(nghAsString, index);
      return index;
    }
    return this.indexByContent.get(nghAsString)!;
  }

  getAllAnnotations() {
    return this.data;
  }
}

/**
 * Describes a context available during the serialization
 * process. The context is used to share and collect information
 * during the serialization.
 */
interface HydrationContext {
  ssrIdRegistry: TViewSsrIdRegistry;
  corruptedTextNodes: Map<string, HTMLElement>;
  profiler: SsrProfiler|null;
  annotationCollection: NghAnnotationCollection;
}

/**
 * Annotates all components bootstrapped in a given ApplicationRef
 * with info needed for hydration.
 *
 * @param appRef A current instance of an ApplicationRef.
 * @param doc A reference to the current Document instance.
 */
export function annotateForHydration(
    appRef: ApplicationRef, doc: Document, transferState: TransferState,
    profiler: SsrProfiler|null) {
  const ssrIdRegistry = new TViewSsrIdRegistry();
  const corruptedTextNodes = new Map<string, HTMLElement>();
  const annotationCollection = new NghAnnotationCollection();
  const viewRefs = retrieveViewsFromApplicationRef(appRef);
  for (const viewRef of viewRefs) {
    const lView = getComponentLView(viewRef);
    // TODO: make sure that this lView represents
    // a component instance.
    const hostElement = lView[HOST];
    if (hostElement) {
      const context: HydrationContext = {
        ssrIdRegistry,
        corruptedTextNodes,
        profiler,
        annotationCollection,
      };
      annotateHostElementForHydration(hostElement, lView, context);
      insertTextNodeMarkers(corruptedTextNodes, doc);
      profiler?.incrementMetricValue(SsrPerfMetrics.EmptyTextNodeCount, corruptedTextNodes.size);
    }
  }
  const allAnnotations = annotationCollection.getAllAnnotations();
  if (allAnnotations.length > 0) {
    transferState.set(NGH_DATA_KEY, allAnnotations);
  }
}

function isTI18nNode(obj: any): boolean {
  // TODO: consider adding a node type to TI18n?
  return obj.hasOwnProperty('create') && obj.hasOwnProperty('update');
}

function serializeLView(lView: LView, context: HydrationContext): NghDom {
  const ngh: NghDom = {};
  const tView = lView[TVIEW];
  for (let i = HEADER_OFFSET; i < tView.bindingStartIndex; i++) {
    let targetNode: Node|null = null;
    const adjustedIndex = i - HEADER_OFFSET;
    const tNode = tView.data[i] as TContainerNode;
    // tNode may be null in the case of a localRef
    if (!tNode) {
      continue;
    }
    if (context.profiler) {
      // We process 1 more node from LView here. If we process a component
      // or an LContainer, we can still increase the value by one, since both
      // of them have native nodes (e.g. `lContainer[HOST]`).
      context.profiler.incrementMetricValue(SsrPerfMetrics.SerializedDomNodes, 1);
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
          if (!isInSkipHydrationBlock(headTNode, lView)) {
            ngh[NODES] ??= {};
            ngh[NODES][headTNode.index - HEADER_OFFSET] = calcPathForNode(lView, headTNode);
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
        ngh[TEMPLATES] ??= {};
        ngh[TEMPLATES][i - HEADER_OFFSET] = context.ssrIdRegistry.get(embeddedTView);
      }
      const hostNode = lView[i][HOST]!;
      // LView[i][HOST] can be 2 different types:
      // - either a DOM Node
      // - or an LView Array that represents a component
      // We only handle the DOM Node case here
      if (Array.isArray(hostNode)) {
        // this is a component
        // Check to see if it has ngSkipHydration
        // TODO: should we check `SKIP_HYDRATION_ATTR_NAME` in tNode.mergedAttrs?
        targetNode = unwrapRNode(hostNode as LView) as Element;
        if (!(targetNode as HTMLElement).hasAttribute(SKIP_HYDRATION_ATTR_NAME)) {
          annotateHostElementForHydration(targetNode as Element, hostNode as LView, context);
        }
      }
      const container = serializeLContainer(lView[i], context);
      ngh[CONTAINERS] ??= {};
      ngh[CONTAINERS][adjustedIndex] = container;
    } else if (Array.isArray(lView[i])) {
      // This is a component
      // Check to see if it has ngSkipHydration
      // TODO: should we check `SKIP_HYDRATION_ATTR_NAME` in tNode.mergedAttrs?
      targetNode = unwrapRNode(lView[i][HOST]!) as Element;
      if (!(targetNode as HTMLElement).hasAttribute(SKIP_HYDRATION_ATTR_NAME)) {
        annotateHostElementForHydration(targetNode as Element, lView[i], context);
      }
    } else if (isTI18nNode(tNode) || tNode.insertBeforeIndex) {
      // TODO: improve this error message to suggest possible solutions
      // (ngSkipHydration?).
      throw new Error('Hydration for i18n nodes is not yet supported.');
    } else {
      const tNodeType = tNode.type;
      // <ng-container> case
      if (tNodeType & TNodeType.ElementContainer) {
        // This is an "element" container (vs "view" container),
        // so it's only represented by the number of top-level nodes
        // as a shift to get to a corresponding comment node.
        const container: NghContainer = {
          [NUM_ROOT_NODES]: calcNumRootNodes(tView, lView, tNode.child),
        };

        ngh[CONTAINERS] ??= {};
        ngh[CONTAINERS][adjustedIndex] = container;
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
          if (!isInSkipHydrationBlock(nextTNode, lView)) {
            const path = calcPathForNode(lView, nextTNode);
            ngh[NODES] ??= {};
            ngh[NODES][index] = path;
          }
        }
      } else {
        if (isDroppedProjectedNode(tNode)) {
          // This is a case where a node used in content projection
          // doesn't make it into one of the content projection slots
          // (for example, when there is no default <ng-content /> slot
          // in projector component's template).
          ngh[NODES] ??= {};
          ngh[NODES][adjustedIndex] = DROPPED_PROJECTED_NODE;
        } else {
          // Handle cases where text nodes can be lost after DOM serialization:
          //  1. When there is an *empty text node* in DOM: in this case, this
          //     node would not make it into the serialized string and as s result,
          //     this node wouldn't be created in a browser. This would result in
          //     a mismatch during the hydration, where the runtime logic would expect
          //     a text node to be present in live DOM, but no text node would exist.
          //     Example: `<span>{{ name }}</span>` when the `name` is an empty string.
          //     This would result in `<span></span>` string after serialization and
          //     in a browser only the `span` element would be created. To resolve that,
          //     an extra comment node is appended in place of an empty text node and
          //     that special comment node is replaced with an empty text node *before*
          //     hydration.
          //  2. When there are 2 consecutive text nodes present in the DOM.
          //     Example: `<div>Hello <ng-container *ngIf="true">world</ng-container></div>`.
          //     In this scenario, the live DOM would look like this:
          //       <div>#text('Hello ') #text('world') #comment('container')</div>
          //     Serialized string would look like this: `<div>Hello world<!--container--></div>`.
          //     The live DOM in a browser after that would be:
          //       <div>#text('Hello world') #comment('container')</div>
          //     Notice how 2 text nodes are now "merged" into one. This would cause hydration
          //     logic to fail, since it'd expect 2 text nodes being present, not one.
          //     To fix this, we insert a special comment node in between those text nodes, so
          //     serialized representation is: `<div>Hello <!--ngtns-->world<!--container--></div>`.
          //     This forces browser to create 2 text nodes separated by a comment node.
          //     Before running a hydration process, this special comment node is removed, so the
          //     live DOM has exactly the same state as it was before serialization.
          if (tNodeType & TNodeType.Text) {
            const rNode = unwrapRNode(lView[i]) as HTMLElement;
            if (rNode.textContent === '') {
              context.corruptedTextNodes.set(EMPTY_TEXT_NODE_COMMENT, rNode);
            } else if (rNode.nextSibling?.nodeType === Node.TEXT_NODE) {
              context.corruptedTextNodes.set(TEXT_NODE_SEPARATOR_COMMENT, rNode);
            }
          }

          if (tNode.projectionNext && tNode.projectionNext !== tNode.next) {
            // Check if projection next is not the same as next, in which case
            // the node would not be found at creation time at runtime and we
            // need to provide a location to that node.
            const nextProjectedTNode = tNode.projectionNext;
            const index = nextProjectedTNode.index - HEADER_OFFSET;
            if (!isInSkipHydrationBlock(nextProjectedTNode, lView)) {
              const path = calcPathForNode(lView, nextProjectedTNode);
              ngh[NODES] ??= {};
              ngh[NODES][index] = path;
            }
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

function calcPathForNode(lView: LView, tNode: TNode): string {
  const index = tNode.index;
  const parentTNode = tNode.parent;
  const parentIndex = parentTNode === null ? REFERENCE_NODE_HOST : parentTNode.index;
  const parentRNode =
      parentTNode === null ? lView[HOST] : unwrapRNode(lView[parentIndex as number]);
  let rNode = unwrapRNode(lView[index]);
  if (tNode.type & TNodeType.AnyContainer) {
    // For <ng-container> nodes, instead of serializing a reference
    // to the anchor comment node, serialize a location of the first
    // DOM element. Paired with the container size (serialized as a part
    // of `ngh.containers`), it should give enough information for runtime
    // to hydrate nodes in this container.
    const firstRNode = getFirstNativeNode(lView, tNode);

    // If container is not empty, use a reference to the first element,
    // otherwise, rNode would point to an anchor comment node.
    if (firstRNode) {
      rNode = firstRNode;
    }
  }
  const referenceNode =
      parentIndex === REFERENCE_NODE_HOST ? parentIndex : '' + (parentIndex - HEADER_OFFSET);
  let path: string|null = calcPathBetween(parentRNode as Node, rNode as Node, referenceNode);
  if (path === null && parentRNode !== rNode) {
    // Searching for a path between elements within a host node failed.
    // Trying to find a path to an element starting from the `document.body` instead.
    const body = (parentRNode as Node).ownerDocument!.body as Node;
    path = calcPathBetween(body, rNode as Node, REFERENCE_NODE_BODY);

    if (path === null) {
      // If the path is still empty, it's likely that this node is detached and
      // won't be found during hydration.
      throw nodeNotFoundError(lView, tNode);
    }
  }
  return path!;
}

function calcNumRootNodes(tView: TView, lView: LView, tNode: TNode|null): number {
  const rootNodes: unknown[] = [];
  collectNativeNodes(tView, lView, tNode, rootNodes);
  return rootNodes.length;
}

function serializeLContainer(lContainer: LContainer, context: HydrationContext): NghContainer {
  const container: NghContainer = {};

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
      const componentDef = getComponentDef(ctx!.constructor as Type<unknown>)!;
      template = getComponentId(componentDef);

      // This is a component view, which has only 1 root node: the component
      // host node itself (other nodes would be inside that host node).
      numRootNodes = 1;
    } else {
      template = context.ssrIdRegistry.get(childTView);
      numRootNodes = calcNumRootNodes(childTView, childLView, childTView.firstChild);
    }

    const view: NghView = {
      [TEMPLATE]: template,
      [NUM_ROOT_NODES]: numRootNodes,
      ...serializeLView(lContainer[i] as LView, context),
    };
    // Add annotation if a view is lazy.
    if ((childLView[FLAGS] & LViewFlags.Lazy) === LViewFlags.Lazy) {
      view[LAZY] = 1;  // use number instead of true, because it's shorter
    }
    container[VIEWS] ??= [];
    if (container[VIEWS].length > 0) {
      const prevView = container[VIEWS].at(-1)!;  // the last element in array
      // Compare `view` and `prevView` to see if they are the same.
      if (compareNghView(view, prevView)) {
        prevView[MULTIPLIER] ??= 1;
        prevView[MULTIPLIER]++;
      } else {
        container[VIEWS].push(view);
      }
    } else {
      container[VIEWS].push(view);
    }
  }

  return container;
}

function compareNghView(curr: NghView, prev: NghView): boolean {
  const prevClone = {...prev};
  delete prevClone[MULTIPLIER];
  return JSON.stringify(curr) === JSON.stringify(prevClone);
}

export const NGH_DATA_KEY = makeStateKey<Array<NghDom>>(TRANSFER_STATE_TOKEN_ID);

export function annotateHostElementForHydration(
    element: Element, lView: LView, context: HydrationContext): void {
  const ngh = serializeLView(lView, context);
  const index = context.annotationCollection.add(ngh);
  if (context.profiler) {
    if (Object.keys(ngh).length === 0) {
      context.profiler.incrementMetricValue(SsrPerfMetrics.ComponentsWithEmptyNgh, 1);
    }
    context.profiler.incrementMetricValue(
        SsrPerfMetrics.NghAnnotationSize,
        index.toString().length + 7);  // 7 to account for ' ngh=""'
    context.profiler.incrementMetricValue(
        SsrPerfMetrics.SerializedComponents, 1);  // increment by one more component
  }
  element.setAttribute(NGH_ATTR_NAME, index.toString());
}

function insertTextNodeMarkers(corruptedTextNodes: Map<string, HTMLElement>, doc: Document) {
  for (let [marker, textNode] of corruptedTextNodes) {
    textNode.after(doc.createComment(marker));
  }
}
