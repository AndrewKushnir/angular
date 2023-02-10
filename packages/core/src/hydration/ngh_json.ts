/**
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */


/**
 * Checks if a character is within a valid token chars set, which is:
 * * a-z and A-Z
 * * 0-9
 * * `-` char
 */
function isValidTokenChar(char: string): boolean {
  return /[0-9a-zA-Z\-]/.test(char);
}

function isDigit(char: string): boolean {
  return /[0-9]/.test(char);
}

function parse<T>(input: string): T {
  let idx = 0;
  const peek = (): string => input[idx];
  const consume = (): string => input[idx++];
  const advance = () => idx++;

  const consumeToken = () => {
    let char = '';
    let onlyDigits = true;
    while (idx < input.length) {
      const next = peek();
      if (isValidTokenChar(next)) {
        if (!isDigit(next)) {
          onlyDigits = false;
        }
        char += consume();
      } else
        break;
    }
    // Check if there are only digits in a string, in which case
    // transform it from a string to a number.
    return onlyDigits && char !== '' ? parseInt(char) : char;
  };

  const consumeValue = (): any => {
    switch (peek()) {
      case '{':
        advance();  // skip over '{'
        return consumeObject();
      case '[':
        advance();  // skip over '['
        return consumeArray();
      default:
        return consumeToken();
    }
  };

  const consumeObject = () => {
    const obj: {[key: string]: unknown} = {};
    while (idx < input.length) {
      const key = consumeToken();
      if (key === '') {  // empty object?
        const next = consume();
        // TODO: make it ngDevMode-only check
        if (next !== '}') {
          throw new Error(`Ngh JSON: invalid state. Expecting '{', but got '${next}' instead.`);
        }
        break;
      }
      consume();  // ':' char
      obj[key] = consumeValue();

      // Read next char, it might be either `,` or `}`.
      // If it's `}` - exit.
      if (consume() === '}') break;
    }
    return obj;
  };
  const consumeArray = () => {
    const arr = [];
    while (idx < input.length) {
      const value = consumeValue();
      if (value !== '') {
        arr.push(value);
      }
      // Read next char, it might be either `,` or `]`.
      // If it's `]` - exit.
      if (consume() === ']') break;
    }
    return arr;
  };
  return consumeValue() as T;
}

/**
 * TODO: add docs, mention that it's *not* a general-purpose
 * utility, it's a custom implementation based on JSON structure
 * used to serialize Ngh data structures, which allows to drop
 * quotes around keys and values.
 */
export class NghJSON {
  static stringify<T>(input: T): string {
    // TODO: consider better implementation here.
    return JSON.stringify(input).replace(/"/g, '');
  }
  static parse<T>(input: string): T {
    return parse(input) as T;
  }
}