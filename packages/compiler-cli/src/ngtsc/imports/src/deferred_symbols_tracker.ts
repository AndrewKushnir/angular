/**
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */

import ts from 'typescript';

import {getContainingImportDeclaration} from '../../reflection/src/typescript';

const AssumeEager = 'AssumeEager';
type AssumeEager = typeof AssumeEager;

export class DeferredSymbolsTracker {
  private imports = new Map<ts.ImportDeclaration, Map<string, Set<ts.Identifier>|AssumeEager>>();

  constructor(private typeChecker: ts.TypeChecker) {}

  private track(importDecl: ts.ImportDeclaration): void {
    // we may or may not have seen this `importDecl` before
    // we may or may not have initialized references to `name` in this import statement before
    if (!this.imports.has(importDecl)) {
      const symbolsMap = new Map<string, Set<ts.Identifier>|AssumeEager>();
      // 3 cases:
      // import {a, b as B} from 'a'
      // import X from 'a'
      // import * as x from 'a'

      // import 'a'
      if (importDecl.importClause === undefined) {
        throw new Error(`Huh? No names in this import`);
      }

      if (importDecl.importClause.namedBindings !== undefined) {
        // import {a, b as B} from 'a'
        // import X from 'a'
        const bindings = importDecl.importClause.namedBindings;
        if (ts.isNamedImports(bindings)) {
          // import {a, b as B} from 'a'
          for (const element of bindings.elements) {
            symbolsMap.set(element.name.text, AssumeEager);
          }
        } else {
          // import X from 'a'
          symbolsMap.set(bindings.name.text, AssumeEager);
        }
      } else if (importDecl.importClause.name !== undefined) {
        // import * as x from 'a'
        symbolsMap.set(importDecl.importClause.name.text, AssumeEager);
      } else {
        // ?
        throw new Error('Unrecognized import structure!');
      }

      this.imports.set(importDecl, symbolsMap);
    }
  }

  markDeferrable(importDecl: ts.ImportDeclaration, ref: ts.Identifier): void {
    // Is it in our set?
    if (!this.imports.has(importDecl)) {
      this.track(importDecl);
    }

    const symbolsMap = this.imports.get(importDecl)!;

    if (!symbolsMap.has(ref.text)) {
      throw new Error('Not from that import?');
    }

    if (symbolsMap.get(ref.text) === AssumeEager) {
      // we need to populate references.
      symbolsMap.set(ref.text, this.lookupRefsFor(ref.text, importDecl));
    }

    const refs = symbolsMap.get(ref.text) as Set<ts.Identifier>;
    refs.delete(ref);
  }

  canDefer(importDecl: ts.ImportDeclaration): boolean {
    if (!this.imports.has(importDecl)) {
      return false;
    }

    const symbolsMap = this.imports.get(importDecl)!;
    for (const [symbol, refs] of symbolsMap) {
      if (refs === AssumeEager || refs.size > 0) {
        // There may be still eager references to this thing.
        return false;
      }
    }

    return true;
  }

  getImportDeclsToRemove(): Set<ts.ImportDeclaration> {
    const importsToRemove = new Set<ts.ImportDeclaration>();
    for (const [importDecl] of this.imports) {
      if (this.canDefer(importDecl)) {
        importsToRemove.add(importDecl);
      }
    }
    return importsToRemove;
  }

  private lookupRefsFor(name: string, importDecl: ts.ImportDeclaration): Set<ts.Identifier> {
    const results = new Set<ts.Identifier>();
    const visit = (node: ts.Node): void => {
      if (node === importDecl) {
        // Don't record references from the declaration itself.
        return;
      }

      if (ts.isIdentifier(node) && node.text === name) {
        // is `node` actually a reference to this thing?
        const sym = this.typeChecker.getSymbolAtLocation(node);
        if (sym === undefined) {
          return;
        }

        if (sym.declarations === undefined || sym.declarations.length === 0) {
          return;
        }
        const importClause = sym.declarations[0];
        // Is `decl` from this import statement?
        const decl = getContainingImportDeclaration(importClause);
        if (decl !== importDecl) {
          return;
        }
        // `node` *is* a reference to the same import.
        results.add(node);
      }
      ts.forEachChild(node, visit);
    };

    visit(importDecl.getSourceFile());
    return results;
  }
}
