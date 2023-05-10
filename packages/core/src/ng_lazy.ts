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
import {createTemplateRef} from './linker/template_ref';
import {ViewContainerRef} from './linker/view_container_ref';
import {ɵɵdefineDirective} from './render3';
import {PARENT, T_HOST} from './render3/interfaces/view';

export class NgLazy {
  static ɵfac = () => new NgLazy();
  static ɵdir = /*@__PURE__*/ ɵɵdefineDirective({
    type: NgLazy,
    selectors: [['', 'ngLazy', '']],
    standalone: true,
    inputs: {
      loadingTmpl: 'loadingTmpl',
      placeholderTmpl: 'placeholderTmpl',
      errorTmpl: 'errorTmpl',
      when: 'when',
    },
  });

  private vcr = inject(ViewContainerRef);
  private lazyTemplate = inject(LazyTemplateRef);

  // @Input() Loading template ref input
  loadingTmpl?: any;      // TemplateRef<unknown>;
  placeholderTmpl?: any;  // TemplateRef<unknown>;
  errorTmpl?: any;        // TemplateRef<unknown>;
  when: boolean = false;  // when condition

  private previousWhen: boolean|null = null;

  constructor() {
    debugger;
    console.log('NgLazy created');
  }

  // TODO: find a better place for this logic...
  ngOnChanges() {
    debugger;
    if (this.previousWhen === null && this.when === false) {
      // Show placeholder...
      const placeholderTNode = this.placeholderTmpl[T_HOST];
      const placeholderLView = this.placeholderTmpl[PARENT];
      const placeholderTmplRef = createTemplateRef(placeholderTNode, placeholderLView);
      this.vcr.clear();
      this.vcr.createEmbeddedView(placeholderTmplRef!);

      this.previousWhen = this.when;
    } else if (this.previousWhen === false && this.when === true) {
      // show loading
      const loadingTNode = this.loadingTmpl[T_HOST];
      const loadingLView = this.loadingTmpl[PARENT];
      const loadingTmplRef = createTemplateRef(loadingTNode, loadingLView);
      this.vcr.clear();
      this.vcr.createEmbeddedView(loadingTmplRef!);
      debugger;

      this.lazyTemplate.load()
          .then(templateRef => {
            debugger;
            // Show actual content once everything is loaded...
            this.vcr.clear();
            this.vcr.createEmbeddedView(templateRef);
          })
          .catch(() => {
            const errorTNode = this.errorTmpl[T_HOST];
            const errorLView = this.errorTmpl[PARENT];
            const errorTmplRef = createTemplateRef(errorTNode, errorLView);
            this.vcr.clear();
            this.vcr.createEmbeddedView(errorTmplRef!);
          });
      this.previousWhen = this.when;
    }

    // TODO: consider doing this for some cases in
    // https://developer.mozilla.org/en-US/docs/Web/API/Window/requestIdleCallback.
    // const templateRef = await this.lazyTemplate.load();
    // this.vcr.createEmbeddedView(templateRef);
  }
}
