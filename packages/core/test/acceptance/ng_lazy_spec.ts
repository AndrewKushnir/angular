/**
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */

import {Component, ɵɵadvance as advance, ɵɵreference, ɵɵproperty as property, ɵɵdefineComponent as defineComponent, ɵɵtemplate as template, ɵɵelement as element, ɵɵdeferredTemplate as deferredTemplate, ɵɵtext as text, ɵɵdeferWhen as deferWhen, Type} from '@angular/core';
import {TestBed} from '@angular/core/testing';

describe('#defer', () => {
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

  function LazyTemplateDeps(): Array<Promise<Type<unknown>>> {
    return [
      new Promise((resolve) => {
        resolve(MyLazyCmp);
      }),
    ];
  }

  function LazyErrorTemplateDeps(): Array<Promise<Type<unknown>>> {
    return [Promise.reject(['failed'])];
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
        {#defer when isVisible; on idle}
          <my-lazy-cmp />
        {:loading}
          Loading...
        {:placeholder}
          Placeholder!
        {:error}
          Ooops :(
        {/defer}
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

  it('(runtime only) should work with basic cases', async () => {
    /**
     * {#lazy}
     *   <my-lazy-cmp />
     * {:loading}
     *   Loading...
     * {:placeholder}
     *   Placeholder.
     * {:error}
     *   Error :(
     * {/lazy}
     */
    class MyCmp {
      static ɵfac = () => new MyCmp();
      static ɵcmp = defineComponent({
        selectors: [['my-cmp']],
        consts: [],
        type: MyCmp,
        decls: 4,
        vars: 1,
        standalone: true,
        template:
            function Template(rf: number, ctx: MyCmp) {
              if (rf & 1) {
                template(0, LoadingTemplate, 1, 0);
                template(1, PlaceholderTemplate, 1, 0);
                template(2, ErrorTemplate, 1, 0);
                deferredTemplate(3, LazyTemplate, LazyTemplateDeps, 1, 1, 0, 1, 2);
              }
              if (rf & 2) {
                advance(3);
                deferWhen(ctx.isVisible);
              }
            }
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
     * {/lazy}
     */
    class MyCmp {
      static ɵfac = () => new MyCmp();
      static ɵcmp = defineComponent({
        selectors: [['my-cmp']],
        consts: [],
        type: MyCmp,
        decls: 4,
        vars: 4,
        standalone: true,
        template:
            function Template(rf: number, ctx: MyCmp) {
              if (rf & 1) {
                deferredTemplate(0, LazyTemplate, LazyErrorTemplateDeps, 1, 0, null, 0);
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
