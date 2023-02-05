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

/**
 * TODO: add docs here and for each field.
 */
export interface NghDom {
  [NODES]?: Record<number, string>;
  [CONTAINERS]?: Record<number, NghContainer>;
  [TEMPLATES]?: Record<number, string>;

  // First node in this view.
  // TODO: consider storing this info elsewhere to keep separation
  // between deserialized data from `ngh` attributes and the data
  // that is used at runtime for hydration.
  firstChild?: HTMLElement;
}

/**
 * TODO: add docs here and for each field.
 */
export interface NghContainer {
  [VIEWS]?: NghView[];

  // Describes the number of top level nodes in this container.
  // Only applicable to <ng-container>s.
  //
  // TODO: consider moving this info elsewhere to avoid confusion
  // between view containers (<div *ngIf>) and element containers
  // (<ng-container>s).
  [NUM_ROOT_NODES]?: number;

  // First node in this container. This is applicable to
  // <ng-container> only.
  //
  // TODO: consider moving this info elsewhere to avoid confusion
  // between view containers (<div *ngIf>) and element containers
  // (<ng-container>s).
  firstChild?: HTMLElement;

  // In some situations (see `createContainerRef`), dehydrated views
  // are discovered early in the process, so we need to store them
  // temporarily here and access later when creating a ViewContainerRef.
  dehydratedViews?: NghView[];
}

/**
 * TODO: add docs here and for each field.
 */
export interface NghView extends NghDom {
  [TEMPLATE]: string;
  [NUM_ROOT_NODES]: number;

  // First node in this view.
  // TODO: consider storing this info elsewhere to keep separation
  // between deserialized data from `ngh` attributes and the data
  // that is used at runtime for hydration.
  firstChild?: HTMLElement;
}
