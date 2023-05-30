/**
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */

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
      loading: 'loading',
      placeholder: 'placeholder',
      error: 'error',
      when: 'when',
    },
  });

  private vcr = inject(ViewContainerRef);
  private lazyTemplate = inject(LazyTemplateRef);

  // @Input()
  loading?: any;  // should be: TemplateRef<unknown>;
  // @Input()
  placeholder?: any;  // should be: TemplateRef<unknown>;
  // @Input()
  error?: any;  // should be:  TemplateRef<unknown>;
  // @Input()
  when: boolean = false;  // when condition

  private previousWhen: boolean|null = null;

  constructor() {
    debugger;
    console.log('NgLazy created');
  }

  private renderEmbeddedView(input: any) {
    // FIXME: accessing tNode and lView here should *not* be needed,
    // we should receive the `TemplateRef` as an input. TODO: update
    // the generated code to make it happen.
    const tNode = input[T_HOST];
    const lView = input[PARENT];
    const templateRef = createTemplateRef(tNode, lView)!;
    this.vcr.clear();
    this.vcr.createEmbeddedView(templateRef);
  }

  ngOnChanges() {
    debugger;
    if (this.previousWhen === null && this.when === false) {
      if (this.placeholder) {
        this.renderEmbeddedView(this.placeholder);
      }

      this.previousWhen = this.when;
    } else if ((this.previousWhen === false || this.previousWhen === null) && this.when === true) {
      if (this.loading) {
        this.renderEmbeddedView(this.loading);
      }

      this.lazyTemplate.load()
          .then(templateRef => {
            // Show actual content once everything is loaded...
            this.vcr.clear();
            this.vcr.createEmbeddedView(templateRef);
          })
          .catch(() => {
            if (this.error) {
              this.renderEmbeddedView(this.error);
            } else {
              // console.warn in dev mode?
            }
          });
      this.previousWhen = this.when;
    }
  }
}
