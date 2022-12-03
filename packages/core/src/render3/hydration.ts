/**
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */

import {TNode} from './interfaces/node';
import {HEADER_OFFSET, HYDRATION_KEY, LView} from './interfaces/view';

const VIEW_SEPARATOR = ':';
const ELEMENT_SEPARATOR = '|';

const PATCHED_HYDRATION_KEY = '__ngh__';

/**
 * Generates a string that represents a key that is used during the hydration
 * to find a reference to a particular DOM element.
 */
function getHydrationKey(
    lView: LView<unknown>, instructionIndex: number|string, separator: string): string {
  return `${lView[HYDRATION_KEY]}${separator}${instructionIndex}`;
}

export function getElementHydrationKey(lView: LView<unknown>, elementId: number|string) {
  return getHydrationKey(lView, elementId, ELEMENT_SEPARATOR);
}

export function getViewHydrationKey(lView: LView<unknown>, viewLocation: number|string) {
  return getHydrationKey(lView, viewLocation, VIEW_SEPARATOR);
}

/**
 * Constructs a hydration key for a view within a ViewContainerRef.
 */
export function getViewContainerHydrationKey(
    hostLView: LView, hostTNode: TNode, viewIndex: number) {
  const elementIndex = hostTNode.index - HEADER_OFFSET;
  // Keep a view id within the same segment (between `:` symbols)
  // of the hydration key, i.e. `r0:1+0:9`.
  const key = elementIndex + '+' + viewIndex;
  return getViewHydrationKey(hostLView, key);
}


/**
 * Special case for a comment node that is inserted as a marker for a view container:
 * this node needs to have an id that is different from the host node itself,
 * so that it's uniquely identified in a generated HTML during server side rendering.
 */
export function getViewContainerMarkerHydrationKey(hostLView: LView, hostTNode: TNode): string {
  return getElementHydrationKey(hostLView, `vcr${hostTNode.index - HEADER_OFFSET}`);
}

/**
 * Monkey-patches extra info needed for hydration onto a native element.
 */
export function patchHydrationKey(native: any, hydrationKey: string) {
  (native as any)[PATCHED_HYDRATION_KEY] = hydrationKey;
}

/**
 * Reads monkey-patched hydration key from a native element.
 */
export function readHydrationKey(native: any): string|null {
  return (native as any)[PATCHED_HYDRATION_KEY] ?? null;
}
