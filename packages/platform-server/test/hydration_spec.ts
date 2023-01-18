/**
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */
import '@angular/localize/init';

import {CommonModule, DOCUMENT, isPlatformServer, NgFor, NgIf, NgTemplateOutlet, PlatformLocation, ɵgetDOM as getDOM,} from '@angular/common';
import {APP_ID, ApplicationRef, CompilerFactory, Component, ComponentRef, destroyPlatform, Directive, getPlatform, HostBinding, HostListener, importProvidersFrom, Inject, inject, Injectable, Injector, Input, NgModule, NgZone, OnInit, PLATFORM_ID, PlatformRef, Provider, Type, ViewChild, ViewContainerRef, ViewEncapsulation, ɵprovideHydrationSupport, ɵsetDocument,} from '@angular/core';
import {TestBed, waitForAsync} from '@angular/core/testing';
import {bootstrapApplication, makeStateKey, TransferState} from '@angular/platform-browser';
import {first} from 'rxjs/operators';

import {renderApplication} from '../src/utils';

function getAppContents(html: string): string {
  // Drop `ng-version` and `ng-server-context` attrs,
  // so that it's easier to make assertions in tests.
  html = html.replace(/ ng-version=".*?"/g, '')  //
             .replace(/ ng-server-context=".*?"/g, '');
  const result = html.match(/<body>(.*?)<\/body>/s);
  if (!result) {
    throw new Error('App not found!');
  }
  return result[1];
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
  const clientContents = clientAppRootElement.outerHTML.replace(/ ng-version=".*?"/g, '');
  ssrContents = ssrContents.replace(/ ngh=".*?"/g, '');
  expect(clientContents).toBe(ssrContents, 'Client and server contents mismatch');
}

function verifyAllNodesClaimedForHydration(el: any) {
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

    async function ssr(component: Type<unknown>): Promise<string> {
      const document = '<html><head></head><body><app></app></body></html>';
      return renderApplication(component, {document, appId});
    }

    async function hydrate(html: string, component: Type<unknown>): Promise<ApplicationRef> {
      // Destroy existing platform, a new one will be created later in `hydrateApplication`.
      destroyPlatform();

      // Get HTML contents of the `<app>`, create a DOM element and append it into the body.
      const container = getAppDOM(html, doc);
      const app = container.querySelector('app')!;
      doc.body.appendChild(app);

      // Also bring the serialized state.
      // Domino doesn't support complex selectors like `[id="simple-cmp-state"]` :(
      const serializedStateScript = container.querySelector('script');
      if (serializedStateScript) {
        doc.body.appendChild(serializedStateScript);
      }

      function _document(): any {
        ɵsetDocument(doc);
        global.document = doc;  // needed for `DefaultDomRenderer2`
        return doc;
      }

      const providers = [
        {provide: APP_ID, useValue: appId},
        {provide: DOCUMENT, useFactory: _document, deps: []},
        ɵprovideHydrationSupport(),
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

        debugger;

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

      // TODO: this test fails when invoked with other tests,
      // find and fix test state leakage.
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

    // FIXME: this test needs additional work...
    xdescribe('*ngFor', () => {
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
        const appContents = getAppContents(html);

        expect(appContents).toBe('.....');
        debugger;

        // Reset TView, so that we re-enter the first create pass as
        // we would normally do when we hydrate on the client.
        // TODO: find a better way to do that in tests, because there
        // might be nested components that would require the same.
        (SimpleComponent as any).ɵcmp.tView = null;

        const appRef = await hydrate(html, SimpleComponent);
        const compRef = getComponentRef<SimpleComponent>(appRef);
        appRef.tick();
        const rootNode = compRef.location.nativeElement;

        // Pre-cleanup
        expect(rootNode.outerHTML).toBe('...');
        debugger;

        await appRef.isStable.pipe(first((isStable: boolean) => isStable)).toPromise();
        debugger;

        // Post-cleanup
        expect(rootNode.outerHTML).toBe('...');

        setTimeout(() => {
          const a = appRef;
          debugger;
        }, 0);
      });
    });

    describe('NgTemplateOutlet', () => {
      // TODO: this test fails when invoked with other tests,
      // find and fix test state leakage.
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
        debugger;

        // TODO: properly assert `ngh` attribute value once the `ngh`
        // format stabilizes, for now we just check that it's present.
        expect(ssrContents).toContain('<app ngh');
        debugger;

        resetTViewsFor(SimpleComponent);

        const appRef = await hydrate(html, SimpleComponent);
        const compRef = getComponentRef<SimpleComponent>(appRef);
        appRef.tick();

        const clientRootNode = compRef.location.nativeElement;
        debugger;
        verifyAllNodesClaimedForHydration(clientRootNode);
        verifyClientAndSSRContentsMatch(ssrContents, clientRootNode);
      });
    });

    // TODO: also add a test where `ViewContainerRef.createComponent`
    // is used inside a component that is created dynamically.
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
    });
  });
});
