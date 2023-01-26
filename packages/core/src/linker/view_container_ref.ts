/**
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */

import {Injector} from '../di/injector';
import {EnvironmentInjector} from '../di/r3_injector';
import {isType, Type} from '../interface/type';
import {assertNodeInjector, assertRComment} from '../render3/assert';
import {ComponentFactory as R3ComponentFactory} from '../render3/component_ref';
import {getComponentDef} from '../render3/definition';
import {getParentInjectorLocation, NodeInjector} from '../render3/di';
import {isNodeDisconnected, locateDehydratedViewsInContainer, markRNodeAsClaimedForHydration, siblingAfter} from '../render3/hydration';
import {addToViewTree, createLContainer, navigateParentTNodes} from '../render3/instructions/shared';
import {CONTAINER_HEADER_OFFSET, DEHYDRATED_VIEWS, LContainer, NATIVE, VIEW_REFS} from '../render3/interfaces/container';
import {NodeInjectorOffset} from '../render3/interfaces/injector';
import {TContainerNode, TDirectiveHostNode, TElementContainerNode, TElementNode, TNode, TNodeType} from '../render3/interfaces/node';
import {RComment, RElement, RNode} from '../render3/interfaces/renderer_dom';
import {isLContainer} from '../render3/interfaces/type_checks';
import {HEADER_OFFSET, HYDRATION_INFO, LView, NghContainer, NghDom, NghView, PARENT, RENDERER, T_HOST, TVIEW} from '../render3/interfaces/view';
import {assertTNodeType} from '../render3/node_assert';
import {addViewToContainer, destroyLView, detachView, getBeforeNodeForView, insertView, nativeInsertBefore, nativeNextSibling, nativeParentNode} from '../render3/node_manipulation';
import {getCurrentTNode, getLView} from '../render3/state';
import {getParentInjectorIndex, getParentInjectorView, hasParentInjector} from '../render3/util/injector_utils';
import {getNativeByTNode, unwrapRNode, viewAttachedToContainer} from '../render3/util/view_utils';
import {ViewRef as R3ViewRef} from '../render3/view_ref';
import {addToArray, removeFromArray} from '../util/array_utils';
import {assertDefined, assertEqual, assertGreaterThan, assertLessThan, throwError} from '../util/assert';

import {ComponentFactory, ComponentRef} from './component_factory';
import {createElementRef, ElementRef} from './element_ref';
import {NgModuleRef} from './ng_module_factory';
import {TemplateRef} from './template_ref';
import {EmbeddedViewRef, ViewRef} from './view_ref';

/**
 * Represents a container where one or more views can be attached to a component.
 *
 * Can contain *host views* (created by instantiating a
 * component with the `createComponent()` method), and *embedded views*
 * (created by instantiating a `TemplateRef` with the `createEmbeddedView()` method).
 *
 * A view container instance can contain other view containers,
 * creating a [view hierarchy](guide/glossary#view-tree).
 *
 * @see `ComponentRef`
 * @see `EmbeddedViewRef`
 *
 * @publicApi
 */
export abstract class ViewContainerRef {
  /**
   * Anchor element that specifies the location of this container in the containing view.
   * Each view container can have only one anchor element, and each anchor element
   * can have only a single view container.
   *
   * Root elements of views attached to this container become siblings of the anchor element in
   * the rendered view.
   *
   * Access the `ViewContainerRef` of an element by placing a `Directive` injected
   * with `ViewContainerRef` on the element, or use a `ViewChild` query.
   *
   * <!-- TODO: rename to anchorElement -->
   */
  abstract get element(): ElementRef;

  /**
   * The [dependency injector](guide/glossary#injector) for this view container.
   */
  abstract get injector(): Injector;

  /** @deprecated No replacement */
  abstract get parentInjector(): Injector;

  /**
   * Destroys all views in this container.
   */
  abstract clear(): void;

  /**
   * Retrieves a view from this container.
   * @param index The 0-based index of the view to retrieve.
   * @returns The `ViewRef` instance, or null if the index is out of range.
   */
  abstract get(index: number): ViewRef|null;

  /**
   * Reports how many views are currently attached to this container.
   * @returns The number of views.
   */
  abstract get length(): number;

  /**
   * Instantiates an embedded view and inserts it
   * into this container.
   * @param templateRef The HTML template that defines the view.
   * @param context The data-binding context of the embedded view, as declared
   * in the `<ng-template>` usage.
   * @param options Extra configuration for the created view. Includes:
   *  * index: The 0-based index at which to insert the new view into this container.
   *           If not specified, appends the new view as the last entry.
   *  * injector: Injector to be used within the embedded view.
   *
   * @returns The `ViewRef` instance for the newly created view.
   */
  abstract createEmbeddedView<C>(templateRef: TemplateRef<C>, context?: C, options?: {
    index?: number,
    injector?: Injector
  }): EmbeddedViewRef<C>;

  /**
   * Instantiates an embedded view and inserts it
   * into this container.
   * @param templateRef The HTML template that defines the view.
   * @param context The data-binding context of the embedded view, as declared
   * in the `<ng-template>` usage.
   * @param index The 0-based index at which to insert the new view into this container.
   * If not specified, appends the new view as the last entry.
   *
   * @returns The `ViewRef` instance for the newly created view.
   */
  abstract createEmbeddedView<C>(templateRef: TemplateRef<C>, context?: C, index?: number):
      EmbeddedViewRef<C>;

  /**
   * Instantiates a single component and inserts its host view into this container.
   *
   * @param componentType Component Type to use.
   * @param options An object that contains extra parameters:
   *  * index: the index at which to insert the new component's host view into this container.
   *           If not specified, appends the new view as the last entry.
   *  * injector: the injector to use as the parent for the new component.
   *  * ngModuleRef: an NgModuleRef of the component's NgModule, you should almost always provide
   *                 this to ensure that all expected providers are available for the component
   *                 instantiation.
   *  * environmentInjector: an EnvironmentInjector which will provide the component's environment.
   *                 you should almost always provide this to ensure that all expected providers
   *                 are available for the component instantiation. This option is intended to
   *                 replace the `ngModuleRef` parameter.
   *  * projectableNodes: list of DOM nodes that should be projected through
   *                      [`<ng-content>`](api/core/ng-content) of the new component instance.
   *
   * @returns The new `ComponentRef` which contains the component instance and the host view.
   */
  abstract createComponent<C>(componentType: Type<C>, options?: {
    index?: number,
    injector?: Injector,
    ngModuleRef?: NgModuleRef<unknown>,
    environmentInjector?: EnvironmentInjector|NgModuleRef<unknown>,
    projectableNodes?: Node[][],
  }): ComponentRef<C>;

  /**
   * Instantiates a single component and inserts its host view into this container.
   *
   * @param componentFactory Component factory to use.
   * @param index The index at which to insert the new component's host view into this container.
   * If not specified, appends the new view as the last entry.
   * @param injector The injector to use as the parent for the new component.
   * @param projectableNodes List of DOM nodes that should be projected through
   *     [`<ng-content>`](api/core/ng-content) of the new component instance.
   * @param ngModuleRef An instance of the NgModuleRef that represent an NgModule.
   * This information is used to retrieve corresponding NgModule injector.
   *
   * @returns The new `ComponentRef` which contains the component instance and the host view.
   *
   * @deprecated Angular no longer requires component factories to dynamically create components.
   *     Use different signature of the `createComponent` method, which allows passing
   *     Component class directly.
   */
  abstract createComponent<C>(
      componentFactory: ComponentFactory<C>, index?: number, injector?: Injector,
      projectableNodes?: any[][],
      environmentInjector?: EnvironmentInjector|NgModuleRef<any>): ComponentRef<C>;

  /**
   * Inserts a view into this container.
   * @param viewRef The view to insert.
   * @param index The 0-based index at which to insert the view.
   * If not specified, appends the new view as the last entry.
   * @returns The inserted `ViewRef` instance.
   *
   */
  abstract insert(viewRef: ViewRef, index?: number): ViewRef;

  /**
   * Moves a view to a new location in this container.
   * @param viewRef The view to move.
   * @param index The 0-based index of the new location.
   * @returns The moved `ViewRef` instance.
   */
  abstract move(viewRef: ViewRef, currentIndex: number): ViewRef;

  /**
   * Returns the index of a view within the current container.
   * @param viewRef The view to query.
   * @returns The 0-based index of the view's position in this container,
   * or `-1` if this container doesn't contain the view.
   */
  abstract indexOf(viewRef: ViewRef): number;

  /**
   * Destroys a view attached to this container
   * @param index The 0-based index of the view to destroy.
   * If not specified, the last view in the container is removed.
   */
  abstract remove(index?: number): void;

  /**
   * Detaches a view from this container without destroying it.
   * Use along with `insert()` to move a view within the current container.
   * @param index The 0-based index of the view to detach.
   * If not specified, the last view in the container is detached.
   */
  abstract detach(index?: number): ViewRef|null;

  /**
   * @internal
   * @nocollapse
   */
  static __NG_ELEMENT_ID__: () => ViewContainerRef = injectViewContainerRef;
}

/**
 * Creates a ViewContainerRef and stores it on the injector. Or, if the ViewContainerRef
 * already exists, retrieves the existing ViewContainerRef.
 *
 * @returns The ViewContainerRef instance to use
 */
export function injectViewContainerRef(): ViewContainerRef {
  const previousTNode = getCurrentTNode() as TElementNode | TElementContainerNode | TContainerNode;
  return createContainerRef(previousTNode, getLView());
}

const VE_ViewContainerRef = ViewContainerRef;

// TODO(alxhub): cleaning up this indirection triggers a subtle bug in Closure in g3. Once the fix
// for that lands, this can be cleaned up.
const R3ViewContainerRef = class ViewContainerRef extends VE_ViewContainerRef {
  constructor(
      private _lContainer: LContainer,
      private _hostTNode: TElementNode|TContainerNode|TElementContainerNode,
      private _hostLView: LView) {
    super();
  }

  override get element(): ElementRef {
    return createElementRef(this._hostTNode, this._hostLView);
  }

  override get injector(): Injector {
    return new NodeInjector(this._hostTNode, this._hostLView);
  }

  /** @deprecated No replacement */
  override get parentInjector(): Injector {
    const parentLocation = getParentInjectorLocation(this._hostTNode, this._hostLView);
    if (hasParentInjector(parentLocation)) {
      const parentView = getParentInjectorView(parentLocation, this._hostLView);
      const injectorIndex = getParentInjectorIndex(parentLocation);
      ngDevMode && assertNodeInjector(parentView, injectorIndex);
      const parentTNode =
          parentView[TVIEW].data[injectorIndex + NodeInjectorOffset.TNODE] as TElementNode;
      return new NodeInjector(parentTNode, parentView);
    } else {
      return new NodeInjector(null, this._hostLView);
    }
  }

  override clear(): void {
    while (this.length > 0) {
      this.remove(this.length - 1);
    }
  }

  override get(index: number): ViewRef|null {
    const viewRefs = getViewRefs(this._lContainer);
    return viewRefs !== null && viewRefs[index] || null;
  }

  override get length(): number {
    return this._lContainer.length - CONTAINER_HEADER_OFFSET;
  }

  override createEmbeddedView<C>(templateRef: TemplateRef<C>, context?: C, options?: {
    index?: number,
    injector?: Injector
  }): EmbeddedViewRef<C>;
  override createEmbeddedView<C>(templateRef: TemplateRef<C>, context?: C, index?: number):
      EmbeddedViewRef<C>;
  override createEmbeddedView<C>(templateRef: TemplateRef<C>, context?: C, indexOrOptions?: number|{
    index?: number,
    injector?: Injector
  }): EmbeddedViewRef<C> {
    let index: number|undefined;
    let injector: Injector|undefined;

    if (typeof indexOrOptions === 'number') {
      index = indexOrOptions;
    } else if (indexOrOptions != null) {
      index = indexOrOptions.index;
      injector = indexOrOptions.injector;
    }

    let hydrationInfo: NghView|null = null;
    const ssrId = (templateRef as unknown as {ssrId: string | null}).ssrId;
    if (ssrId) {
      hydrationInfo = findMatchingDehydratedView(this._lContainer, ssrId);
    }

    const viewRef =
        templateRef.createEmbeddedViewWithHydration(context || <any>{}, injector, hydrationInfo);

    this.insert(viewRef, index);
    return viewRef;
  }

  override createComponent<C>(componentType: Type<C>, options?: {
    index?: number,
    injector?: Injector,
    projectableNodes?: Node[][],
    ngModuleRef?: NgModuleRef<unknown>,
  }): ComponentRef<C>;
  /**
   * @deprecated Angular no longer requires component factories to dynamically create components.
   *     Use different signature of the `createComponent` method, which allows passing
   *     Component class directly.
   */
  override createComponent<C>(
      componentFactory: ComponentFactory<C>, index?: number|undefined,
      injector?: Injector|undefined, projectableNodes?: any[][]|undefined,
      environmentInjector?: EnvironmentInjector|NgModuleRef<any>|undefined): ComponentRef<C>;
  override createComponent<C>(
      componentFactoryOrType: ComponentFactory<C>|Type<C>, indexOrOptions?: number|undefined|{
        index?: number,
        injector?: Injector,
        ngModuleRef?: NgModuleRef<unknown>,
        environmentInjector?: EnvironmentInjector|NgModuleRef<unknown>,
        projectableNodes?: Node[][],
      },
      injector?: Injector|undefined, projectableNodes?: any[][]|undefined,
      environmentInjector?: EnvironmentInjector|NgModuleRef<any>|undefined): ComponentRef<C> {
    const isComponentFactory = componentFactoryOrType && !isType(componentFactoryOrType);
    let index: number|undefined;

    // This function supports 2 signatures and we need to handle options correctly for both:
    //   1. When first argument is a Component type. This signature also requires extra
    //      options to be provided as as object (more ergonomic option).
    //   2. First argument is a Component factory. In this case extra options are represented as
    //      positional arguments. This signature is less ergonomic and will be deprecated.
    if (isComponentFactory) {
      if (ngDevMode) {
        assertEqual(
            typeof indexOrOptions !== 'object', true,
            'It looks like Component factory was provided as the first argument ' +
                'and an options object as the second argument. This combination of arguments ' +
                'is incompatible. You can either change the first argument to provide Component ' +
                'type or change the second argument to be a number (representing an index at ' +
                'which to insert the new component\'s host view into this container)');
      }
      index = indexOrOptions as number | undefined;
    } else {
      if (ngDevMode) {
        assertDefined(
            getComponentDef(componentFactoryOrType),
            `Provided Component class doesn't contain Component definition. ` +
                `Please check whether provided class has @Component decorator.`);
        assertEqual(
            typeof indexOrOptions !== 'number', true,
            'It looks like Component type was provided as the first argument ' +
                'and a number (representing an index at which to insert the new component\'s ' +
                'host view into this container as the second argument. This combination of arguments ' +
                'is incompatible. Please use an object as the second argument instead.');
      }
      const options = (indexOrOptions || {}) as {
        index?: number,
        injector?: Injector,
        ngModuleRef?: NgModuleRef<unknown>,
        environmentInjector?: EnvironmentInjector | NgModuleRef<unknown>,
        projectableNodes?: Node[][],
      };
      if (ngDevMode && options.environmentInjector && options.ngModuleRef) {
        throwError(
            `Cannot pass both environmentInjector and ngModuleRef options to createComponent().`);
      }
      index = options.index;
      injector = options.injector;
      projectableNodes = options.projectableNodes;
      environmentInjector = options.environmentInjector || options.ngModuleRef;
    }

    const componentFactory: ComponentFactory<C> = isComponentFactory ?
        componentFactoryOrType as ComponentFactory<C>:
        new R3ComponentFactory(getComponentDef(componentFactoryOrType)!);
    const contextInjector = injector || this.parentInjector;

    // If an `NgModuleRef` is not provided explicitly, try retrieving it from the DI tree.
    if (!environmentInjector && (componentFactory as any).ngModule == null) {
      // For the `ComponentFactory` case, entering this logic is very unlikely, since we expect that
      // an instance of a `ComponentFactory`, resolved via `ComponentFactoryResolver` would have an
      // `ngModule` field. This is possible in some test scenarios and potentially in some JIT-based
      // use-cases. For the `ComponentFactory` case we preserve backwards-compatibility and try
      // using a provided injector first, then fall back to the parent injector of this
      // `ViewContainerRef` instance.
      //
      // For the factory-less case, it's critical to establish a connection with the module
      // injector tree (by retrieving an instance of an `NgModuleRef` and accessing its injector),
      // so that a component can use DI tokens provided in MgModules. For this reason, we can not
      // rely on the provided injector, since it might be detached from the DI tree (for example, if
      // it was created via `Injector.create` without specifying a parent injector, or if an
      // injector is retrieved from an `NgModuleRef` created via `createNgModule` using an
      // NgModule outside of a module tree). Instead, we always use `ViewContainerRef`'s parent
      // injector, which is normally connected to the DI tree, which includes module injector
      // subtree.
      const _injector = isComponentFactory ? contextInjector : this.parentInjector;

      // DO NOT REFACTOR. The code here used to have a `injector.get(NgModuleRef, null) ||
      // undefined` expression which seems to cause internal google apps to fail. This is documented
      // in the following internal bug issue: go/b/142967802
      const result = _injector.get(EnvironmentInjector, null);
      if (result) {
        environmentInjector = result;
      }
    }

    // TODO: this is not correct for selectors like `app[param]`,
    // we need to rely on some other info (like component id).
    const elementName = componentFactory.selector;
    const dehydratedView = findMatchingDehydratedView(this._lContainer, elementName);
    let rNode;
    let hydrationDomInfo: NghDom|null = null;

    if (dehydratedView) {
      // Pointer to a host DOM element.
      rNode = dehydratedView.firstChild;

      // Read hydration info and pass it over to the component view.
      const ngh = (rNode as HTMLElement).getAttribute('ngh');
      if (ngh) {
        hydrationDomInfo = JSON.parse(ngh) as NghDom;
        hydrationDomInfo.firstChild = rNode.firstChild as HTMLElement;
        (rNode as HTMLElement).removeAttribute('ngh');
        ngDevMode && markRNodeAsClaimedForHydration(rNode!);
      }
    }

    const componentRef = componentFactory.createWithHydration(
        contextInjector, projectableNodes, rNode, environmentInjector, hydrationDomInfo);

    this.insert(componentRef.hostView, index);
    return componentRef;
  }

  override insert(viewRef: ViewRef, index?: number): ViewRef {
    const lView = (viewRef as R3ViewRef<any>)._lView!;
    const tView = lView[TVIEW];

    if (ngDevMode && viewRef.destroyed) {
      throw new Error('Cannot insert a destroyed View in a ViewContainer!');
    }

    if (viewAttachedToContainer(lView)) {
      // If view is already attached, detach it first so we clean up references appropriately.

      const prevIdx = this.indexOf(viewRef);

      // A view might be attached either to this or a different container. The `prevIdx` for
      // those cases will be:
      // equal to -1 for views attached to this ViewContainerRef
      // >= 0 for views attached to a different ViewContainerRef
      if (prevIdx !== -1) {
        this.detach(prevIdx);
      } else {
        const prevLContainer = lView[PARENT] as LContainer;
        ngDevMode &&
            assertEqual(
                isLContainer(prevLContainer), true,
                'An attached view should have its PARENT point to a container.');


        // We need to re-create a R3ViewContainerRef instance since those are not stored on
        // LView (nor anywhere else).
        const prevVCRef = new R3ViewContainerRef(
            prevLContainer, prevLContainer[T_HOST] as TDirectiveHostNode, prevLContainer[PARENT]);

        prevVCRef.detach(prevVCRef.indexOf(viewRef));
      }
    }

    // Logical operation of adding `LView` to `LContainer`
    const adjustedIdx = this._adjustIndex(index);
    const lContainer = this._lContainer;
    insertView(tView, lView, lContainer, adjustedIdx);

    // Physical operation of adding the DOM nodes.
    //
    // If an LView has hydration info, avoid inserting elements
    // elements into the DOM as they are already attached.
    //
    // TODO: should we reset the `HYDRATION_INFO` afterwards?
    //       Without that there might be a problem later on when
    //       we'd try to insert/move the view again?
    if (!lView[HYDRATION_INFO]) {
      const beforeNode = getBeforeNodeForView(adjustedIdx, lContainer);
      const renderer = lView[RENDERER];
      const parentRNode = nativeParentNode(renderer, lContainer[NATIVE] as RElement | RComment);
      if (parentRNode !== null) {
        addViewToContainer(tView, lContainer[T_HOST], renderer, lView, parentRNode, beforeNode);
      }
    }

    (viewRef as R3ViewRef<any>).attachToViewContainerRef();
    addToArray(getOrCreateViewRefs(lContainer), adjustedIdx, viewRef);

    return viewRef;
  }

  override move(viewRef: ViewRef, newIndex: number): ViewRef {
    if (ngDevMode && viewRef.destroyed) {
      throw new Error('Cannot move a destroyed View in a ViewContainer!');
    }
    return this.insert(viewRef, newIndex);
  }

  override indexOf(viewRef: ViewRef): number {
    const viewRefsArr = getViewRefs(this._lContainer);
    return viewRefsArr !== null ? viewRefsArr.indexOf(viewRef) : -1;
  }

  override remove(index?: number): void {
    const adjustedIdx = this._adjustIndex(index, -1);
    const detachedView = detachView(this._lContainer, adjustedIdx);

    if (detachedView) {
      // Before destroying the view, remove it from the container's array of `ViewRef`s.
      // This ensures the view container length is updated before calling
      // `destroyLView`, which could recursively call view container methods that
      // rely on an accurate container length.
      // (e.g. a method on this view container being called by a child directive's OnDestroy
      // lifecycle hook)
      removeFromArray(getOrCreateViewRefs(this._lContainer), adjustedIdx);
      destroyLView(detachedView[TVIEW], detachedView);
    }
  }

  override detach(index?: number): ViewRef|null {
    const adjustedIdx = this._adjustIndex(index, -1);
    const view = detachView(this._lContainer, adjustedIdx);

    const wasDetached =
        view && removeFromArray(getOrCreateViewRefs(this._lContainer), adjustedIdx) != null;
    return wasDetached ? new R3ViewRef(view!) : null;
  }

  private _adjustIndex(index?: number, shift: number = 0) {
    if (index == null) {
      return this.length + shift;
    }
    if (ngDevMode) {
      assertGreaterThan(index, -1, `ViewRef index must be positive, got ${index}`);
      // +1 because it's legal to insert at the end.
      assertLessThan(index, this.length + 1 + shift, 'index');
    }
    return index;
  }
};

function hasNgNonHydratableAttr(tNode: TNode): boolean {
  // TODO: we need to iterate over `tNode.mergedAttrs` better
  // to avoid cases when `ngNonHydratable` is an attribute value,
  // e.g. `<div title="ngNonHydratable"></div>`.
  return !!tNode.mergedAttrs?.includes('ngNonHydratable');
}

function isInNonHydratableBlock(tNode: TNode, lView: LView): boolean {
  const foundTNode = navigateParentTNodes(tNode as TNode, lView, hasNgNonHydratableAttr);
  // in a block when we have a TNode and it's different than the root node
  return foundTNode !== null && foundTNode !== tNode;
}

function getViewRefs(lContainer: LContainer): ViewRef[]|null {
  return lContainer[VIEW_REFS] as ViewRef[];
}

function getOrCreateViewRefs(lContainer: LContainer): ViewRef[] {
  return (lContainer[VIEW_REFS] || (lContainer[VIEW_REFS] = [])) as ViewRef[];
}

/**
 * Creates a ViewContainerRef and stores it on the injector.
 *
 * @param ViewContainerRefToken The ViewContainerRef type
 * @param ElementRefToken The ElementRef type
 * @param hostTNode The node that is requesting a ViewContainerRef
 * @param hostLView The view to which the node belongs
 * @returns The ViewContainerRef instance to use
 */
export function createContainerRef(
    hostTNode: TElementNode|TContainerNode|TElementContainerNode,
    hostLView: LView): ViewContainerRef {
  ngDevMode && assertTNodeType(hostTNode, TNodeType.AnyContainer | TNodeType.AnyRNode);

  let lContainer: LContainer;
  let nghContainer: NghContainer;
  let dehydratedViews: NghView[] = [];
  const ngh = hostLView[HYDRATION_INFO];
  const isCreating = !ngh || isInNonHydratableBlock(hostTNode, hostLView) ||
      isNodeDisconnected(ngh, hostTNode.index - HEADER_OFFSET);
  if (!isCreating) {
    const index = hostTNode.index - HEADER_OFFSET;
    nghContainer = ngh.containers[index];
    ngDevMode &&
        assertDefined(nghContainer, 'There is no hydration info available for this container');
  }

  const slotValue = hostLView[hostTNode.index];
  if (isLContainer(slotValue)) {
    // If the host is a container, we don't need to create a new LContainer
    lContainer = slotValue;
  } else {
    let commentNode: RComment;
    // If the host is an element container, the native host element is guaranteed to be a
    // comment and we can reuse that comment as anchor element for the new LContainer.
    // The comment node in question is already part of the DOM structure so we don't need to append
    // it again.
    if (hostTNode.type & TNodeType.ElementContainer) {
      commentNode = unwrapRNode(slotValue) as RComment;
      if (!isCreating && nghContainer! && Array.isArray(nghContainer.dehydratedViews)) {
        // When we create an LContainer based on `<ng-container>`, the container
        // is already processed, including dehydrated views info. Reuse this info
        // and erase it in the ngh data to avoid memory leaks.
        dehydratedViews = nghContainer.dehydratedViews!;
        nghContainer.dehydratedViews = [];
      }
    } else {
      if (!isCreating) {
        // Start with a node that immediately follows the DOM node found
        // in an LView slot. This node is:
        // - either an anchor comment node of this container if it's empty
        // - or a first element of the first view in this container
        let currentRNode = (unwrapRNode(slotValue) as RNode).nextSibling;
        // TODO: Add assert that the currentRNode exists
        const [anchorRNode, views] = locateDehydratedViewsInContainer(currentRNode!, nghContainer!);

        commentNode = anchorRNode as RComment;
        dehydratedViews = views;

        ngDevMode &&
            assertRComment(commentNode, 'Expecting a comment node in template instruction');
        ngDevMode && markRNodeAsClaimedForHydration(commentNode);
      } else {
        // If the host is a regular element, we have to insert a comment node manually which will
        // be used as an anchor when inserting elements. In this specific case we use low-level DOM
        // manipulation to insert it.
        const renderer = hostLView[RENDERER];
        ngDevMode && ngDevMode.rendererCreateComment++;
        commentNode = renderer.createComment(ngDevMode ? 'container' : '');

        const hostNative = getNativeByTNode(hostTNode, hostLView)!;
        const parentOfHostNative = nativeParentNode(renderer, hostNative);
        nativeInsertBefore(
            renderer, parentOfHostNative!, commentNode, nativeNextSibling(renderer, hostNative),
            false);
      }
    }

    hostLView[hostTNode.index] = lContainer =
        createLContainer(slotValue, hostLView, commentNode, hostTNode);

    if (ngh && dehydratedViews.length > 0) {
      lContainer[DEHYDRATED_VIEWS] = dehydratedViews;
    }

    addToViewTree(hostLView, lContainer);
  }

  return new R3ViewContainerRef(lContainer, hostTNode, hostLView);
}

function findMatchingDehydratedView(lContainer: LContainer, template: string): NghView|null {
  let hydrationInfo: NghView|null = null;
  if (lContainer !== null && lContainer[DEHYDRATED_VIEWS]) {
    // Does the target container have a view?
    const dehydratedViews = lContainer[DEHYDRATED_VIEWS];
    if (dehydratedViews.length > 0) {
      // TODO: take into account an index of a view within ViewContainerRef,
      // otherwise, we may end up reusing wrong nodes from live DOM?
      const dehydratedViewIndex = dehydratedViews.findIndex(view => view.template === template);

      if (dehydratedViewIndex > -1) {
        hydrationInfo = dehydratedViews[dehydratedViewIndex];

        // Drop this view from the list of de-hydrated ones.
        dehydratedViews.splice(dehydratedViewIndex, 1);
      }
    }
  }
  return hydrationInfo;
}
