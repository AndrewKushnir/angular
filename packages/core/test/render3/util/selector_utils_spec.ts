/**
 * @license
 * Copyright Google Inc. All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */

import {CssSelectorList} from '@angular/core/src/render3/interfaces/projection';
import {r3SelectorListToString} from '@angular/core/src/render3/util/selector_utils';


describe('selector_utils', () => {
  it('r3SelectorListToString', () => {
    const cases = [
      // element selectors
      [[['div', '', '']], 'div'],                       //
      [[['div', 'attr', '']], 'div[attr]'],             //
      [[['div', 'attr', 'value']], 'div[attr=value]'],  //

      // TODO: add attribute selectors
      // TODO: class selectors
      // TODO: `:not` selectors
      // TODO: mixed cases
    ];
    cases.forEach(
        ([r3Selector, stringSelector]) =>
            expect(r3SelectorListToString(r3Selector as CssSelectorList))
                .toEqual(stringSelector as string));
  });
});