export enum NodeNavigationStep {
  FirstChild,
  NextSibling,
}

/**
 * Generate a list of DOM navigation operations to get from node `start` to node `finish`.
 *
 * Note: assumes that node `start` occurs before node `finish` in an in-order traversal of the DOM
 * tree. That is, we should be able to get from `start` to `finish` purely by using `.firstChild`
 * and `.nextSibling` operations.
 */
export function navigateBetween(start: Node, finish: Node): NodeNavigationStep[] {
  if (start === finish) {
    return [];
  } else if (start.parentElement == null || finish.parentElement == null) {
    // throw new Error(`Ran off the top of the document when navigating between nodes`);
    console.log(
        'Ran off the top of the document when navigating between nodes',
        (start as any).tagName ?? start.nodeType, (finish as any).tagName ?? finish.nodeType);
    return [];
  } else if (start.parentElement === finish.parentElement) {
    return navigateBetweenSiblings(start, finish);
  } else {
    // `finish` is a child of its parent, so the parent will always have a child.
    const parent = finish.parentElement!;
    return [
      // First navigate to `finish`'s parent.
      ...navigateBetween(start, parent),
      // Then to its first child.
      NodeNavigationStep.FirstChild,
      // And finally from that node to `finish` (maybe a no-op if we're already there).
      ...navigateBetween(parent.firstChild!, finish),
    ];
  }
}

function navigateBetweenSiblings(start: Node, finish: Node): NodeNavigationStep[] {
  const nav: NodeNavigationStep[] = [];
  let node: Node|null = null;
  for (node = start; node != null && node !== finish; node = node.nextSibling) {
    nav.push(NodeNavigationStep.NextSibling);
  }
  if (node === null) {
    // throw new Error(`Is finish before start? Hit end of siblings before finding start`);
    console.log(`Is finish before start? Hit end of siblings before finding start`);
    return [];
  }
  return nav;
}
