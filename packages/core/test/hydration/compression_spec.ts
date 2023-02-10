/**
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */

import {compressNodeLocation, decompressNodeLocation} from '../../src/hydration/compression';
import {NghJSON} from '../../src/hydration/ngh_json';
import {NodeNavigationStep, REFERENCE_NODE_BODY, REFERENCE_NODE_HOST} from '../../src/hydration/node_lookup_utils';

describe('compression of node location', () => {
  it('should handle basic cases', () => {
    const fc = NodeNavigationStep.FirstChild;
    const ns = NodeNavigationStep.NextSibling;
    const cases = [
      [[REFERENCE_NODE_HOST, fc], 'hf'],
      [[REFERENCE_NODE_BODY, fc], 'bf'],
      [[0, fc], '0f'],
      [[15, fc], '15f'],
      [[15, fc, fc, fc, fc], '15f4'],
      [[5, fc, fc, fc, fc, ns, fc], '5f4nf'],
      [[7, ns, ns, ns, ns, fc, ns], '7n4fn'],
    ];
    cases.forEach((_case) => {
      const [steps, path] = _case as [string[], string];
      const refNode = steps.shift()!;
      // Check that one type can be converted to another and vice versa.
      expect(compressNodeLocation(refNode, steps as NodeNavigationStep[])).toEqual(path);
      expect(decompressNodeLocation(path)).toEqual([refNode, ...steps]);
    });
  });
});

// TODO: add more tests!
describe('LightJSON', () => {
  it('should parse simple objects', () => {
    const input = '{i:4,v:[1,2,3]}';
    const output = NghJSON.parse(input);
    expect(output).toEqual({i: 4, v: [1, 2, 3]});
  });

  it('should allow dashes at token value positions', () => {
    const input = '{i:my-cmp,v:[1,2,3]}';
    debugger;
    const output = NghJSON.parse(input);
    expect(output).toEqual({i: 'my-cmp', v: [1, 2, 3]});
  });
});