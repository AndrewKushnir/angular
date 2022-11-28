/**
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */

import {DOCUMENT, ɵgetDOM as getDOM} from '@angular/common';
import {APP_ID, Inject, Injectable, OnDestroy} from '@angular/core';

@Injectable()
export class SharedStylesHost {
  /** @internal */
  protected _stylesSet = new Set<string>();

  addStyles(styles: string[]): void {
    const additions = new Set<string>();
    styles.forEach(style => {
      if (!this._stylesSet.has(style)) {
        this._stylesSet.add(style);
        additions.add(style);
      }
    });
    this.onStylesAdded(additions);
  }

  onStylesAdded(additions: Set<string>): void {}

  getAllStyles(): string[] {
    return Array.from(this._stylesSet);
  }
}

@Injectable()
export class DomSharedStylesHost extends SharedStylesHost implements OnDestroy {
  // Maps all registered host nodes to a list of style nodes that have been added to the host node.
  private _hostNodes = new Map<Node, Node[]>();
  private _styleNodesInDOM: Map<string, HTMLStyleElement>|undefined;

  constructor(@Inject(DOCUMENT) private doc: Document, @Inject(APP_ID) private appId: string) {
    super();

    this.collectServerRenderedStyles();
    this._hostNodes.set(this.doc.head, []);
  }

  private _addStylesToHost(styles: Set<string>, host: Node, styleNodes: Node[]): void {
    for (const style of styles) {
      const styleEl = this._createStyleElement(host, style);
      styleNodes.push(host.appendChild(styleEl));
    }
  }

  private collectServerRenderedStyles(): void {
    const styles: NodeListOf<HTMLStyleElement>|undefined =
        this.doc.head?.querySelectorAll(`style[ng-transition="${this.appId}"]`);

    if (styles?.length) {
      const styleMap = new Map<string, HTMLStyleElement>();

      styles.forEach(style => {
        if (style.textContent != null) {
          styleMap.set(style.textContent, style);
        }
      });

      this._styleNodesInDOM = styleMap;
    }
  }

  private _createStyleElement(host: Node, style: string): HTMLStyleElement {
    const styleEl = this._styleNodesInDOM?.get(style);
    if (styleEl?.parentNode === host) {
      // `this._styleNodesInDOM` cannot be undefined due to the above `this._styleNodesInDOM?.get`.
      this._styleNodesInDOM!.delete(style);
      styleEl.removeAttribute('ng-transition');

      if (typeof ngDevMode === 'undefined' || ngDevMode) {
        // This attribute is soley used for debugging purposes.
        styleEl.setAttribute('ng-style-reused', '');
      }

      return styleEl;
    } else {
      const styleEl = this.doc.createElement('style');
      styleEl.textContent = style;

      return host.appendChild(styleEl);
    }
  }

  addHost(hostNode: Node): void {
    const styleNodes: Node[] = [];
    this._addStylesToHost(this._stylesSet, hostNode, styleNodes);
    this._hostNodes.set(hostNode, styleNodes);
  }

  removeHost(hostNode: Node): void {
    const styleNodes = this._hostNodes.get(hostNode);
    styleNodes?.forEach(removeStyle);
    this._hostNodes.delete(hostNode);
  }

  override onStylesAdded(additions: Set<string>): void {
    this._hostNodes.forEach((styleNodes, hostNode) => {
      this._addStylesToHost(additions, hostNode, styleNodes);
    });
  }

  ngOnDestroy(): void {
    this._hostNodes.forEach(styleNodes => styleNodes.forEach(removeStyle));
    if (this._styleNodesInDOM) {
      this._styleNodesInDOM.forEach(e => e.remove());
      this._styleNodesInDOM.clear();
    }
  }
}

function removeStyle(styleNode: Node): void {
  getDOM().remove(styleNode);
}
