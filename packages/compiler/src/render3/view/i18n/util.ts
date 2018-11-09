/**
 * @license
 * Copyright Google Inc. All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */

import * as i18n from '../../../i18n/i18n_ast';
import {toPublicName} from '../../../i18n/serializers/xmb';
import * as html from '../../../ml_parser/ast';
import {mapLiteral} from '../../../output/map_util';
import * as o from '../../../output/output_ast';


/* Closure variables holding messages must be named `MSG_[A-Z0-9]+` */
const TRANSLATION_PREFIX = 'MSG_';

/** Closure uses `goog.getMsg(message)` to lookup translations */
const GOOG_GET_MSG = 'goog.getMsg';

/** String key that is used to provide backup id of translatable message in Closure */
const BACKUP_MESSAGE_ID = 'BACKUP_MESSAGE_ID';

/** Regexp to identify whether backup id already provided in description */
const BACKUP_MESSAGE_ID_REGEXP = new RegExp(BACKUP_MESSAGE_ID);

/** I18n separators for metadata **/
const I18N_MEANING_SEPARATOR = '|';
const I18N_ID_SEPARATOR = '@@';

/** Name of the i18n attributes **/
export const I18N_ATTR = 'i18n';
export const I18N_ATTR_PREFIX = 'i18n-';

/** Prefix of var expressions used in ICUs */
export const I18N_ICU_VAR_PREFIX = 'VAR_';

/** Prefix of ICU expressions for post processing */
export const I18N_ICU_MAPPING_PREFIX = 'I18N_EXP_';

/** Placeholder wrapper for i18n expressions **/
export const I18N_PLACEHOLDER_SYMBOL = '�';

export type I18nMeta = {
  id?: string,
  description?: string,
  meaning?: string
};

function i18nTranslationToDeclStmt(
    variable: o.ReadVarExpr, message: string,
    params?: {[name: string]: o.Expression}): o.DeclareVarStmt {
  const args = [o.literal(message) as o.Expression];
  if (params && Object.keys(params).length) {
    args.push(mapLiteral(params));
  }
  const fnCall = o.variable(GOOG_GET_MSG).callFn(args);
  return variable.set(fnCall).toDeclStmt(o.INFERRED_TYPE, [o.StmtModifier.Final]);
}

// Converts i18n meta informations for a message (id, description, meaning)
// to a JsDoc statement formatted as expected by the Closure compiler.
function i18nMetaToDocStmt(meta: I18nMeta): o.JSDocCommentStmt|null {
  const tags: o.JSDocTag[] = [];
  const {id, description, meaning} = meta;
  if (id || description) {
    const hasBackupId = !!description && BACKUP_MESSAGE_ID_REGEXP.test(description);
    const text =
        id && !hasBackupId ? `[${BACKUP_MESSAGE_ID}:${id}] ${description || ''}` : description;
    tags.push({tagName: o.JSDocTagName.Desc, text: text !.trim()});
  }
  if (meaning) {
    tags.push({tagName: o.JSDocTagName.Meaning, text: meaning});
  }
  return tags.length == 0 ? null : new o.JSDocCommentStmt(tags);
}

export function isI18nAttribute(name: string): boolean {
  return name === I18N_ATTR || name.startsWith(I18N_ATTR_PREFIX);
}

export function isI18nRootNode(meta?: i18n.AST): meta is i18n.Message {
  return meta instanceof i18n.Message;
}

export function isSingleI18nIcu(meta?: i18n.AST): boolean {
  return isI18nRootNode(meta) && meta.nodes.length === 1 && meta.nodes[0] instanceof i18n.Icu;
}

export function hasI18nAttrs(element: html.Element): boolean {
  return element.attrs.some((attr: html.Attribute) => isI18nAttribute(attr.name));
}

export function metaFromI18nMessage(message: i18n.Message): I18nMeta {
  return {
    id: message.id || '',
    meaning: message.meaning || '',
    description: message.description || ''
  };
}

export function icuFromI18nMessage(message: i18n.Message) {
  return message.nodes[0] as i18n.IcuPlaceholder;
}

export function wrapI18nPlaceholder(content: string | number, contextId: number = 0): string {
  const blockId = contextId > 0 ? `:${contextId}` : '';
  return `${I18N_PLACEHOLDER_SYMBOL}${content}${blockId}${I18N_PLACEHOLDER_SYMBOL}`;
}

export function assembleI18nBoundString(
    strings: string[], bindingStartIndex: number = 0, contextId: number = 0): string {
  if (!strings.length) return '';
  let acc = '';
  const lastIdx = strings.length - 1;
  for (let i = 0; i < lastIdx; i++) {
    acc += `${strings[i]}${wrapI18nPlaceholder(bindingStartIndex + i, contextId)}`;
  }
  acc += strings[lastIdx];
  return acc;
}

export function getSeqNumberGenerator(startsAt: number = 0): () => number {
  let current = startsAt;
  return () => current++;
}

export function placeholdersToParams(placeholders: Map<string, string[]>):
    {[name: string]: o.Expression} {
  const params: {[name: string]: o.Expression} = {};
  placeholders.forEach((values: string[], key: string) => {
    params[key] = o.literal(values.length > 1 ? `[${values.join('|')}]` : values[0]);
  });
  return params;
}

export function updatePlaceholderMap(map: Map<string, any[]>, name: string, ...values: any[]) {
  const current = map.get(name) || [];
  current.push(...values);
  map.set(name, current);
}

export function assembleBoundTextPlaceholders(
    meta: i18n.AST, bindingStartIndex: number = 0, contextId: number = 0): Map<string, any[]> {
  const startIdx = bindingStartIndex;
  const placeholders = new Map<string, any>();
  const node =
      meta instanceof i18n.Message ? meta.nodes.find(node => node instanceof i18n.Container) : meta;
  if (node) {
    (node as i18n.Container)
        .children.filter((child: i18n.Node) => child instanceof i18n.Placeholder)
        .forEach((child: i18n.Placeholder, idx: number) => {
          const content = wrapI18nPlaceholder(startIdx + idx, contextId);
          updatePlaceholderMap(placeholders, child.name, content);
        });
  }
  return placeholders;
}

/**
 * Parses i18n metas like:
 *  - "@@id",
 *  - "description[@@id]",
 *  - "meaning|description[@@id]"
 * and returns an object with parsed output.
 *
 * @param meta String that represents i18n meta
 * @returns Object with id, meaning and description fields
 */
export function parseI18nMeta(meta?: string): I18nMeta {
  let id: string|undefined;
  let meaning: string|undefined;
  let description: string|undefined;

  if (meta) {
    const idIndex = meta.indexOf(I18N_ID_SEPARATOR);
    const descIndex = meta.indexOf(I18N_MEANING_SEPARATOR);
    let meaningAndDesc: string;
    [meaningAndDesc, id] =
        (idIndex > -1) ? [meta.slice(0, idIndex), meta.slice(idIndex + 2)] : [meta, ''];
    [meaning, description] = (descIndex > -1) ?
        [meaningAndDesc.slice(0, descIndex), meaningAndDesc.slice(descIndex + 1)] :
        ['', meaningAndDesc];
  }

  return {id, meaning, description};
}

/**
 * Converts internal placeholder names to public-facing format
 * (for example to use in goog.getMsg call).
 * Example: `START_TAG_DIV_1` is converted to `startTagDiv_1`.
 *
 * @param name The placeholder name that should be formatted
 * @returns Formatted placeholder name
 */
export function formatI18nPlaceholderName(name: string): string {
  const chunks = toPublicName(name).split('_');
  if (chunks.length === 1) {
    // if no "_" found - just lowercase the value
    return name.toLowerCase();
  }
  let postfix;
  // eject last element if it's a number
  if (/^\d+$/.test(chunks[chunks.length - 1])) {
    postfix = chunks.pop();
  }
  let raw = chunks.shift() !.toLowerCase();
  if (chunks.length) {
    raw += chunks.map(c => c.charAt(0).toUpperCase() + c.slice(1).toLowerCase()).join('');
  }
  return postfix ? `${raw}_${postfix}` : raw;
}

export function getTranslationConstPrefix(fileBasedSuffix: string): string {
  return `${TRANSLATION_PREFIX}${fileBasedSuffix}`.toUpperCase();
}

/**
 * Generates translation declaration statements.
 *
 * @param variable Translation value reference
 * @param message Text message to be translated
 * @param meta Object that contains meta information (id, meaning and description)
 * @param params Object with placeholders key-value pairs
 * @param transformFn Optional transformation (post processing) function reference
 * @returns Array of Statements that represent a given translation
 */
export function getTranslationDeclStmts(
    variable: o.ReadVarExpr, message: string, meta: I18nMeta,
    params: {[name: string]: o.Expression} = {},
    transformFn?: (raw: o.ReadVarExpr) => o.Expression): o.Statement[] {
  const statements: o.Statement[] = [];
  const docStatements = i18nMetaToDocStmt(meta);
  if (docStatements) {
    statements.push(docStatements);
  }
  if (transformFn) {
    const raw = o.variable(`${variable.name}_RAW`);
    statements.push(i18nTranslationToDeclStmt(raw, message, params));
    statements.push(
        variable.set(transformFn(raw)).toDeclStmt(o.INFERRED_TYPE, [o.StmtModifier.Final]));
  } else {
    statements.push(i18nTranslationToDeclStmt(variable, message, params));
  }
  return statements;
}