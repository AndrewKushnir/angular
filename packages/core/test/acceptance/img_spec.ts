/**
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */

import {Component, Directive, Input} from '@angular/core';
import {TestBed} from '@angular/core/testing';

@Directive({
  selector: 'img',
  host: {'[src]': 'getRewrittenSrc()'},
})
class ImgDirective {
  private _src: string = '';

  @Input()
  set src(value: string) {
    console.log(`ImgDirective: @Input.set('src', '${value}')`);
    this._src = value;
  }
  get src(): string {
    return this._src;
  }

  constructor() {
    console.log('ImgDirective: constructor()');
  }

  getRewrittenSrc() {
    const rewritten = 'rewritten-' + this._src;
    console.log(`ImgDirective: @HostBinding('src', '${rewritten}')`);
    return rewritten;
  }

  ngOnChanges(changes: any) {
    console.log('ImgDirective: ngOnChanges()');
  }

  ngOnInit() {
    console.log('ImgDirective: ngOnInit()');
  }
}

fdescribe('image optimization', () => {
  it('static case', () => {
    @Component({template: '<img src="img.png">'})
    class MyComp {
      src = 'img.png';
    }

    console.log('\n\n Starting test for a static case...');
    TestBed.configureTestingModule({declarations: [MyComp, ImgDirective]});
    const fixture = TestBed.createComponent(MyComp);
    fixture.detectChanges();

    // change `src`, trigger change detection
    fixture.componentInstance.src = 'another-img.png';
    fixture.detectChanges();
  });

  it('binding case', () => {
    @Component({template: '<img [src]="src">'})
    class MyComp {
      src = 'img.png';
    }

    console.log('\n\n Starting test for a binding case...');
    TestBed.configureTestingModule({declarations: [MyComp, ImgDirective]});
    const fixture = TestBed.createComponent(MyComp);
    fixture.detectChanges();

    // change `src`, trigger change detection
    fixture.componentInstance.src = 'another-img.png';
    fixture.detectChanges();
  });
});
