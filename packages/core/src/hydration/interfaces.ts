/**
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */

export const NODES = 'n';
export const NUM_ROOT_NODES = 'r';
export const CONTAINERS = 'c';
export const TEMPLATES = 't';
export const TEMPLATE = 'i';  // as it's also an "id"
export const VIEWS = 'v';
export const MULTIPLIER = 'x';  // similar to "x10" as in 10 copies

/**
 * TODO: add docs here and for each field.
 */
export interface NghDom {
  [NODES]?: Record<number, string>;
  [CONTAINERS]?: Record<number, NghContainer>;
  [TEMPLATES]?: Record<number, string>;
}

/**
 * TODO: add docs here and for each field.
 */
export interface NghContainer {
  [VIEWS]?: NghView[];

  // Describes the number of top level nodes in this element container.
  // Only for element containers, i.e. <ng-container>.
  [NUM_ROOT_NODES]?: number;
}

/**
 * TODO: add docs here and for each field.
 */
export interface NghView extends NghDom {
  [TEMPLATE]: string;
  [NUM_ROOT_NODES]: number;
  [MULTIPLIER]?: number;
}

export interface NghDomInstance {
  data: Readonly<NghDom>;
  firstChild?: HTMLElement;
  elementContainers?: {[index: number]: NghContainerInstance};
}

export interface NghContainerInstance {
  data: Readonly<NghContainer>;

  // First node in this element container.
  firstChild: HTMLElement;

  // In some situations (see `createContainerRef`), dehydrated views
  // are discovered early in the process, so we need to store them
  // temporarily here and access later when creating a ViewContainerRef.
  dehydratedViews?: NghViewInstance[];
}

export interface NghViewInstance extends NghDomInstance {
  data: Readonly<NghView>;
}