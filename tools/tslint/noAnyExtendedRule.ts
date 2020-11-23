/**
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */

import {readFileSync} from 'fs';
import * as Lint from 'tslint';
import * as ts from 'typescript';

type AllowList = {
  [fileName: string]: number
};

export class Rule extends Lint.Rules.AbstractRule {
  public static metadata: Lint.IRuleMetadata = {
    ruleName: 'no-any-extended',
    description: 'Disallows usages of `any` as a type declaration.',
    hasFix: false,
    rationale: 'TBD',
    optionsDescription: 'TBD',
    options: {
      type: 'string',
    },
    type: 'typescript',
    typescriptOnly: true,
  };

  public static FAILURE_STRING =
      'Type declaration of \'any\' loses type-safety. Consider replacing it with a more precise type.';

  public apply(sourceFile: ts.SourceFile): Lint.RuleFailure[] {
    // TODO: optimize and calc just once?
    // TODO: throw if no config provided?
    const configFilePath = this.getOptions().ruleArguments[0];
    const config = this.readConfig(configFilePath);
    const maxAnyCount = config[sourceFile.fileName] || 0;
    return this.applyWithFunction(sourceFile, createWalkFn(maxAnyCount));
  }

  private config: AllowList|null = null;

  private readConfig(configFilePath: string): AllowList {
    if (this.config === null) {
      // read config from filesystem
      // TODO: see how to handle relative path based on the project root dir?
      // TODO: paths on windows?
      const config = JSON.parse(readFileSync(configFilePath, 'utf8'));
      this.config = config;
    }
    return this.config;
  }
}

function createWalkFn(maxAnyCount: number): (ctx: Lint.WalkContext) => void {
  return function(ctx: Lint.WalkContext) {
    let count = 0;
    return ts.forEachChild(ctx.sourceFile, function cb(node: ts.Node): void {
      if (node.kind === ts.SyntaxKind.AnyKeyword) {
        count++;
        if (count > maxAnyCount) {
          const start = node.end - 3;
          return ctx.addFailure(start, node.end, Rule.FAILURE_STRING);
        }
      }
      return ts.forEachChild(node, cb);
    });
  };
}