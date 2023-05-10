/**
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */

import {Component, ɵɵtemplateRefExtractor, ɵɵreference, ɵɵproperty as property, ɵɵdefineComponent as defineComponent, ɵɵtemplate as template, ɵɵelement as element, ɵɵlazy as lazy, ɵɵtext as text} from '@angular/core';
import {TestBed} from '@angular/core/testing';

import {NgLazy} from '../../src/ng_lazy';

describe('ngLazy directive', () => {
  fit('should work with basic cases', async () => {
    @Component({
      selector: 'my-lazy-cmp',
      standalone: true,
      template: 'Hi!',
    })
    class MyLazyCmp {
    }

    // <my-lazy-cmp />
    function LazyTemplate(rf: number, ctx: unknown) {
      if (rf & 1) {
        element(0, 'my-lazy-cmp');
      }
    }

    // Loading...
    function LoadingTemplate(rf: number, ctx: unknown) {
      if (rf & 1) {
        text(0, 'Loading...');
      }
    }

    async function LazyTemplateDeps(): Promise<Array<any>> {
      return [
        MyLazyCmp,
      ];
    }

    /**
     * {#lazy}
     *   <my-lazy-cmp />
     * {:loading}
     *   Loading...
     * {/#lazy}
     */
    class MyCmp {
      static ɵfac = () => new MyCmp();
      static ɵcmp = defineComponent({
        selectors: [['my-cmp']],
        consts: [[4 as any, 'ngLazy']],
        type: MyCmp,
        decls: 2,
        vars: 0,
        standalone: true,
        template:
            function Template(rf: number, ctx: MyCmp) {
              if (rf & 1) {
                lazy(0, LazyTemplate, LazyTemplateDeps, 1, 0, null, 0);
                template(1, LoadingTemplate, 1, 0);
              }
              if (rf & 2) {
                property('loadingTmpl', ɵɵreference(1));
              }
            },
        // TODO: this should be added elsewhere?
        dependencies: [NgLazy],
      });
    }

    const fixture = TestBed.createComponent(MyCmp);
    fixture.detectChanges();

    await fixture.whenStable();
    // flush()?

    fail(fixture.nativeElement.outerHTML);
  });
});
