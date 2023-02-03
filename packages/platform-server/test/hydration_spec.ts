/**
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */

import '@angular/localize/init';

import {CommonModule, DOCUMENT, isPlatformServer, NgFor, NgIf, NgTemplateOutlet} from '@angular/common';
import {ApplicationRef, Component, ComponentRef, ContentChildren, createComponent, destroyPlatform, Directive, ElementRef, EnvironmentInjector, getPlatform, inject, PLATFORM_ID, provideSsrSupport, QueryList, TemplateRef, Type, ViewChild, ViewContainerRef, withHydration, ɵsetDocument} from '@angular/core';
import {TestBed} from '@angular/core/testing';
import {bootstrapApplication} from '@angular/platform-browser';
import {first} from 'rxjs/operators';

import {renderApplication} from '../src/utils';

// Drop utility attributes such as `ng-version`, `ng-server-context` and `ngh`,
// so that it's easier to make assertions in tests.
function stripUtilAttributes(html: string, keepNgh: boolean): string {
  html = html.replace(/ ng-version=".*?"/g, '')  //
             .replace(/ ng-server-context=".*?"/g, '');
  if (!keepNgh) {
    html = html.replace(/ ngh=".*?"/g, '')  //
               .replace(/<!--ngetn-->/g, '')
               .replace(/<!--ngtns-->/g, '');
  }
  return html;
}

function stripExcessiveSpaces(html: string): string {
  return html.replace(/\s+/g, ' ');
}

function getAppContents(html: string): string {
  const result = stripUtilAttributes(html, true).match(/<body>(.*?)<\/body>/s);
  if (!result) {
    throw new Error('App not found!');
  }
  return result[1];
}

function whenStable(appRef: ApplicationRef): Promise<boolean> {
  return appRef.isStable.pipe(first((isStable: boolean) => isStable)).toPromise();
}

/**
 * Reset TView, so that we re-enter the first create pass as
 * we would normally do when we hydrate on the client. Otherwise,
 * hydration info would not be applied to T data structures.
 *
 * TODO: find a better way to do that in tests, because there
 * might be nested components that would require the same.
 */
function resetTViewsFor(...types: Type<unknown>[]) {
  for (const type of types) {
    (type as any).ɵcmp.tView = null;
  }
}

function getAppDOM(html: string, doc: Document): HTMLElement {
  const contents = getAppContents(html);
  const container = doc.createElement('div');
  container.innerHTML = contents;
  return container;
}

function getComponentRef<T>(appRef: ApplicationRef): ComponentRef<T> {
  return appRef.components[0];
}

function verifyClientAndSSRContentsMatch(ssrContents: string, clientAppRootElement: HTMLElement) {
  const clientContents = stripUtilAttributes(clientAppRootElement.outerHTML, false);
  ssrContents = stripUtilAttributes(ssrContents, false);
  expect(clientContents).toBe(ssrContents, 'Client and server contents mismatch');
}

function verifyAllNodesClaimedForHydration(el: any) {
  if (el.nodeType === Node.ELEMENT_NODE && el.hasAttribute('ngnonhydratable')) return;
  if (!el.__claimed) {
    fail('Hydration error: the node is *not* hydrated: ' + el.outerHTML);
  }
  let current = el.firstChild;
  while (current) {
    verifyAllNodesClaimedForHydration(current);
    current = current.nextSibling;
  }
}

// if (getDOM().supportsDOMEvents) return;  // NODE only

fdescribe('platform-server integration', () => {
  beforeEach(() => {
    if (getPlatform()) destroyPlatform();
  });

  describe('hydration', () => {
    const appId = 'simple-cmp';

    let doc: Document;

    beforeEach(() => {
      doc = TestBed.inject(DOCUMENT);
    });

    afterEach(() => {
      let current = doc.body.firstChild;
      while (current) {
        const nextSibling = current.nextSibling;
        current.remove();
        current = nextSibling;
      }
    });

    async function ssr(component: Type<unknown>, doc?: string): Promise<string> {
      doc ||= '<html><head></head><body><app></app></body></html>';
      const providers = [provideSsrSupport(appId, withHydration())];
      return renderApplication(component, {document: doc, appId, providers});
    }

    async function hydrate(html: string, component: Type<unknown>): Promise<ApplicationRef> {
      // Destroy existing platform, a new one will be created later in `hydrateApplication`.
      destroyPlatform();

      // Get HTML contents of the `<app>`, create a DOM element and append it into the body.
      const container = getAppDOM(html, doc);
      Array.from(container.children).forEach(node => doc.body.appendChild(node));

      function _document(): any {
        ɵsetDocument(doc);
        global.document = doc;  // needed for `DefaultDomRenderer2`
        return doc;
      }

      const providers = [
        {provide: DOCUMENT, useFactory: _document, deps: []},
        provideSsrSupport(appId, withHydration()),
      ];
      return bootstrapApplication(component, {providers});
    }

    describe('basic scenarios', () => {
      it('should support text-only contents', async () => {
        @Component({
          standalone: true,
          selector: 'app',
          template: `
            This is hydrated content.
          `,
        })
        class SimpleComponent {
        }

        const html = await ssr(SimpleComponent);
        const ssrContents = getAppContents(html);

        // TODO: properly assert `ngh` attribute value once the `ngh`
        // format stabilizes, for now we just check that it's present.
        expect(ssrContents).toContain('<app ngh');

        resetTViewsFor(SimpleComponent);

        const appRef = await hydrate(html, SimpleComponent);
        const compRef = getComponentRef<SimpleComponent>(appRef);
        appRef.tick();

        const clientRootNode = compRef.location.nativeElement;
        verifyAllNodesClaimedForHydration(clientRootNode);
        verifyClientAndSSRContentsMatch(ssrContents, clientRootNode);
      });

      it('should support text and HTML elements', async () => {
        @Component({
          standalone: true,
          selector: 'app',
          template: `
            <header>Header</header>
            <main>This is hydrated content in the main element.</main>
            <footer>Footer</footer>
          `,
        })
        class SimpleComponent {
        }

        const html = await ssr(SimpleComponent);
        const ssrContents = getAppContents(html);

        // TODO: properly assert `ngh` attribute value once the `ngh`
        // format stabilizes, for now we just check that it's present.
        expect(ssrContents).toContain('<app ngh');

        resetTViewsFor(SimpleComponent);

        const appRef = await hydrate(html, SimpleComponent);
        const compRef = getComponentRef<SimpleComponent>(appRef);
        appRef.tick();

        const clientRootNode = compRef.location.nativeElement;
        verifyAllNodesClaimedForHydration(clientRootNode);
        verifyClientAndSSRContentsMatch(ssrContents, clientRootNode);
      });

      it('should support elements with local refs', async () => {
        @Component({
          standalone: true,
          selector: 'app',
          template: `
            <header #headerRef>Header</header>
            <main #mainRef>This is hydrated content in the main element.</main>
            <footer #footerRef>Footer</footer>
          `,
        })
        class SimpleComponent {
        }

        const html = await ssr(SimpleComponent);
        const ssrContents = getAppContents(html);

        // TODO: properly assert `ngh` attribute value once the `ngh`
        // format stabilizes, for now we just check that it's present.
        expect(ssrContents).toContain('<app ngh');

        resetTViewsFor(SimpleComponent);

        const appRef = await hydrate(html, SimpleComponent);
        const compRef = getComponentRef<SimpleComponent>(appRef);
        appRef.tick();

        const clientRootNode = compRef.location.nativeElement;
        verifyAllNodesClaimedForHydration(clientRootNode);
        verifyClientAndSSRContentsMatch(ssrContents, clientRootNode);
      });

      it('should support elements that are both component host nodes and viewContainerRef anchors',
         async () => {
           @Component({
             standalone: true,
             selector: '[mat-button]',
             template: `
            <ng-content></ng-content>
          `,
           })
           class ButtonComponent {
           }

           @Directive({
             standalone: true,
             selector: '[mat-button-trigger]',
           })
           class TriggerDirective {
             vcr = inject(ViewContainerRef)
           }

           @Component({
             standalone: true,
             selector: 'app',
             imports: [ButtonComponent, TriggerDirective],
             template: `
            <button mat-button mat-button-trigger>Button</button>
          `,
           })
           class SimpleComponent {
           }

           const html = await ssr(SimpleComponent);
           const ssrContents = getAppContents(html);

           // TODO: properly assert `ngh` attribute value once the `ngh`
           // format stabilizes, for now we just check that it's present.
           expect(ssrContents).toContain('<app ngh');
           resetTViewsFor(SimpleComponent, ButtonComponent);

           const appRef = await hydrate(html, SimpleComponent);
           const compRef = getComponentRef<SimpleComponent>(appRef);
           appRef.tick();

           const clientRootNode = compRef.location.nativeElement;
           verifyAllNodesClaimedForHydration(clientRootNode);
           verifyClientAndSSRContentsMatch(ssrContents, clientRootNode);
         });

      it('should handle extra child nodes within a root app component', async () => {
        @Component({
          standalone: true,
          selector: 'app',
          template: `
            <div>Some content</div>
          `,
        })
        class SimpleComponent {
        }

        const extraChildNodes = '<!--comment--> Some text! <b>and a tag</b>';
        const doc = `<html><head></head><body><app>${extraChildNodes}</app></body></html>`;
        const html = await ssr(SimpleComponent, doc);
        const ssrContents = getAppContents(html);

        // TODO: properly assert `ngh` attribute value once the `ngh`
        // format stabilizes, for now we just check that it's present.
        expect(ssrContents).toContain('<app ngh');

        resetTViewsFor(SimpleComponent);

        const appRef = await hydrate(html, SimpleComponent);
        const compRef = getComponentRef<SimpleComponent>(appRef);
        appRef.tick();

        const clientRootNode = compRef.location.nativeElement;
        verifyAllNodesClaimedForHydration(clientRootNode);
        verifyClientAndSSRContentsMatch(ssrContents, clientRootNode);
      });
    });

    describe('text nodes', () => {
      it('should support empty text nodes', async () => {
        @Component({
          standalone: true,
          selector: 'app',
          template: `
            This is hydrated content.<span>{{spanText}}</span>.
          `,
        })
        class SimpleComponent {
          spanText = ''
        }

        const html = await ssr(SimpleComponent);
        const ssrContents = getAppContents(html);

        // TODO: properly assert `ngh` attribute value once the `ngh`
        // format stabilizes, for now we just check that it's present.
        expect(ssrContents).toContain('<app ngh');

        resetTViewsFor(SimpleComponent);

        const appRef = await hydrate(html, SimpleComponent);
        const compRef = getComponentRef<SimpleComponent>(appRef);
        appRef.tick();

        const clientRootNode = compRef.location.nativeElement;
        verifyAllNodesClaimedForHydration(clientRootNode);
        verifyClientAndSSRContentsMatch(ssrContents, clientRootNode);
      });

      it('should support empty text nodes with subsequent content', async () => {
        @Component({
          standalone: true,
          selector: 'app',
          template: `
            This is hydrated content.<span>{{emptyText}}{{moreText}}</span>.
          `,
        })
        class SimpleComponent {
          emptyText = ''
          moreText = ''
        }

        const html = await ssr(SimpleComponent);
        const ssrContents = getAppContents(html);

        // TODO: properly assert `ngh` attribute value once the `ngh`
        // format stabilizes, for now we just check that it's present.
        expect(ssrContents).toContain('<app ngh');

        resetTViewsFor(SimpleComponent);

        const appRef = await hydrate(html, SimpleComponent);
        const compRef = getComponentRef<SimpleComponent>(appRef);
        appRef.tick();

        const clientRootNode = compRef.location.nativeElement;
        verifyAllNodesClaimedForHydration(clientRootNode);
        verifyClientAndSSRContentsMatch(ssrContents, clientRootNode);
      });

      it('should support projected text node content with plain text nodes', async () => {
        @Component({
          standalone: true,
          selector: 'app',
          imports: [NgIf],
          template: `
            <div>Hello <ng-container *ngIf="true">World</ng-container></div>
          `,
        })
        class SimpleComponent {
        }

        const html = await ssr(SimpleComponent);
        const ssrContents = getAppContents(html);
        // TODO: properly assert `ngh` attribute value once the `ngh`
        // format stabilizes, for now we just check that it's present.
        expect(ssrContents).toContain('<app ngh');

        resetTViewsFor(SimpleComponent);

        const appRef = await hydrate(html, SimpleComponent);
        const compRef = getComponentRef<SimpleComponent>(appRef);
        appRef.tick();

        const clientRootNode = compRef.location.nativeElement;
        verifyAllNodesClaimedForHydration(clientRootNode);
        verifyClientAndSSRContentsMatch(ssrContents, clientRootNode);
      });
    });

    describe('content projection', () => {
      it('should project plain text', async () => {
        @Component({
          standalone: true,
          selector: 'projector-cmp',
          template: `
            <main>
              <ng-content></ng-content>
            </main>
          `,
        })
        class ProjectorCmp {
        }

        @Component({
          standalone: true,
          imports: [ProjectorCmp],
          selector: 'app',
          template: `
            <projector-cmp>
              Projected content is just a plain text.
            </projector-cmp>
          `,
        })
        class SimpleComponent {
        }

        const html = await ssr(SimpleComponent);
        const ssrContents = getAppContents(html);

        // TODO: properly assert `ngh` attribute value once the `ngh`
        // format stabilizes, for now we just check that it's present.
        expect(ssrContents).toContain('<app ngh');

        resetTViewsFor(SimpleComponent, ProjectorCmp);

        const appRef = await hydrate(html, SimpleComponent);
        const compRef = getComponentRef<SimpleComponent>(appRef);
        appRef.tick();

        const clientRootNode = compRef.location.nativeElement;
        verifyAllNodesClaimedForHydration(clientRootNode);
        verifyClientAndSSRContentsMatch(ssrContents, clientRootNode);
      });

      it('should project plain text and HTML elements', async () => {
        @Component({
          standalone: true,
          selector: 'projector-cmp',
          template: `
            <main>
              <ng-content></ng-content>
            </main>
          `,
        })
        class ProjectorCmp {
        }

        @Component({
          standalone: true,
          imports: [ProjectorCmp],
          selector: 'app',
          template: `
            <projector-cmp>
              Projected content is a plain text.
              <b>Also the content has some tags</b>
            </projector-cmp>
          `,
        })
        class SimpleComponent {
        }

        const html = await ssr(SimpleComponent);
        const ssrContents = getAppContents(html);

        // TODO: properly assert `ngh` attribute value once the `ngh`
        // format stabilizes, for now we just check that it's present.
        expect(ssrContents).toContain('<app ngh');

        resetTViewsFor(SimpleComponent, ProjectorCmp);

        const appRef = await hydrate(html, SimpleComponent);
        const compRef = getComponentRef<SimpleComponent>(appRef);
        appRef.tick();

        const clientRootNode = compRef.location.nativeElement;
        verifyAllNodesClaimedForHydration(clientRootNode);
        verifyClientAndSSRContentsMatch(ssrContents, clientRootNode);
      });

      it('should support re-projection of contents', async () => {
        @Component({
          standalone: true,
          selector: 'reprojector-cmp',
          template: `
            <main>
              <ng-content></ng-content>
            </main>
          `,
        })
        class ReprojectorCmp {
        }

        @Component({
          standalone: true,
          selector: 'projector-cmp',
          imports: [ReprojectorCmp],
          template: `
            <reprojector-cmp>
              <b>Before</b>
              <ng-content></ng-content>
              <i>After</i>
            </reprojector-cmp>
          `,
        })
        class ProjectorCmp {
        }

        @Component({
          standalone: true,
          imports: [ProjectorCmp],
          selector: 'app',
          template: `
            <projector-cmp>
              Projected content is a plain text.
            </projector-cmp>
          `,
        })
        class SimpleComponent {
        }

        const html = await ssr(SimpleComponent);
        const ssrContents = getAppContents(html);

        // TODO: properly assert `ngh` attribute value once the `ngh`
        // format stabilizes, for now we just check that it's present.
        expect(ssrContents).toContain('<app ngh');

        resetTViewsFor(SimpleComponent, ProjectorCmp, ReprojectorCmp);

        const appRef = await hydrate(html, SimpleComponent);
        const compRef = getComponentRef<SimpleComponent>(appRef);
        appRef.tick();

        const clientRootNode = compRef.location.nativeElement;
        verifyAllNodesClaimedForHydration(clientRootNode);
        verifyClientAndSSRContentsMatch(ssrContents, clientRootNode);
      });

      it('should project contents into different slots', async () => {
        @Component({
          standalone: true,
          selector: 'projector-cmp',
          template: `
            <div>
              Header slot: <ng-content select="header"></ng-content>
              Main slot: <ng-content select="main"></ng-content>
              Footer slot: <ng-content select="footer"></ng-content>
              <ng-content></ng-content> <!-- everything else -->
            </div>
          `,
        })
        class ProjectorCmp {
        }

        @Component({
          standalone: true,
          imports: [ProjectorCmp],
          selector: 'app',
          template: `
            <projector-cmp>
              <!-- contents is intentionally randomly ordered -->
              <h1>H1</h1>
              <footer>Footer</footer>
              <header>Header</header>
              <main>Main</main>
              <h2>H2</h2>
            </projector-cmp>
          `,
        })
        class SimpleComponent {
        }

        const html = await ssr(SimpleComponent);
        const ssrContents = getAppContents(html);

        // TODO: properly assert `ngh` attribute value once the `ngh`
        // format stabilizes, for now we just check that it's present.
        expect(ssrContents).toContain('<app ngh');

        resetTViewsFor(SimpleComponent, ProjectorCmp);

        const appRef = await hydrate(html, SimpleComponent);
        const compRef = getComponentRef<SimpleComponent>(appRef);
        appRef.tick();

        const clientRootNode = compRef.location.nativeElement;
        verifyAllNodesClaimedForHydration(clientRootNode);
        verifyClientAndSSRContentsMatch(ssrContents, clientRootNode);
      });

      it('should support partial projection (when some nodes are not projected)', async () => {
        @Component({
          standalone: true,
          selector: 'projector-cmp',
          template: `
            <div>
              Header slot: <ng-content select="header"></ng-content>
              Main slot: <ng-content select="main"></ng-content>
              Footer slot: <ng-content select="footer"></ng-content>
              <!-- no "default" projection bucket -->
            </div>
          `,
        })
        class ProjectorCmp {
        }

        @Component({
          standalone: true,
          imports: [ProjectorCmp],
          selector: 'app',
          template: `
            <projector-cmp>
              <!-- contents is intentionally randomly ordered -->
              <h1>This node is not projected.</h1>
              <footer>Footer</footer>
              <header>Header</header>
              <main>Main</main>
              <h2>This node is not projected as well.</h2>
            </projector-cmp>
          `,
        })
        class SimpleComponent {
        }

        const html = await ssr(SimpleComponent);
        const ssrContents = getAppContents(html);

        // TODO: properly assert `ngh` attribute value once the `ngh`
        // format stabilizes, for now we just check that it's present.
        expect(ssrContents).toContain('<app ngh');

        resetTViewsFor(SimpleComponent, ProjectorCmp);

        const appRef = await hydrate(html, SimpleComponent);
        const compRef = getComponentRef<SimpleComponent>(appRef);
        appRef.tick();

        const clientRootNode = compRef.location.nativeElement;
        verifyAllNodesClaimedForHydration(clientRootNode);
        verifyClientAndSSRContentsMatch(ssrContents, clientRootNode);
      });

      it('should project contents with *ngIf\'s', async () => {
        @Component({
          standalone: true,
          selector: 'projector-cmp',
          template: `
            <main>
              <ng-content></ng-content>
            </main>
          `,
        })
        class ProjectorCmp {
        }

        @Component({
          standalone: true,
          imports: [ProjectorCmp, CommonModule],
          selector: 'app',
          template: `
            <projector-cmp>
              <h1 *ngIf="visible">Header with an ngIf condition.</h1>
            </projector-cmp>
          `,
        })
        class SimpleComponent {
          visible = true;
        }

        const html = await ssr(SimpleComponent);
        const ssrContents = getAppContents(html);

        // TODO: properly assert `ngh` attribute value once the `ngh`
        // format stabilizes, for now we just check that it's present.
        expect(ssrContents).toContain('<app ngh');

        resetTViewsFor(SimpleComponent, ProjectorCmp);

        const appRef = await hydrate(html, SimpleComponent);
        const compRef = getComponentRef<SimpleComponent>(appRef);
        appRef.tick();

        const clientRootNode = compRef.location.nativeElement;
        verifyAllNodesClaimedForHydration(clientRootNode);
        verifyClientAndSSRContentsMatch(ssrContents, clientRootNode);
      });

      it('should support projecting contents outside of a current host element', async () => {
        @Component({
          standalone: true,
          selector: 'dynamic-cmp',
          template: `<div #target></div>`,
        })
        class DynamicComponent {
          @ViewChild('target', {read: ViewContainerRef}) vcRef!: ViewContainerRef;

          createView(tmplRef: TemplateRef<unknown>) {
            this.vcRef.createEmbeddedView(tmplRef);
          }
        }

        @Component({
          standalone: true,
          selector: 'projector-cmp',
          template: `
            <ng-template #ref>
              <ng-content></ng-content>
            </ng-template>
          `,
        })
        class ProjectorCmp {
          @ViewChild('ref', {read: TemplateRef}) tmplRef!: TemplateRef<unknown>;

          appRef = inject(ApplicationRef);
          environmentInjector = inject(EnvironmentInjector);
          doc = inject(DOCUMENT) as Document;
          isServer = isPlatformServer(inject(PLATFORM_ID));

          ngAfterViewInit() {
            // Create a host DOM node outside of the main app's host node
            // to emulate a situation where a host node already exists
            // on a page.
            let hostElement: Element;
            if (this.isServer) {
              hostElement = this.doc.createElement('portal-app');
              this.doc.body.insertBefore(hostElement, this.doc.body.firstChild);
            } else {
              hostElement = this.doc.querySelector('portal-app')!;
            }

            const cmp = createComponent(
                DynamicComponent, {hostElement, environmentInjector: this.environmentInjector});
            cmp.changeDetectorRef.detectChanges();
            cmp.instance.createView(this.tmplRef);
            this.appRef.attachView(cmp.hostView);
          }
        }

        @Component({
          standalone: true,
          imports: [ProjectorCmp, CommonModule],
          selector: 'app',
          template: `
            <projector-cmp>
              <header>Header</header>
            </projector-cmp>
          `,
        })
        class SimpleComponent {
          visible = true;
        }

        const html = await ssr(SimpleComponent);
        const ssrContents = getAppContents(html);

        // TODO: properly assert `ngh` attribute value once the `ngh`
        // format stabilizes, for now we just check that it's present.
        expect(ssrContents).toContain('<app ngh');

        resetTViewsFor(SimpleComponent, ProjectorCmp);

        const appRef = await hydrate(html, SimpleComponent);
        const compRef = getComponentRef<SimpleComponent>(appRef);
        appRef.tick();

        const clientRootNode = compRef.location.nativeElement;
        const portalRootNode = clientRootNode.ownerDocument.body.firstChild;
        verifyAllNodesClaimedForHydration(clientRootNode);
        verifyAllNodesClaimedForHydration(portalRootNode.firstChild);
        const clientContents = stripUtilAttributes(portalRootNode.outerHTML, false) +
            stripUtilAttributes(clientRootNode.outerHTML, false);
        expect(clientContents)
            .toBe(stripUtilAttributes(ssrContents, false), 'Client and server contents mismatch');
      });

      it('should handle projected containers inside other containers', async () => {
        @Component({
          standalone: true,
          selector: 'child-comp',  //
          template: '<ng-content></ng-content>'
        })
        class ChildComp {
        }

        @Component({
          standalone: true,
          selector: 'root-comp',  //
          template: '<ng-content></ng-content>'
        })
        class RootComp {
        }

        @Component({
          standalone: true,
          selector: 'app',
          imports: [CommonModule, RootComp, ChildComp],
          template: `
            <root-comp>
              <ng-container *ngFor="let item of items; last as last">
                <child-comp *ngIf="!last">{{ item }}|</child-comp>
              </ng-container>
            </root-comp>
          `
        })
        class MyApp {
          items: number[] = [1, 2, 3];
        }

        const html = await ssr(MyApp);
        const ssrContents = getAppContents(html);

        // TODO: properly assert `ngh` attribute value once the `ngh`
        // format stabilizes, for now we just check that it's present.
        expect(ssrContents).toContain('<app ngh');

        resetTViewsFor(MyApp, RootComp, ChildComp);

        const appRef = await hydrate(html, MyApp);
        const compRef = getComponentRef<MyApp>(appRef);
        appRef.tick();

        const clientRootNode = compRef.location.nativeElement;
        verifyAllNodesClaimedForHydration(clientRootNode);
        verifyClientAndSSRContentsMatch(ssrContents, clientRootNode);
      });
    });

    describe('ngNonHydratable', () => {
      it('should skip hydrating elements with ngNonHydratable attribute', async () => {
        @Directive({standalone: true, selector: 'button'})
        class MyButtonDirective {
          el = inject(ElementRef);
        }

        @Component({
          standalone: true,
          selector: 'projector-cmp',
          template: `
            <main>
              <ng-content></ng-content>
            </main>
          `,
        })
        class ProjectorCmp {
          @ContentChildren(MyButtonDirective) buttons!: QueryList<MyButtonDirective>;

          ngAfterContentInit() {
            this.buttons.forEach((button) => {
              button.el.nativeElement.remove();
            });
          }
        }

        @Component({
          standalone: true,
          imports: [ProjectorCmp, MyButtonDirective],
          selector: 'app',
          template: `
            <projector-cmp ngNonHydratable>
              <button type="button">Click Me</button>
              <button type="button">Click Also</button>
              <button type="button">No, Click Me Instead</button>
            </projector-cmp>
          `,
        })
        class SimpleComponent {
        }

        const html = await ssr(SimpleComponent);
        const ssrContents = getAppContents(html);

        // TODO: properly assert `ngh` attribute value once the `ngh`
        // format stabilizes, for now we just check that it's present.
        expect(ssrContents).toContain('<app ngh');

        resetTViewsFor(SimpleComponent, ProjectorCmp);

        const appRef = await hydrate(html, SimpleComponent);
        const compRef = getComponentRef<SimpleComponent>(appRef);
        appRef.tick();

        const clientRootNode = compRef.location.nativeElement;
        verifyAllNodesClaimedForHydration(clientRootNode);
        verifyClientAndSSRContentsMatch(ssrContents, clientRootNode);
      });

      it('should skip hydrating elements with ngNonHydratable host binding', async () => {
        @Directive({standalone: true, selector: 'button'})
        class MyButtonDirective {
          el = inject(ElementRef);
        }

        @Component({
          standalone: true,
          selector: 'projector-cmp',
          host: {ngNonHydratable: 'true'},
          template: `
            <main>
              <ng-content></ng-content>
            </main>
          `,
        })
        class ProjectorCmp {
          @ContentChildren(MyButtonDirective) buttons!: QueryList<MyButtonDirective>;

          ngAfterContentInit() {
            this.buttons.forEach((button) => {
              button.el.nativeElement.remove();
            });
          }
        }

        @Component({
          standalone: true,
          imports: [ProjectorCmp, MyButtonDirective],
          selector: 'app',
          template: `
            <projector-cmp>
              <button type="button">Click Me</button>
              <button type="button">Click Also</button>
              <button type="button">No, Click Me Instead</button>
            </projector-cmp>
          `,
        })
        class SimpleComponent {
        }

        const html = await ssr(SimpleComponent);
        const ssrContents = getAppContents(html);

        // TODO: properly assert `ngh` attribute value once the `ngh`
        // format stabilizes, for now we just check that it's present.
        expect(ssrContents).toContain('<app ngh');

        resetTViewsFor(SimpleComponent, ProjectorCmp);

        const appRef = await hydrate(html, SimpleComponent);
        const compRef = getComponentRef<SimpleComponent>(appRef);
        appRef.tick();

        const clientRootNode = compRef.location.nativeElement;
        verifyAllNodesClaimedForHydration(clientRootNode);
        verifyClientAndSSRContentsMatch(ssrContents, clientRootNode);
      });

      it('should skip hydrating elements with ngNonHydratable attribute in VCR', async () => {
        @Component({
          standalone: true,
          selector: 'nested-cmp',
          template: `Just some text`,
        })
        class NestedComponent {
        }

        @Component({
          standalone: true,
          selector: 'projector-cmp',
          imports: [NestedComponent],
          template: `
            <main>
              <nested-cmp></nested-cmp>
            </main>
          `,
        })
        class ProjectorCmp {
          vcr = inject(ViewContainerRef);
        }

        @Component({
          standalone: true,
          imports: [ProjectorCmp],
          selector: 'app',
          template: `
            <projector-cmp ngNonHydratable>
            </projector-cmp>
          `,
        })
        class SimpleComponent {
        }

        const html = await ssr(SimpleComponent);
        const ssrContents = getAppContents(html);

        // TODO: properly assert `ngh` attribute value once the `ngh`
        // format stabilizes, for now we just check that it's present.
        expect(ssrContents).toContain('<app ngh');

        resetTViewsFor(SimpleComponent, ProjectorCmp);

        const appRef = await hydrate(html, SimpleComponent);
        const compRef = getComponentRef<SimpleComponent>(appRef);
        appRef.tick();

        const clientRootNode = compRef.location.nativeElement;
        verifyAllNodesClaimedForHydration(clientRootNode);
        verifyClientAndSSRContentsMatch(ssrContents, clientRootNode);
      });
    });

    // FIXME: i18n needs more work...
    xdescribe('i18n', () => {
      it('should support text-only contents', async () => {
        @Component({
          standalone: true,
          selector: 'app',
          template: `
            <div i18n>
              !<b>Before I <i>Inside I</i> After I</b><u>Underline</u>
            </div>
          `,
        })
        class SimpleComponent {
        }

        const html = await ssr(SimpleComponent);
        const ssrContents = getAppContents(html);

        // TODO: properly assert `ngh` attribute value once the `ngh`
        // format stabilizes, for now we just check that it's present.
        expect(ssrContents).toContain('<app ngh');

        resetTViewsFor(SimpleComponent);

        const appRef = await hydrate(html, SimpleComponent);
        const compRef = getComponentRef<SimpleComponent>(appRef);
        appRef.tick();

        const clientRootNode = compRef.location.nativeElement;
        verifyAllNodesClaimedForHydration(clientRootNode);
        verifyClientAndSSRContentsMatch(ssrContents, clientRootNode);
      });
    });

    describe('*ngFor', () => {
      it('should work with *ngFor', async () => {
        @Component({
          standalone: true,
          selector: 'app',
          imports: [NgIf, NgFor],
          template: `
          <div>
            <span *ngFor="let item of items">
              {{ item }}
              <b *ngIf="item > 15">is bigger than 15!</b>
            </span>
            <main>Hi! This is the main content.</main>
          </div>
        `,
        })
        class SimpleComponent {
          isServer = isPlatformServer(inject(PLATFORM_ID));
          // Note: this is to test cleanup/reconciliation logic.
          items = this.isServer ? [10, 20, 100, 200] : [30, 5, 50];
        }

        const html = await ssr(SimpleComponent);
        const ssrContents = getAppContents(html);

        // TODO: properly assert `ngh` attribute value once the `ngh`
        // format stabilizes, for now we just check that it's present.
        expect(ssrContents).toContain('<app ngh');

        resetTViewsFor(SimpleComponent);

        const appRef = await hydrate(html, SimpleComponent);
        const compRef = getComponentRef<SimpleComponent>(appRef);
        appRef.tick();

        const clientRootNode = compRef.location.nativeElement;

        // TODO: investigate why pre-cleanup contents doesn't have an
        // excessive <b> element.
        //
        // Pre-cleanup state would contain "dehydrated" views
        // (note the "5 <b>is bigger than 15!</b>" part).
        // const preCleanupContents = stripExcessiveSpaces(clientRootNode.outerHTML);
        // expect(preCleanupContents)
        //     .toContain(
        //         '<span> 5 <b>is bigger than 15!</b><!--bindings={ "ng-reflect-ng-if": "false"
        //         }--></span>');

        await whenStable(appRef);

        // Post-cleanup should *not* contain dehydrated views.
        const postCleanupContents = stripExcessiveSpaces(clientRootNode.outerHTML);
        expect(postCleanupContents)
            .not.toContain(
                '<span> 5 <b>is bigger than 15!</b><!--bindings={ "ng-reflect-ng-if": "false" }--></span>');
        expect(postCleanupContents)
            .toContain(
                '<span> 30 <b>is bigger than 15!</b><!--bindings={ "ng-reflect-ng-if": "true" }--></span>');
        expect(postCleanupContents)
            .toContain('<span> 5 <!--bindings={ "ng-reflect-ng-if": "false" }--></span>');
        expect(postCleanupContents)
            .toContain(
                '<span> 50 <b>is bigger than 15!</b><!--bindings={ "ng-reflect-ng-if": "true" }--></span>');
      });
    });

    describe('NgTemplateOutlet', () => {
      it('should work with <ng-container>', async () => {
        @Component({
          standalone: true,
          selector: 'app',
          imports: [NgTemplateOutlet],
          template: `
            <ng-template #tmpl>
              This is a content of the template!
            </ng-template>
            <ng-container [ngTemplateOutlet]="tmpl"></ng-container>
          `,
        })
        class SimpleComponent {
        }

        const html = await ssr(SimpleComponent);
        const ssrContents = getAppContents(html);

        // TODO: properly assert `ngh` attribute value once the `ngh`
        // format stabilizes, for now we just check that it's present.
        expect(ssrContents).toContain('<app ngh');

        resetTViewsFor(SimpleComponent);

        const appRef = await hydrate(html, SimpleComponent);
        const compRef = getComponentRef<SimpleComponent>(appRef);
        appRef.tick();

        const clientRootNode = compRef.location.nativeElement;
        verifyAllNodesClaimedForHydration(clientRootNode);
        verifyClientAndSSRContentsMatch(ssrContents, clientRootNode);
      });
    });

    // TODO: also add a test where `ViewContainerRef.createComponent`
    // is used inside a component that is created dynamically.
    // TODO: add a test where `ViewContainerRef.createComponent` and
    // `ViewContainerRef.createEmbeddedView` are called *after*
    // hydration cleanup
    describe('ViewContainerRef.createComponent', () => {
      it('should work with ViewContainerRef.createComponent', async () => {
        @Component({
          standalone: true,
          selector: 'dynamic',
          template: `
            <span>This is a content of a dynamic component.</span>
          `,
        })
        class DynamicComponent {
        }

        @Component({
          standalone: true,
          selector: 'app',
          imports: [NgIf, NgFor],
          template: `
            <div #target></div>
            <main>Hi! This is the main content.</main>
          `,
        })
        class SimpleComponent {
          @ViewChild('target', {read: ViewContainerRef}) vcr!: ViewContainerRef;

          ngAfterViewInit() {
            const compRef = this.vcr.createComponent(DynamicComponent);
            compRef.changeDetectorRef.detectChanges();
          }
        }

        const html = await ssr(SimpleComponent);
        const ssrContents = getAppContents(html);

        // TODO: properly assert `ngh` attribute value once the `ngh`
        // format stabilizes, for now we just check that it's present.
        expect(ssrContents).toContain('<app ngh');

        resetTViewsFor(SimpleComponent, DynamicComponent);

        const appRef = await hydrate(html, SimpleComponent);
        const compRef = getComponentRef<SimpleComponent>(appRef);
        appRef.tick();

        const clientRootNode = compRef.location.nativeElement;
        verifyAllNodesClaimedForHydration(clientRootNode);
        verifyClientAndSSRContentsMatch(ssrContents, clientRootNode);
      });

      it('should work with ViewContainerRef.createComponent' +
             ' when a component has views to cleanup after hydration',
         async () => {
           @Component({
             standalone: true,
             imports: [CommonModule],
             selector: 'dynamic',
             template: `
              <span>This is a content of a dynamic component.</span>
              <b *ngIf="isServer">This is a SERVER-ONLY content</b>
              <i *ngIf="!isServer">This is a CLIENT-ONLY content</i>
            `,
           })
           class DynamicComponent {
             isServer = isPlatformServer(inject(PLATFORM_ID));
           }

           @Component({
             standalone: true,
             selector: 'app',
             imports: [NgIf, NgFor],
             template: `
                <div #target></div>
                <main>Hi! This is the main content.</main>
              `,
           })
           class SimpleComponent {
             @ViewChild('target', {read: ViewContainerRef}) vcr!: ViewContainerRef;

             ngAfterViewInit() {
               const compRef = this.vcr.createComponent(DynamicComponent);
               compRef.changeDetectorRef.detectChanges();
             }
           }

           const html = await ssr(SimpleComponent);
           let ssrContents = getAppContents(html);

           // TODO: properly assert `ngh` attribute value once the `ngh`
           // format stabilizes, for now we just check that it's present.
           expect(ssrContents).toContain('<app ngh');

           resetTViewsFor(SimpleComponent, DynamicComponent);

           const appRef = await hydrate(html, SimpleComponent);
           const compRef = getComponentRef<SimpleComponent>(appRef);
           appRef.tick();

           ssrContents = stripExcessiveSpaces(stripUtilAttributes(ssrContents, false));

           // We expect to see SERVER content, but not CLIENT.
           expect(ssrContents).not.toContain('<i>This is a CLIENT-ONLY content</i>');
           expect(ssrContents).toContain('<b>This is a SERVER-ONLY content</b>');

           const clientRootNode = compRef.location.nativeElement;

           await whenStable(appRef);

           const clientContents =
               stripExcessiveSpaces(stripUtilAttributes(clientRootNode.outerHTML, false));

           // After the cleanup, we expect to see CLIENT content, but not SERVER.
           expect(clientContents).toContain('<i>This is a CLIENT-ONLY content</i>');
           expect(clientContents).not.toContain('<b>This is a SERVER-ONLY content</b>');
         });
    });
  });
});
