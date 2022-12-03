/**
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */

import {Renderer2, RendererStyleFlags2} from '@angular/core';

import {global} from '../src/util/global';

import {getCurrentHydrationKey} from './render3/state';

const NG_DEV_MODE = typeof ngDevMode === 'undefined' || !!ngDevMode;

export interface HydrationState {
  inDeoptMode: boolean;
  isRegistryPopulated: boolean;
  registry: Map<string, Element>;  // registry of all annotated elements found on a page
  debug: {[key: string]: any};     // debug info collected during the invocation
}

export interface HydrationConfig {
  isStrictMode: boolean;
}

interface HydrationDebugInfo {
  lastSeenRenderer?: Renderer2|null;
  registry?: Map<any, any>;
  visitedNodes?: number;
  hydratedNodes?: number;
  annotatedNodes?: number;
  root?: any;
  initializedRenderersCount?: number;
}

function assertNodeType(node: any, nodeType: number, key: string) {
  // TODO: improve error messages to make them more developer-friendly.
  if (!node) {
    throw new Error(`No node with the '${key}' key found in DOM.`);
  }

  if (node.nodeType !== nodeType) {
    const map: any = {
      1: 'ELEMENT_NODE',
      3: 'TEXT_NODE',
      8: 'COMMENT_NODE',
    };
    throw new Error(
        `Unexpected node type for key ${key}! ` +
        `Expected ${map[nodeType] || nodeType}, ` +
        `but got ${map[node.nodeType] || node.nodeType}.`);
  }
}

function initDebugInfo(registry: Map<string, Element>) {
  return {
    lastSeenRenderer: null,
    registry,
    visitedNodes: 0,
    hydratedNodes: 0,
    annotatedNodes: 0,
    initializedRenderersCount: 0,
  };
}

/**
 * Renderer that is invoked when an application hydrates after
 * being rendered on the server side. Once the hydration is completed,
 * this renderer just proxies calls to the regular DOM renderer.
 *
 * TODO: use `RuntimeError` for errors.
 */
export class HydrationRenderer {
  data: any = {};
  destroyNode = null;
  private root?: Element;  // root element reference

  /**
   * Debugging information collected during the renderer execution.
   * Use a single debug object instance for all initialized renderers.
   */
  private debug: HydrationDebugInfo = (global as any).__ngHydrationRendererDebug__;

  constructor(
      private document: any, private state: HydrationState, private config: HydrationConfig,
      private delegate: Renderer2) {
    if (NG_DEV_MODE) {
      if (!(global as any).__ngHydrationRendererDebug__) {
        // Expose globally for testing purposes.
        (global as any).__ngHydrationRendererDebug__ = this.debug = initDebugInfo(this.registry);
      }
      this.debug.lastSeenRenderer = this;
      this.debug.initializedRenderersCount!++;
    }
  }

  destroy(): void {}

  createElement(name: string, namespace?: string): any {
    let element;
    const key = getCurrentHydrationKey();

    if (!key || this.state.inDeoptMode || !(element = this.extractFromRegistry(key))) {
      return this.delegate.createElement(name, namespace);
    }

    if (element.nodeType !== Node.ELEMENT_NODE ||
        element.tagName.toLowerCase() !== name.toLowerCase()) {
      // We found an element based on the annotation, but the
      // element is wrong, thus entering the deopt mode.
      this.enterDeoptMode(key);

      return this.delegate.createElement(name, namespace);
    } else {
      this.markAsHydrated(element);

      // The `ngh` attribute was only needed to transfer hydration data
      // over the wire. It has no utility once an app hydrates.
      element.removeAttribute('ngh');

      return element;
    }
  }

  createComment(value: string): any {
    let comment;
    const key = getCurrentHydrationKey();

    if (!key || this.state.inDeoptMode || !(comment = this.extractFromRegistry(key))) {
      return this.delegate.createComment(value);
    }

    if (comment.nodeType !== Node.COMMENT_NODE) {
      // We found an element based on the annotation, but the
      // element is wrong, thus entering the deopt mode.
      this.enterDeoptMode(key);

      return this.delegate.createComment(value);
    } else {
      this.markAsHydrated(comment);

      return comment;
    }
  }

  createText(value: string): any {
    let marker;
    const key = (getCurrentHydrationKey() ?? '').replace('|', '?');

    if (!key || this.state.inDeoptMode || !(marker = this.extractFromRegistry(key))) {
      return this.delegate.createText(value);
    }

    // TODO: handle i18n case!

    if (marker.nodeType !== Node.COMMENT_NODE) {
      // We found an element based on the annotation, but the
      // element is wrong, thus entering the deopt mode.
      this.enterDeoptMode(key);

      return this.delegate.createText(value);
    } else {
      let textNode = marker.previousSibling;
      if (!textNode && value === '') {
        // We found a marker, but there is no text node in front of it.
        // This is likely due to the serialization where empty text nodes
        // are not present in an HTML, i.e. `<div><!23?1></div>`.
        // In this case - just create a text node using delegate renderer.
        textNode = this.delegate.createText(value);
      } else {
        NG_DEV_MODE && assertNodeType(textNode, Node.TEXT_NODE, key);
        this.markAsHydrated(textNode);
      }

      // This marker was only needed to carry over info
      // over the wire, it has no utility once app hydrates.
      marker.remove();

      return textNode;
    }
  }

  appendChild(parent: any, newChild: any): void {
    if (newChild.__skipInsertion) {
      // Reset the flag for future operations if needed.
      newChild.__skipInsertion = false;
      return;
    }

    return this.delegate.appendChild(parent, newChild);
  }

  insertBefore(parent: any, newChild: any, refChild: any): void {
    if (newChild.__skipInsertion) {
      // Reset the flag for future operations if needed.
      newChild.__skipInsertion = false;
      return;
    }

    return this.delegate.insertBefore(parent, newChild, refChild);
  }

  removeChild(parent: any, oldChild: any): void {
    return this.delegate.removeChild(parent, oldChild);
  }

  // TODO: we should delegate here at some point.
  selectRootElement(selectorOrNode: string|any): any {
    let element: any;
    if (typeof selectorOrNode === 'string') {
      element = this.document.querySelector(selectorOrNode);
      if (!element) {
        throw new Error(`The selector "${selectorOrNode}" did not match any elements`);
      }
    } else {
      element = selectorOrNode;
    }
    this.root = element;
    if (NG_DEV_MODE) {
      this.debug.root = element;
    }
    this.markAsHydrated(element);
    this.populateNodeRegistry();
    return element;
  }


  private get registry() {
    return this.state.registry;
  }

  /**
   * Switches the renderer to the deopt mode:
   *  - stores the flag in a global state
   *  - removes all annotated DOM nodes, so they are re-created
   *    by the runtime logic from scratch (thus "deopt")
   */
  private enterDeoptMode(key: string) {
    this.state.inDeoptMode = true;
    if (this.config.isStrictMode) {
      throw new Error(`Hydration renderer was unable to find proper node for key ${key}.`);
    }
    console.warn(`Entering deoptimized hydration mode starting from node with key: ${key}.`);
    this.registry.forEach((node, key) => {
      if (key.indexOf('?') > -1) {  // this is a marker node
        const textNode = node.previousSibling;
        textNode?.remove();
      }
      node.remove();
    });
    this.registry.clear();
  }

  /**
   * Marks a node as "hydrated" or visited during
   * the hydration process.
   */
  private markAsHydrated(node: any) {
    if (NG_DEV_MODE) {
      // Indicate that this node was processed
      // by the hydration logic, so we can verify
      // that we visited all nodes in tests.
      node.__hydrated = true;
    }
    node.__skipInsertion = true;
  }

  /**
   * Retrieves an entry from the node registry and removes a reference
   * from the registry. One element should be mapped just once, removing
   * it from the registry ensures no memory leaks.
   */
  private extractFromRegistry(key: string) {
    const node = this.registry.get(key);
    if (NG_DEV_MODE && node) {
      this.debug.hydratedNodes!++;
    }
    this.registry.delete(key);
    return node;
  }

  /**
   * Goes over the DOM structure to find and extract
   * nodes that were annotated during the SSR process.
   */
  private populateNodeRegistry() {
    if (this.state.isRegistryPopulated) {
      // The registry is already populated, exit.
      return;
    }

    this.state.isRegistryPopulated = true;

    NG_DEV_MODE && console.time('HydrationRenderer.populateNodeRegistry');

    let visitedNodes = 0;
    const visitNode = (node: any) => {
      visitedNodes++;
      let key;
      if (node.nodeType === Node.COMMENT_NODE) {
        key = node.textContent;
      } else if (node.nodeType === Node.ELEMENT_NODE) {
        key = node.getAttribute('ngh');
      }
      if (key) {
        this.registry.set(key, node);
      }

      let current = node.firstChild;
      while (current) {
        visitNode(current);
        current = current.nextSibling;
      }
    };
    visitNode(this.root);

    if (NG_DEV_MODE) {
      console.timeEnd('HydrationRenderer.populateNodeRegistry');
      this.debug.visitedNodes = visitedNodes;
      this.debug.annotatedNodes = this.registry.size;
    }
  }

  parentNode(node: any): any {
    return this.delegate.parentNode(node);
  }

  nextSibling(node: any): any {
    return this.delegate.nextSibling(node);
  }

  setAttribute(el: any, name: string, value: string, namespace?: string): void {
    return this.delegate.setAttribute(el, name, value, namespace);
  }

  removeAttribute(el: any, name: string, namespace?: string): void {
    return this.delegate.removeAttribute(el, name, namespace);
  }

  addClass(el: any, name: string): void {
    return this.delegate.addClass(el, name);
  }

  removeClass(el: any, name: string): void {
    return this.delegate.removeClass(el, name);
  }

  setStyle(el: any, style: string, value: any, flags: RendererStyleFlags2): void {
    return this.delegate.setStyle(el, style, value, flags);
  }

  removeStyle(el: any, style: string, flags: RendererStyleFlags2): void {
    return this.delegate.removeStyle(el, style, flags);
  }

  setProperty(el: any, name: string, value: any): void {
    return this.delegate.setProperty(el, name, value);
  }

  setValue(node: any, value: string): void {
    return this.delegate.setValue(node, value);
  }

  listen(
      target: 'document'|'window'|'body'|any, eventName: string,
      callback: (event: any) => boolean): () => void {
    return this.delegate.listen(target, eventName, callback);
  }
}
