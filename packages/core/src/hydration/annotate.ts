/**
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */

import {compressHydrationKeys, decompressHydrationKeys, readHydrationKey} from './compression';
import {readPatchedHydrationKey} from './keys';

/**
 * Annotates document nodes with extra info needed for hydration on a client later.
 * This function is used on the server before serializing the document to a string.
 *
 * DOM nodes are annotated as described below:
 * - comment nodes: hydration key is inserted as a content
 * - element nodes: a new `ngh` attribute is added
 * - text nodes: a new comment node is created with a key
 *               and append this comment node after the text node
 */
export function annotateForHydration(
    doc: Document, element: Element, enableKeyCompression: boolean) {
  const visitNode = (node: any) => {
    const hydrationKey = readPatchedHydrationKey(node);
    if (hydrationKey) {
      if (node.nodeType === Node.COMMENT_NODE) {
        node.textContent = hydrationKey;
      } else if (node.nodeType === Node.ELEMENT_NODE) {
        node.setAttribute('ngh', hydrationKey);
      } else if (node.nodeType === Node.TEXT_NODE) {
        // Note: `?` is a special marker that represents a marker for a text node.
        const key = hydrationKey.replace('|', '?');
        const marker = doc.createComment(key);
        node.after(marker);
      }
    }

    let current = node.firstChild;
    while (current) {
      visitNode(current);
      current = current.nextSibling;
    }
  };
  visitNode(element);

  if (enableKeyCompression) {
    compressHydrationKeys(element);
  }
}

/**
 * Walks over DOM nodes and collects all annotated ones (see `annotateForHydration`)
 * in a registry, which is later used during the hydration process.
 */
export function collectHydratableNodes(
    node: any, registry: Map<string, Element>, enableHydrationKeyCompression: boolean): number {
  let visitedNodes = 0;
  const visitNode = (node: any) => {
    visitedNodes++;
    const nodeKey = readHydrationKey(node);
    if (nodeKey) {
      registry.set(nodeKey, node);
    }

    let current = node.firstChild;
    while (current) {
      visitNode(current);
      current = current.nextSibling;
    }
  };
  if (enableHydrationKeyCompression) {
    decompressHydrationKeys(node);
  }
  visitNode(node);

  // Return a number of visited nodes for debugging purposes.
  // TODO: consider removing once no longer needed.
  return visitedNodes;
}