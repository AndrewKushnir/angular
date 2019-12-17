/**
 * @license
 * Copyright Google Inc. All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */

import {CssSelector, CssSelectorList, SelectorFlags} from '../interfaces/projection';

function isNonEmptyString(value: any): value is string {
  return typeof value === 'string' && value.length > 0;
}

function r3SelectorToString(selector: CssSelector): string {
  let result: string = '';
  if (isNonEmptyString(selector[0])) {
    result += selector[0];
  }
  if (isNonEmptyString(selector[1])) {
    // TODO: check escaping! [attr=some'value"test]
    // TODO: check for [attr=''] vs [attr]
    const value = selector[2] ? '=' + selector[2] : '';
    result += '[' + selector[1] + value + ']';
  } else if (typeof selector[1] === 'number') {
    const flags = selector[1] as number;
    if (flags & SelectorFlags.ELEMENT) {
      result += selector[2];
    }
    if (flags & SelectorFlags.ATTRIBUTE) {
      const value = selector[3] ? '=' + selector[3] : '';
      result += '[' + selector[2] + value + ']';
    }
    if (flags & SelectorFlags.CLASS) {
      for (let i = 2; i < selector.length; i++) {
        result += '.' + selector[i];
      }
    }
    if (flags & SelectorFlags.NOT) {
      result = ':not(' + result + ')';
    }
  }
  return result;
}

export function r3SelectorListToString(selectors: CssSelectorList): string {
  return selectors.map(r3SelectorToString).join(',');
}