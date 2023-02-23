/**
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */

import {getDeclarationComponentDef} from '../render3/instructions/element_validation';
import {TElementNode, TNode, TNodeType} from '../render3/interfaces/node';
import {HOST, LView} from '../render3/interfaces/view';

import {NodeNavigationStep} from './node_lookup_utils';

function stripNewlines(input: string): string {
  return input.replace(/\s+/gm, '');
}

function shorten(input: string|null, maxLength = 50): string {
  if (!input) {
    return '';
  }
  input = stripNewlines(input);
  return input.length > maxLength ? `${input.substring(0, maxLength - 1)}…` : input;
}

function shortRNodeDescription(
    nodeType: number, tagName: string|null, textContent: string|null): string {
  switch (nodeType) {
    case Node.ELEMENT_NODE:
      return `<${tagName!.toLowerCase()}>`;
    case Node.TEXT_NODE:
      const content = textContent ? ` (with the "${shorten(textContent)}" content)` : '';
      return `a text node${content}`;
    case Node.COMMENT_NODE:
      return 'a comment node';
    default:
      return `#node(nodeType=${nodeType})`;
  }
}

const AT_THIS_LOCATION = '<-- AT THIS LOCATION';

function stringifyTNodeAttrs(tNode: TNode): string {
  const results = [];
  if (tNode.attrs) {
    for (let i = 0; i < tNode.attrs.length;) {
      const attrName = tNode.attrs[i++];
      // Once we reach the first flag, we know that the list of
      // attributes is over.
      if (typeof attrName == 'number') {
        break;
      }
      const attrValue = tNode.attrs[i++];
      results.push(`${attrName}="${shorten(attrValue as string)}"`);
    }
  }
  return results.join(' ');
}

/**
 * The list of internal attributes that should be filtered out while
 * producing an error message.
 */
const internalAttrs = new Set(['ngh', 'ng-version', 'ng-server-context']);

function stringifyNodeAttrs(node: HTMLElement): string {
  const results = [];
  for (let i = 0; i < node.attributes.length; i++) {
    const attr = node.attributes[i];
    if (internalAttrs.has(attr.name)) continue;
    results.push(`${attr.name}="${shorten(attr.value)}"`);
  }
  return results.join(' ');
}

const TNODE_TYPE_TO_STRING: {[key: number]: string} = {
  [TNodeType.Container]: 'view container',
  [TNodeType.Element]: 'element',
  [TNodeType.ElementContainer]: 'ng-container',
  [TNodeType.Icu]: 'icu',
  [TNodeType.Placeholder]: 'i18n',
  [TNodeType.Projection]: 'projection',
  [TNodeType.Text]: 'text'
};

function describeTNode(tNode: TNode, innerContent: string = '…'): string {
  switch (tNode.type) {
    case TNodeType.Text:
      const content = tNode.value ? `(${tNode.value})` : '';
      return `#text${content}`;
    case TNodeType.Element:
      const attrs = stringifyTNodeAttrs(tNode);
      const tag = tNode.value.toLowerCase();
      return `<${tag}${attrs ? ' ' + attrs : ''}>${innerContent}</${tag}>`;
    case TNodeType.ElementContainer:
      return '<!-- ng-container -->';
    case TNodeType.Container:
      return '<!-- container -->';
    default:
      const typeAsString = TNODE_TYPE_TO_STRING[tNode.type];
      return `#node(${typeAsString})`;
  }
}

function describeRNode(node: Node, innerContent: string = '…'): string {
  switch (node.nodeType) {
    case Node.ELEMENT_NODE:
      const tag = (node as HTMLElement).tagName!.toLowerCase();
      const attrs = stringifyNodeAttrs(node as HTMLElement);
      return `<${tag}${attrs ? ' ' + attrs : ''}>${innerContent}</${tag}>`;
    case Node.TEXT_NODE:
      const content = node.textContent ? shorten(node.textContent) : '';
      return `#text${content ? `(${content})` : ''}`;
    case Node.COMMENT_NODE:
      return `<!-- ${shorten(node.textContent ?? '')} -->`;
    default:
      return `#node(${node.nodeType})`;
  }
}

function getRElementParentTNode(tNode: TNode): TElementNode|null {
  // TODO: take the info below into account.
  // parentTNode might be:
  // - TNodeType.Element <-- (we have a tag name)
  // - TNodeType.ElementContainer (<ng-container> case) <-- (we have an anchor comment node)
  // <ng-container>Text</ng-container> -> Text <!-- container -->, we may still need to find a first
  // non-container parent node.
  return tNode.parent! as TElementNode;
}

function describeExpectedDom(lView: LView, tNode: TNode, isViewContainerAnchor: boolean): string {
  const spacer = '  ';
  let content = '';
  if (tNode.prev) {
    content += spacer + '…\n';
    content += spacer + describeTNode(tNode.prev) + '\n';
  } else if (tNode.type & TNodeType.AnyContainer) {
    content += spacer + '…\n';
  }
  if (isViewContainerAnchor) {
    content += spacer + describeTNode(tNode) + '\n';
    content += spacer + `<!-- container -->  ${AT_THIS_LOCATION}\n`;
  } else {
    content += spacer + describeTNode(tNode) + `  ${AT_THIS_LOCATION}\n`;
  }
  content += spacer + '…\n';

  const parentNode = getRElementParentTNode(tNode);
  if (parentNode) {
    content = describeTNode(parentNode, '\n' + content);
  } else {
    // If no parent node found using TNode tree, this node is a root one
    // in that component, so we can use a host node instead.
    content = describeRNode(lView[HOST] as unknown as Node, '\n' + content);
  }
  return content;
}

function describeActualDom(node: Node): string {
  const spacer = '  ';
  let content = '';
  if (node.previousSibling) {
    content += spacer + '…\n';
    content += spacer + describeRNode(node.previousSibling) + '\n';
  }
  content += spacer + describeRNode(node) + `  ${AT_THIS_LOCATION}\n`;
  if (node.nextSibling) {
    content += spacer + '…\n';
  }
  if (node.parentNode) {
    content = describeRNode(node.parentNode, '\n' + content);
  }
  return content;
}

function getHydrationErrorFooter(componentClassName?: string) {
  const componentInfo = componentClassName ? `the "${componentClassName}"` : 'corresponding';
  return `To fix this problem:\n` +
      `  * check ${componentInfo} component for hydration-related issues\n` +
      `  * or skip hydration by adding the \`ngSkipHydration\` attribute ` +
      `to its host node in a template`;
}

export function validateMatchingNode(
    node: Node, nodeType: number, tagName: string|null, lView: LView, tNode: TNode,
    isViewContainerAnchor = false): void {
  if (node.nodeType !== nodeType ||
      (node.nodeType === Node.ELEMENT_NODE &&
       (node as HTMLElement).tagName.toLowerCase() !== tagName)) {
    const expectedNode = shortRNodeDescription(nodeType, tagName, null);
    const actualNode = shortRNodeDescription(
        node.nodeType, (node as HTMLElement).tagName ?? null,
        (node as HTMLElement).textContent ?? null);
    const header = `During hydration Angular expected ` +
        `${expectedNode} but found ${actualNode}.\n\n`;
    const expected = `Angular expected this DOM:\n\n${
        describeExpectedDom(lView, tNode, isViewContainerAnchor)}\n\n`;
    const actual = `Actual DOM is:\n\n${describeActualDom(node)}\n\n`;

    const hostComponentDef = getDeclarationComponentDef(lView);
    const componentClassName = hostComponentDef?.type?.name;
    const footer = getHydrationErrorFooter(componentClassName);

    // TODO: use RuntimeError instead.
    throw new Error(header + expected + actual + footer);
  }
}

export function validateSiblingNodeExists(node: Node): void {
  if (!node.nextSibling) {
    const header = 'During hydration Angular expected more sibling nodes to be present.\n\n';
    const actual = `Actual DOM is:\n\n${describeActualDom(node)}\n\n`;
    const footer = getHydrationErrorFooter();

    // TODO: use RuntimeError instead.
    throw new Error(header + actual + footer);
  }
}

export function nodeNotFoundError(lView: LView, tNode: TNode): Error {
  const header = 'During serialization, Angular was unable to find an element in the DOM:\n\n';
  const expected = `${describeExpectedDom(lView, tNode, false)}\n\n`;
  const footer = getHydrationErrorFooter();

  // TODO: use RuntimeError instead.
  return new Error(header + expected + footer);
}

function stringifyPath(path: NodeNavigationStep[]): string {
  let container = [];
  for (const op of path) {
    container.push(op === NodeNavigationStep.FirstChild ? 'firstChild' : 'nextSibling');
  }
  return container.join('.');
}

export function nodeNotFoundAtPathError(host: Node, path: NodeNavigationStep[]): Error {
  const header = `During hydration Angular was unable to locate a node ` +
      `using the "${stringifyPath(path)}" path, starting from the ${describeRNode(host)} node.\n\n`;
  const footer = getHydrationErrorFooter();

  // TODO: use RuntimeError instead.
  return new Error(header + footer);
}
