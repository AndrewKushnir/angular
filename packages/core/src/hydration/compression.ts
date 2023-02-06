/**
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */

import {NghDom} from './interfaces';
import {LightJSON} from './light_json';
import {NodeNavigationStep, REFERENCE_NODE_BODY, REFERENCE_NODE_HOST} from './node_lookup_utils';

/**
 * Helper function that takes a reference node location and a set of navigation steps
 * (from the reference node) to a target node and outputs a string that represents
 * a location.
 *
 * For example, given: referenceNode = 'b' (body) and path = ['firstChild', 'firstChild',
 * 'nextSibling'], the function returns: `bf2n`.
 */
export function compressNodeLocation(referenceNode: string, path: NodeNavigationStep[]): string {
  let finalPath = referenceNode;
  let currentSegment: NodeNavigationStep|null = null;
  let repeatCount = 0;
  const appendCurrentSegment = () => {
    finalPath += currentSegment! + (repeatCount > 1 ? repeatCount : '');
  };
  for (const segment of path) {
    currentSegment ??= segment;
    if (currentSegment === segment) {
      repeatCount++;
    } else {
      appendCurrentSegment();
      currentSegment = segment;
      repeatCount = 1;
    }
  }
  appendCurrentSegment();
  return finalPath;
}

function isDigit(char: string): boolean {
  return /[0-9]/.test(char);
}

/**
 * Helper function that reverts the `compressNodeLocation` and transforms a given
 * string into an array where at 0th position there is a reference node info and
 * after that it contains a set of navigation steps.
 *
 * For example, given: path = 'bf2n', the function returns: ['b', 'firstChild', 'firstChild',
 * 'nextSibling']. This information is later consumed by the code that navigates
 * the live DOM to find a given node by its location.
 */
export function decompressNodeLocation(path: string): [string|number, ...NodeNavigationStep[]] {
  let idx = 0;
  const peek = () => path[idx];
  const consume = () => path[idx++];
  const consumeRef = (): string|null =>
      (peek() === REFERENCE_NODE_BODY || peek() === REFERENCE_NODE_HOST) ? consume() : null;
  const consumeNumber = (): number|null => {
    let acc = '';
    while (peek() && isDigit(peek())) {
      acc += consume();
    }
    return acc !== '' ? parseInt(acc) : null;
  };
  let ref = consumeRef() || consumeNumber()!;
  const steps: NodeNavigationStep[] = [];
  while (idx < path.length) {
    const step = consume() as NodeNavigationStep;
    // Either consume a number or use `1` if there is no number,
    // which indicates that a given instruction should be repeated
    // only once (for ex. in cases like: `15fnfn`).
    const repeat = consumeNumber() ?? 1;
    for (let i = 0; i < repeat; i++) {
      steps.push(step);
    }
  }
  return [ref, ...steps];
}

/**
 * Compresses NGH data collected for a component and serializes
 * it into a string.
 *
 * @param ngh
 * @returns
 */
export function compressNghInfo(ngh: NghDom): string {
  return LightJSON.stringify(ngh);
}

/**
 * De-serializes NGH info retrieved from the `ngh` attribute.
 * Effectively reverts the `compressNghInfo` operation.
 *
 * @param ngh
 * @returns
 */
export function decompressNghInfo(ngh: string): NghDom {
  return LightJSON.parse(ngh);
}
