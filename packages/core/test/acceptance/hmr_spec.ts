/**
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */

import {Component, Input, QueryList, ViewChild, ViewChildren} from '@angular/core';
import {getComponentDef} from '@angular/core/src/render3/definition';
import {hmr} from '@angular/core/src/render3/instructions/hmr';
import {TestBed} from '@angular/core/testing';

// Field that we'll monkey-patch onto DOM elements that were created
// initially, so that we can verify that some nodes were *not* re-created
// during HMR operation. We do it for *testing* purposes only.
const CREATED_INITIALLY_MARKER = '__ngCreatedInitially__';

function setMarker(node: Node) {
  (node as any)[CREATED_INITIALLY_MARKER] = true;
}

function hasMarker(node: Node): boolean {
  return !!(node as any)[CREATED_INITIALLY_MARKER];
}

function markNodesAsCreatedInitially(root: HTMLElement) {
  let current: Node|null = root;
  while (current) {
    setMarker(current);
    if (current.firstChild) {
      markNodesAsCreatedInitially(current.firstChild as HTMLElement);
    }
    current = current.nextSibling;
  }
}

function childrenOf(...nodes: Node[]): Node[] {
  const result: Node[] = [];
  for (const node of nodes) {
    let current: Node|null = node.firstChild;
    while (current) {
      result.push(current);
      current = current.nextSibling;
    }
  }
  return result;
}

function verifyNodesRemainUntouched(root: HTMLElement, exceptions: Node[] = []) {
  let current: Node|null = root;
  while (current) {
    if (!hasMarker(current)) {
      if (exceptions.includes(current)) {
        // This node was re-created intentionally,
        // do not inspect child nodes.
        break;
      } else {
        throw new Error(`Unexpected state: node was re-created: ${(current as any).outerHTML}`);
      }
    }
    if (current.firstChild) {
      verifyNodesRemainUntouched(current.firstChild as HTMLElement, exceptions);
    }
    current = current.nextSibling;
  }
}

function verifyNodesWereRecreated(nodes: Node[]) {
  for (const node of nodes) {
    if (hasMarker(node)) {
      throw new Error(`Unexpected state: node was *not* re-created: ${(node as any).outerHTML}`);
    }
  }
}

fdescribe('HMR', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({});
  });

  it('should recreate a component', async () => {
    @Component({
      selector: 'child-cmp',
      standalone: true,
      template: `
        <p title="extra attr">ChildCmp (hmr)</p>
        <h2>{{ text }}</h2>
        <div>Extra node!</div>
      `,
    })
    class NewChildCmp {
      @Input() text = '[empty]';
    }

    @Component({
      selector: 'child-cmp',
      standalone: true,
      template: '<span>ChildCmp (orig)</span><h1>{{ text }}</h1>',
    })
    class ChildCmp {
      @Input() text = '[empty]';
    }

    @Component({
      standalone: true,
      selector: 'simple-app',
      imports: [ChildCmp],
      template: `
        <i>Unrelated node #1</i>
        <child-cmp text="A" />
        <u>Unrelated node #2</u>
        <child-cmp text="B" />
        <b>Unrelated node #3</b>
        <main>
          <child-cmp text="C" />
        </main>
      `
    })
    class RootCmp {
    }

    const fixture = TestBed.createComponent(RootCmp);
    fixture.detectChanges();

    markNodesAsCreatedInitially(fixture.nativeElement);

    let html = fixture.nativeElement.outerHTML;
    expect(html).toContain('ChildCmp (orig)');
    expect(html).not.toContain('ChildCmp (hmr)');
    expect(html).not.toContain('Extra node!');
    expect(html).not.toContain('title="extra attr"');

    // NOTE: for now (for testing purposes), we use a `NewChildCmp` class as an updated
    // version of the `ChildCmp` one. In real circumstances, the compiler will generate
    // an update version of the component def based on the `ChildCmp` class.
    hmr(ChildCmp, getComponentDef(NewChildCmp)!, fixture.componentRef.hostView);
    fixture.detectChanges();

    const recreatedNodes = childrenOf(...fixture.nativeElement.querySelectorAll('child-cmp'));
    verifyNodesRemainUntouched(fixture.nativeElement, recreatedNodes);
    verifyNodesWereRecreated(recreatedNodes);

    html = fixture.nativeElement.outerHTML;
    expect(html).not.toContain('ChildCmp (orig)');
    expect(html).toContain('ChildCmp (hmr)');
    expect(html).toContain('Extra node!');
    expect(html).toContain('title="extra attr"');
  });

  it('should update ViewChildren query results', async () => {
    @Component({
      selector: 'child-cmp',
      standalone: true,
      template: '<span>ChildCmp {{ text }}</span>',
    })
    class ChildCmp {
      @Input() text = '[empty]';
    }

    @Component({
      standalone: true,
      selector: 'parent-cmp',
      imports: [ChildCmp],
      template: `
        <child-cmp text="A" />
        <child-cmp text="B" />
        <child-cmp text="C" />
        <child-cmp text="D" />
      `
    })
    class NewParentCmp {
      @ViewChildren(ChildCmp) childCmps!: QueryList<ChildCmp>;
    }

    @Component({
      standalone: true,
      selector: 'parent-cmp',
      imports: [ChildCmp],
      template: `
        <child-cmp text="A" />
        <child-cmp text="B" />
      `
    })
    class ParentCmp {
      @ViewChildren(ChildCmp) childCmps!: QueryList<ChildCmp>;
    }

    @Component({
      standalone: true,
      selector: 'simple-app',
      imports: [ParentCmp],
      template: `
        <parent-cmp />
      `
    })
    class RootCmp {
      @ViewChild(ParentCmp) parentCmp!: ParentCmp;
    }

    const fixture = TestBed.createComponent(RootCmp);
    fixture.detectChanges();

    let numChildCmps = fixture.componentInstance.parentCmp.childCmps.length;
    expect(numChildCmps).toBe(2);

    // NOTE: for now (for testing purposes), we use a `NewParentCmp` class as an updated
    // version of the `ParentCmp` one. In real circumstances, the compiler will generate
    // an update version of the component def based on the `ParentCmp` class.
    hmr(ParentCmp, getComponentDef(NewParentCmp)!, fixture.componentRef.hostView);
    fixture.detectChanges();

    // During HMR, the template was updated to include more component instances.
    // Expect view children query results to be updated.
    numChildCmps = fixture.componentInstance.parentCmp.childCmps.length;
    expect(numChildCmps).toBe(4);
  });

  it('should work with content projection', () => {
    @Component({
      standalone: true,
      selector: 'parent-cmp',
      template: `
        <main>
          <ng-content />
        </main>
      `
    })
    class NewParentCmp {
    }

    @Component({
      standalone: true,
      selector: 'parent-cmp',
      template: `
        <ng-content />
      `
    })
    class ParentCmp {
    }

    @Component({
      standalone: true,
      selector: 'simple-app',
      imports: [ParentCmp],
      template: `
        <parent-cmp>
          <h1>Projected H1</h1>
          <h2>Projected H2</h2>
        </parent-cmp>
      `
    })
    class RootCmp {
    }

    const fixture = TestBed.createComponent(RootCmp);
    fixture.detectChanges();

    markNodesAsCreatedInitially(fixture.nativeElement);

    let html = fixture.nativeElement.outerHTML;

    expect(html).toContain('<h1>Projected H1</h1>');
    expect(html).toContain('<h2>Projected H2</h2>');
    expect(html).not.toContain('<main>');

    // NOTE: for now (for testing purposes), we use a `NewParentCmp` class as an updated
    // version of the `ParentCmp` one. In real circumstances, the compiler will generate
    // an update version of the component def based on the `ParentCmp` class.
    hmr(ParentCmp, getComponentDef(NewParentCmp)!, fixture.componentRef.hostView);
    fixture.detectChanges();

    // <h1> and <h2> nodes were not re-created, since they belong to a parent
    // component, which wasn't HMR'ed.
    verifyNodesRemainUntouched(fixture.nativeElement.querySelector('h1'));
    verifyNodesRemainUntouched(fixture.nativeElement.querySelector('h2'));
    verifyNodesWereRecreated([fixture.nativeElement.querySelector('main')]);

    html = fixture.nativeElement.outerHTML;
    expect(html).toContain('<h1>Projected H1</h1>');
    expect(html).toContain('<h2>Projected H2</h2>');
    expect(html).toContain('<main>');
  });
});
