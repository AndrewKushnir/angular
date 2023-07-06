/**
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */

import * as chars from './chars';
import {Lexer, Token, TokenType} from './expression_parser/lexer';
import {Parser} from './expression_parser/parser';
import {DeferConditionKind, DeferredTemplateCondition} from './render3/r3_ast';

const map: {[key: string]: DeferConditionKind} = {
  'idle': DeferConditionKind.OnIdle,
  'immediate': DeferConditionKind.OnImmediate,
  'interaction': DeferConditionKind.OnInteraction,
  'viewport': DeferConditionKind.OnViewport,
  'timer': DeferConditionKind.OnTimer,
  'hover': DeferConditionKind.OnHover,
  'after': DeferConditionKind.After,
  'minimum': DeferConditionKind.Minimum,
  'timeout': DeferConditionKind.Timeout,
};

function getKindByValue(value: string): DeferConditionKind {
  const kind = map[value];
  if (!kind) {
    // TODO: improve this error.
    throw new Error(`Unrecognized "on" trigger: ${value}.`);
  }
  return kind;
}

// TODO: add docs!
export class DeferConditionParser {
  private index = 0;
  private conditions: DeferredTemplateCondition[] = [];

  constructor(private input: Token[]) {}

  private hasTokens(): boolean {
    return this.index < this.input.length;
  }

  private advance() {
    this.index++;
  }

  private peek() {
    return this.input[this.index];
  }

  private atComma(): boolean {
    return this.atCharacter(chars.$COMMA);
  }

  private atCharacter(char: number): boolean {
    const current = this.peek();
    return current.type === TokenType.Character && current.numValue === char;
  }

  private atIdentifier(name?: string): boolean {
    const current = this.peek();
    return current.type === TokenType.Identifier && (name ? current.strValue === name : true);
  }

  private atNumber(): boolean {
    return this.peek().type === TokenType.Number;
  }

  private handleWhenCondition() {
    this.advance();  // `when` keyword
    // The rest of the tokens after `when` is directly consumable
    // by the expression parser, create a slice of tokens array and
    // pass it over to the expression parser.
    const lexer = new Lexer();
    const parser = new Parser(lexer);
    const tokens = this.input.slice(this.index);
    // TODO: fix arguments (provide real values).
    const ast = parser.parseBindingFromTokens(tokens, '', '', 0);
    this.conditions.push(new DeferredTemplateCondition(DeferConditionKind.When, ast, null!));
  }

  private readValue(): number|string {
    if (this.atIdentifier()) {
      const value = this.peek().strValue;  // Use ref as a value.
      this.advance();                      // Read the ref itself
      return value;
    } else if (this.atNumber()) {
      // Reading time-based value, e.g. `100ms`
      let value = this.peek().numValue;
      this.advance();
      const unit = this.peek().strValue;
      this.advance();
      if (unit === 's') {
        value *= 1000;
      } else if (unit === 'ms') {
        // noop
      } else {
        // TODO: improve this error.
        throw new Error(`Unexpected token: ${this.peek()}`);
      }
      return value;
    } else {
      // TODO: improve this error.
      throw new Error(`Unexpected token: ${this.peek()}`);
    }
  }

  private handleOnCondition() {
    this.advance();  // `on` keyword
    while (this.hasTokens()) {
      const token = this.peek();
      const kind = getKindByValue(token.strValue);
      this.advance();
      let value = null;

      if (this.hasTokens() && this.atCharacter(chars.$LPAREN)) {
        // Consume a call like `viewport(btn)`
        this.advance();            // `(`
        value = this.readValue();  // Read the value itself
        this.advance();            // `)`
      }
      if (this.hasTokens() && this.atComma()) {
        this.advance();  // Read `,`
      }
      // TODO: fix source spans!
      this.conditions.push(new DeferredTemplateCondition(kind, value, null!));
    }
  }

  private handleTimeBasedCondition() {
    const token = this.peek();

    const kind = getKindByValue(token.strValue);
    this.advance();

    const value = this.readValue();
    this.conditions.push(new DeferredTemplateCondition(kind, value, null!));
  }

  private handlePrefetchCondition() {
    this.advance();  // `prefetch` keyword

    // TODO: implement this function!
  }

  parse(): DeferredTemplateCondition[] {
    if (this.atIdentifier('when')) {
      this.handleWhenCondition();
    } else if (this.atIdentifier('on')) {
      this.handleOnCondition();
    } else if (this.atIdentifier('prefetch')) {
      this.handlePrefetchCondition();
    } else if (
        this.atIdentifier('after') || this.atIdentifier('minimum') ||
        this.atIdentifier('timeout')) {
      this.handleTimeBasedCondition();
    } else {
      // TODO: improve this error.
      throw new Error(`Unrecognized token: ${this.peek()}`)
    }
    return this.conditions;
  }
}