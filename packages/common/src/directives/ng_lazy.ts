/**
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */

import {Directive, EmbeddedViewRef, Input, LazyTemplateRef, TemplateRef, ViewContainerRef, ɵstringify as stringify} from '@angular/core';


@Directive({
  selector: '[ngLazy]',
  standalone: true,
})
export class NgLazy {
  constructor(private vcr: ViewContainerRef, private lazyTemplate: LazyTemplateRef<unknown>) {
    // throw new Error('nglazy created');
  }

  async ngOnInit(): Promise<void> {
    const templateRef = await this.lazyTemplate.load();
    this.vcr.createEmbeddedView(templateRef);
  }
}
