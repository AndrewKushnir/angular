/**
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */

import {CommonModule, NgIf, NgLazy, ɵgetDOM as getDOM} from '@angular/common';
import {Component, ɵɵdefineComponent as defineComponent, ɵɵelement as element, ɵɵlazy as lazy} from '@angular/core';
import {ComponentFixture, TestBed, waitForAsync} from '@angular/core/testing';
import {By} from '@angular/platform-browser/src/dom/debug/by';
import {expect} from '@angular/platform-browser/testing/src/matchers';

describe('ngLazy directive', () => {
  fit('should be really cool', async () => {
    @Component({
      selector: 'my-lazy-cmp',
      standalone: true,
      template: 'Hi!',
    })
    class MyLazyCmp {
    }

    function LazyTemplate(rf: number, ctx: unknown) {
      if (rf & 1) {
        element(0, 'my-lazy-cmp');
      }
    }

    async function LazyTemplateDeps(): Promise<Array<any>> {
      return [
        MyLazyCmp,
      ];
    }

    /**
     * <my-lazy-cmp *ngLazy />
     */
    class MyCmp {
      static ɵfac = () => new MyCmp();
      static ɵcmp = defineComponent({
        selectors: [['my-cmp']],
        consts: [[4 as any, 'ngLazy']],
        type: MyCmp,
        decls: 1,
        vars: 0,
        standalone: true,
        template:
            function Template(rf: number, ctx: MyCmp) {
              if (rf & 1) {
                lazy(0, LazyTemplate, LazyTemplateDeps, 1, 0, null, 0);
              }
              if (rf & 2) {
              }
            },
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
