/**
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */
import {Component} from '@angular/core';
import {afterRender} from '@angular/core/src/render3/hooks';
import {TestBed} from '@angular/core/testing';

describe('after render hook', () => {
  fit('should work', () => {
    @Component({
      standalone: true,
      selector: 'app',
      template: `
        <div>Hi!</div>
      `
    })
    class App {
      constructor() {
        debugger;
        const unsub = afterRender(() => {
          console.log('afterRender!');
          debugger;
        });
      }
    }

    debugger;
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();

    debugger;
  });
});
