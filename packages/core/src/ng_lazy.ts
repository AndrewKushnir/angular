/**
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */

// import {Directive, Input, LazyTemplateRef, TemplateRef, ViewContainerRef, ɵstringify as
// stringify} from '@angular/core';

import {inject} from './di/injector_compatibility';
import {LazyTemplateRef, TemplateRef} from './linker';
import {ViewContainerRef} from './linker/view_container_ref';
import {ɵɵdefineDirective} from './render3';

export class NgLazy {
  static ɵfac = () => new NgLazy();
  static ɵdir = /*@__PURE__*/ ɵɵdefineDirective({
    type: NgLazy,
    selectors: [['', 'ngLazy', '']],
    standalone: true,
    inputs: {loadingTmpl: 'loadingTmpl'},
  });

  private vcr = inject(ViewContainerRef);
  private lazyTemplate = inject(LazyTemplateRef);

  // @Input() Loading template ref input
  loadingTmpl?: TemplateRef<unknown>;

  constructor() {
    debugger;
    console.log('NgLazy created');
  }

  async ngOnInit(): Promise<void> {
    debugger;
    const templateRef = await this.lazyTemplate.load();
    this.vcr.createEmbeddedView(templateRef);
  }
}
