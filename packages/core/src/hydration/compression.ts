/**
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */

import {NghDom} from '../render3/interfaces/view';

/**
 * Compresses NGH data collected for a component and serializes
 * it into a string.
 *
 * @param ngh
 * @returns
 */
export function compressNghInfo(ngh: NghDom): string {
  // TODO: implement better (more compact) serialization.
  return JSON.stringify(ngh);
}

/**
 * De-serializes NGH info retrieved from the `ngh` attribute.
 * Effectively reverts the `compressNghInfo` operation.
 *
 * @param ngh
 * @returns
 */
export function decompressNghInfo(ngh: string): NghDom {
  // TODO: implement better de-serialization.
  return JSON.parse(ngh);
}
