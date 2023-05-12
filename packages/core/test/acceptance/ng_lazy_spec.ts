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

  // Placeholder...
  function PlaceholderTemplate(rf: number, ctx: unknown) {
    if (rf & 1) {
      text(0, 'Placeholder!');
    }
  }

  // Error...
  function ErrorTemplate(rf: number, ctx: unknown) {
    if (rf & 1) {
      text(0, 'Error :(');
    }
  }

  async function LazyTemplateDeps(): Promise<Array<any>> {
    return Promise.allSettled([
      new Promise((resolve) => {
        resolve(MyLazyCmp);
      }),
    ]);
  }

  async function LazyErrorTemplateDeps(): Promise<Array<any>> {
    return Promise.reject(['failed']);
    // return Promise.all([
    //   // Promise.reject(MyLazyCmp)
    //   new Promise((resolve, reject) => {
    //     reject(MyLazyCmp);
    //   }),
    // ]);

    //  Promise.all(new Promise()).then(/* ... */).catch()
  }

  fit('(compiled) should work with basic cases', async () => {
    @Component({
      selector: 'my-lazy-cmp',
      standalone: true,
      template: 'Hi!',
    })
    class MyLazyCmp {
    }

    @Component({
      standalone: true,
      selector: 'simple-app',
      imports: [MyLazyCmp],
      template: `
        {#lazy [when]="isVisible"}
          <my-lazy-cmp />
        {:loading}
          Loading...
        {:placeholder}
          Placeholder!
        {:error}
          Ooops :(
        {/#lazy}
      `
    })
    class MyCmp {
      isVisible = false;
    }

    debugger;

    const fixture = TestBed.createComponent(MyCmp);
    fixture.detectChanges();

    debugger;

    expect(fixture.nativeElement.outerHTML).toContain('Placeholder');

    fixture.componentInstance.isVisible = true;
    fixture.detectChanges();

    debugger;

    expect(fixture.nativeElement.outerHTML).toContain('Loading');

    await fixture.whenStable();
    debugger;

    setTimeout(() => {
      debugger;
      expect(fixture.nativeElement.outerHTML).toContain('<my-lazy-cmp>');
    }, 0);
  });

  it('should work with basic cases', async () => {
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
        decls: 4,
        vars: 4,
        standalone: true,
        template:
            function Template(rf: number, ctx: MyCmp) {
              if (rf & 1) {
                lazy(0, LazyTemplate, 1, 0, LazyTemplateDeps, null, 0);
                template(1, LoadingTemplate, 1, 0);
                template(2, PlaceholderTemplate, 1, 0);
                template(3, ErrorTemplate, 1, 0);
              }
              if (rf & 2) {
                property('loadingTmpl', ɵɵreference(1));
                property('placeholderTmpl', ɵɵreference(2));
                property('errorTmpl', ɵɵreference(3));
                property('when', ctx.isVisible);
              }
            },
        // TODO: this should be added elsewhere?
        dependencies: [NgLazy],
      });

      isVisible = false;
    }

    const fixture = TestBed.createComponent(MyCmp);
    fixture.detectChanges();

    debugger;

    expect(fixture.nativeElement.outerHTML).toContain('Placeholder');

    fixture.componentInstance.isVisible = true;
    fixture.detectChanges();

    debugger;

    expect(fixture.nativeElement.outerHTML).toContain('Loading');

    await fixture.whenStable();
    debugger;

    setTimeout(() => {
      debugger;
      expect(fixture.nativeElement.outerHTML).toContain('<my-lazy-cmp>');
    }, 0);
  });

  it('should work with error case', async () => {
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
        decls: 4,
        vars: 4,
        standalone: true,
        template:
            function Template(rf: number, ctx: MyCmp) {
              if (rf & 1) {
                lazy(0, LazyTemplate, 1, 0, LazyErrorTemplateDeps, null, 0);
                template(1, LoadingTemplate, 1, 0);
                template(2, PlaceholderTemplate, 1, 0);
                template(3, ErrorTemplate, 1, 0);
              }
              if (rf & 2) {
                property('loadingTmpl', ɵɵreference(1));
                property('placeholderTmpl', ɵɵreference(2));
                property('errorTmpl', ɵɵreference(3));
                property('when', ctx.isVisible);
              }
            },
        // TODO: this should be added elsewhere?
        dependencies: [NgLazy],
      });

      isVisible = false;
    }

    const fixture = TestBed.createComponent(MyCmp);
    fixture.detectChanges();

    debugger;

    expect(fixture.nativeElement.outerHTML).toContain('Placeholder');

    fixture.componentInstance.isVisible = true;
    fixture.detectChanges();

    debugger;

    expect(fixture.nativeElement.outerHTML).toContain('Loading');

    await fixture.whenStable();
    debugger;

    setTimeout(() => {
      debugger;
      expect(fixture.nativeElement.outerHTML).toContain('Error');
    }, 0);
  });
});
