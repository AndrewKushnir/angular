/**
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */

import {DOCUMENT, ɵgetDOM as getDOM} from '@angular/common';
import {APP_ID, Inject, Injectable} from '@angular/core';
import {ɵSharedStylesHost as SharedStylesHost} from '@angular/platform-browser';

@Injectable()
export class ServerStylesHost extends SharedStylesHost {
  private head: any = null;
  private _styleNodes = new Set<HTMLElement>();

  constructor(@Inject(DOCUMENT) private doc: any, @Inject(APP_ID) private appId: string) {
    super();
    this.head = doc.getElementsByTagName('head')[0];
  }

  private _addStyle(style: string): void {
    let adapter = getDOM();
    const el = adapter.createElement('style');
    el.textContent = style;
    if (!!this.appId) {
      el.setAttribute('ng-transition', this.appId);
    }
    this.head.appendChild(el);
    this._styleNodes.add(el);
  }

  override onStylesAdded(additions: Set<string>) {
    additions.forEach(style => this._addStyle(style));
  }

  ngOnDestroy() {
    this._styleNodes.forEach(styleNode => styleNode.remove());
  }
}
