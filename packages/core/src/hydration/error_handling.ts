/**
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */
import {TElementNode, TNode, TNodeType} from '../render3/interfaces/node';
import {RNode} from '../render3/interfaces/renderer_dom';
import {assertEqual} from '../util/assert';

function shorten(input: string|null, maxLength = 50): string {
  if (!input) {
    return '';
  }
  return input.length > maxLength ? `${input.substring(0, maxLength - 1)}…` : input;
}

function describeActualNode(node: Node): string {
  switch (node.nodeType) {
    case Node.ELEMENT_NODE:
      const tagName = (node as HTMLElement).tagName;
      return `<${tagName.toLowerCase()}>`;
    case Node.TEXT_NODE:
      const content = node.textContent ? ` (with the "${shorten(node.textContent)}" content)` : '';
      return `a text node${content}`;
    case Node.COMMENT_NODE:
      return `a comment node (<!-- ${shorten(node.textContent ?? '')} -->)`;
    default:
      return `#node(nodeType=${node.nodeType})`;
  }
}

function describeExpectedNode(nodeType: number, tagName: string|null): string {
  switch (nodeType) {
    case Node.ELEMENT_NODE:
      return `<${tagName!.toLowerCase()}>`;
    case Node.TEXT_NODE:
      return 'a text node';
    case Node.COMMENT_NODE:
      return 'a comment node';
    default:
      // Should never happen, since we pass an expected node type
      // from instructions code.
      throw new Error(`Unexpected node type: ${nodeType}.`);
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

function stringifyNodeAttrs(node: HTMLElement): string {
  const results = [];
  for (let i = 0; i < node.attributes.length; i++) {
    const attr = node.attributes[i];
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

function describeExpectedDom(tNode: TNode, previousSiblingTNode: TNode|null): string {
  const spacer = '  ';
  let content = '';
  if (previousSiblingTNode) {
    content += spacer + '…\n';
    content += spacer + describeTNode(previousSiblingTNode) + '\n';
  }
  content += spacer + describeTNode(tNode) + `  ${AT_THIS_LOCATION}\n`;
  content += spacer + '…\n';

  const parentNode = getRElementParentTNode(tNode);
  if (parentNode) {
    content = describeTNode(parentNode, '\n' + content);
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
  content += spacer + '…\n';
  if (node.parentNode) {
    content = describeRNode(node.parentNode, '\n' + content);
  }
  return content;
}

export function validateMatchingNode(
    node: Node, nodeType: number, tagName: string|null, tNode: TNode,
    previousSiblingTNode: TNode|null): void {
  if (node.nodeType !== nodeType ||
      (node.nodeType === Node.ELEMENT_NODE &&
       (node as HTMLElement).tagName.toLowerCase() !== tagName)) {
    // TODO: use RuntimeError here instead.
    const message = `During hydration Angular expected ` +
        `${describeExpectedNode(nodeType, tagName)} but found ` +
        `${describeActualNode(node)}.\n\n`;
    const expected =
        `Angular expected this DOM:\n\n${describeExpectedDom(tNode, previousSiblingTNode)}\n\n`;
    const actual = `Actual DOM is this:\n\n${describeActualDom(node)}`;
    throw new Error(message + expected + actual);
  }
}

export function assertRComment(native: RNode, errMessage?: string) {
  assertEqual(
      (native as HTMLElement).nodeType, Node.COMMENT_NODE,
      errMessage ?? 'Expected this element to be a comment node');
}
