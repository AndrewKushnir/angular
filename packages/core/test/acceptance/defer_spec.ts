/**
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */

import {ɵsetEnabledBlockTypes as setEnabledBlockTypes} from '@angular/compiler/src/jit_compiler_facade';
import {Component} from '@angular/core';
import {TestBed} from '@angular/core/testing';

describe('#defer', () => {
  beforeEach(() => setEnabledBlockTypes(['defer']));
  afterEach(() => setEnabledBlockTypes([]));

  fit('should work with basic cases', async () => {
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
        {#defer when isVisible}
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

    const fixture = TestBed.createComponent(MyCmp);
    fixture.detectChanges();

    expect(fixture.nativeElement.outerHTML).toContain('Placeholder');

    fixture.componentInstance.isVisible = true;
    fixture.detectChanges();

    expect(fixture.nativeElement.outerHTML).toContain('Loading');

    await fixture.whenStable();

    expect(fixture.nativeElement.outerHTML).toContain('<my-lazy-cmp>Hi!</my-lazy-cmp>');
  });
});
