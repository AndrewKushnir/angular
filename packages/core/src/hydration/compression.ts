/**
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */

export function readHydrationKey(node: any): string|null {
  if (node.nodeType === Node.COMMENT_NODE) {
    return node.textContent;
  } else if (node.nodeType === Node.ELEMENT_NODE) {
    return node.getAttribute('ngh');
  }
  return null;
}

/**
 * Compresses hydration keys to avoid repeating long strings,
 * and only append the delta at each level.
 *
 * NOTE: this logic should eventually be folded into
 * the `annotateForHydration` function, so that there is no
 * extra DOM walk, but keep it separate for now for profiling
 * and debugging purposes.
 *
 * TODO:
 * - move all inner functions outside of the `compressHydrationKeys` fn.
 */
export function compressHydrationKeys(root: Element) {
  /* Returns: [viewSegments, elementId, isTextMarker] */
  type ParsedHydrationKey =
      [string[] /* viewSegments */, string /* elementId */, boolean /* isTextMarker */];
  const parseKey = (key: string): ParsedHydrationKey => {
    const isTextMarker = key.indexOf('?') > -1;
    const delim = isTextMarker ? '?' : '|';
    const parts = key.split(delim);
    const elementId = parts.pop()!;
    const viewSegments = parts.pop()!.split(':');
    return [viewSegments, elementId, isTextMarker];
  };
  const computeTransformCommand = (parent: string[], child: string[]) => {
    let diffStartsAt = parent.length === child.length ?  //
        -1 :
        Math.min(parent.length, child.length);
    let i = 0;
    let rmCommand = '';
    while (i < parent.length && i < child.length) {
      if (parent[i] !== child[i]) {
        diffStartsAt = i;
        break;
      }
      i++;
    }
    if (diffStartsAt === -1) {
      // No difference in keys, return an empty array.
      return [];
    } else {
      // Starting from the diff point, until the end of the parent
      // segments, add `d` as an indicator that one segment should
      // be dropped (thus "d"). The following number indicated the number
      // of segments to be dropped. If there is just one segment (most
      // common case), just `d` is printed. Otherwise, the value would
      // look like `d5` (drop 5 segments).
      const segmentsToDrop = parent.length - diffStartsAt;
      if (segmentsToDrop > 0) {
        rmCommand = 'd' + (segmentsToDrop > 1 ? segmentsToDrop : '');
      }
      const command = rmCommand || 'a';  // 'a' stands for "append"
      return [command, ...child.slice(diffStartsAt)];
    }
  };
  const makeHydrationKey =
      (viewSegments: string[], elementId: string, isTextMarker: boolean): string => {
        return viewSegments.join(':') + (isTextMarker ? '?' : '|') + elementId;
      };

  const visitNode = (parentKey: ParsedHydrationKey, node: any) => {
    let parsedNodeKey: ParsedHydrationKey|null = null;
    const nodeKey = readHydrationKey(node);
    if (nodeKey) {
      parsedNodeKey = parseKey(nodeKey);
      const [viewSegments, elementId, isTextMarker] = parsedNodeKey;
      // We have both node and current keys, compute transform command
      // (between view segments only).
      const newViewSegments = computeTransformCommand(parentKey[0], viewSegments);
      const newKey = makeHydrationKey(newViewSegments, elementId, isTextMarker);
      if (node.nodeType === Node.COMMENT_NODE) {
        node.textContent = newKey;
      } else {  // Node.ELEMENT_NODE
        node.setAttribute('ngh', newKey);
      }
    }

    let childNode = node.firstChild;
    while (childNode) {
      // If the current node doesn't have its own key,
      // use parent node key instead, so that child key
      // is computed based on it.
      visitNode(parsedNodeKey ?? parentKey, childNode);
      childNode = childNode.nextSibling;
    }
  };

  // Start the process for all child nodes of the root node.
  if (root.childNodes.length > 0) {
    const rootKey = parseKey(readHydrationKey(root)!);
    root.childNodes.forEach((child: any) => {
      visitNode(rootKey, child);
    });
  }
}

/**
 * Visits all child nodes of a given node and restores
 * full hydration keys for each node based on parent node
 * hydration keys. Effectively reverts the `compressHydrationKeys`
 * operation.
 *
 * TODO: merge this logic into `populateNodeRegistry` eventually
 *       (keep it separate for now for testing purposes).
 */
export function decompressHydrationKeys(node: any) {
  const visitNode = (node: any, parentViewKey: string) => {
    const nodeKey = readHydrationKey(node);
    let nodeViewKey: string|null = null;
    if (nodeKey) {
      const parts = nodeKey.split(/[|?]/g);
      nodeViewKey = parts[0];
      // TODO: handle `dN` ("delete N segments") commands.
      if (nodeViewKey.startsWith('a')) {
        // Command to add a segment, drop leading 'a'.
        nodeViewKey = nodeViewKey.slice(1);
      }
      nodeViewKey = parentViewKey + nodeViewKey;

      const separator = nodeKey.indexOf('|') > -1 ? '|' : '?';
      const newKey = nodeViewKey + separator + parts[1];
      if (node.nodeType === Node.COMMENT_NODE) {
        node.textContent = newKey;
      } else {  // Node.ELEMENT_NODE
        node.setAttribute('ngh', newKey);
      }
    }

    let childNode = node.firstChild;
    while (childNode) {
      visitNode(childNode, nodeViewKey ?? parentViewKey);
      childNode = childNode.nextSibling;
    }
  };
  const parentKey = readHydrationKey(node);
  if (parentKey) {
    // Take everything before '|' or '?' symbols.
    const parentViewKey = parentKey.split(/[|?]/g)[0];
    if (node.childNodes.length > 0) {
      node.childNodes.forEach((child: any) => {
        visitNode(child, parentViewKey);
      });
    }
  }
}
