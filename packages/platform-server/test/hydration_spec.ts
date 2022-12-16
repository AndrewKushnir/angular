/**
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */
// import '@angular/localize/init';

import {CommonModule, DOCUMENT, isPlatformServer, NgFor, NgIf, PlatformLocation, ɵgetDOM as getDOM,} from '@angular/common';
import {APP_ID, ApplicationRef, CompilerFactory, Component, ComponentRef, destroyPlatform, getPlatform, HostBinding, HostListener, importProvidersFrom, Inject, inject, Injectable, Injector, Input, NgModule, NgZone, OnInit, PLATFORM_ID, PlatformRef, Provider, Type, ViewEncapsulation, ɵsetDocument,} from '@angular/core';
import {TestBed, waitForAsync} from '@angular/core/testing';
import {bootstrapApplication, makeStateKey, TransferState} from '@angular/platform-browser';

import {renderApplication} from '../src/utils';

function getAppContents(html: string): string {
  // Drop `ng-version` and `ng-server-context` attrs,
  // so that it's easier to make assertions in tests.
  html = html.replace(/ ng-version=".*?"/, '')  //
             .replace(/ ng-server-context=".*?"/, '');
  const result = html.match(/<body>(.*?)<\/body>/s);
  if (!result) {
    throw new Error('App not found!');
  }
  return result[1];
}

function hydrateApplication(type: Type<unknown>, options: {providers: Provider[]}) {
  // ...
  const applicationRef = null! as ApplicationRef;
  return Promise.resolve(applicationRef);
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

function getAppRootNode(appRef: ApplicationRef): Element {
  return getComponentRef(appRef).location.nativeElement;
}

function verifyAllNodesHydrated(el: any) {
  if (!el.__hydrated) {
    fail('Hydration error: the node is *not* hydrated: ' + el.outerHTML);
  }
  let current = el.firstChild;
  while (current) {
    verifyAllNodesHydrated(current);
    current = current.nextSibling;
  }
}

// if (getDOM().supportsDOMEvents) return;  // NODE only

describe('platform-server integration', () => {
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
      ];
      return bootstrapApplication(component, {providers});
    }

    /**
     * Helper function that server-side renders a standalone component
     * and after that tries to hydrate it.
     */
    async function ssrAndHydrate(component: Type<unknown>): Promise<ApplicationRef> {
      const html = await ssr(component);
      return hydrate(html, component);
    }

    it('should work with simple components', async () => {
      @Component({
        standalone: true,
        selector: 'nested',
        template: `<span>Nested content</span>`,
      })
      class NestedComponent {
      }

      @Component({
        standalone: true,
        selector: 'app',
        imports: [NgIf, NestedComponent],
        template: `
          <div>
            <!-- <span>Content: {{visible}}</span> -->
            <i *ngIf="!isServer">Client</i>
            <b *ngIf="isServer">Server</b>
            <nested></nested>
          </div>
        `,
      })
      class SimpleComponentOrig {
        isServer = true;  // isPlatformServer(inject(PLATFORM_ID));
      }

      @Component({
        standalone: true,
        selector: 'app',
        imports: [NgIf, NestedComponent],
        template: `
          <div>
            <ng-container *ngIf="!isServer">Client</ng-container>
            <ng-container *ngIf="isServer">Server</ng-container>
          </div>
        `,
      })
      class SimpleComponent2 {
        isServer = true;  // isPlatformServer(inject(PLATFORM_ID));
      }

      @Component({
        standalone: true,
        imports: [CommonModule],
        selector: 'projector-cmp',
        template:
            '<main>Projected content: <ng-container *ngIf="true"><ng-content></ng-content></ng-container></main>',
      })
      class ProjectorCmp {
      }

      @Component({
        standalone: true,
        imports: [ProjectorCmp],
        selector: 'app',
        template: `
          <p>Counter: {{ count }}</p>
          <projector-cmp>
            <div (click)="increment()">{{ count }}</div>
          </projector-cmp>
        `,
      })
      class SimpleComponent {
        count = 0;
        increment() {
          this.count++;
        }
      }

      const html = await ssr(SimpleComponent);
      const appContents = getAppContents(html);

      // <div> [0 - right]
      //   <!-- container --> [1]
      //   <b>
      //     text
      //   </b>
      //   <!-- container --> [2]
      // </div>
      //
      // 0: host.firstChild
      // 1: host.firstChild.firstChild
      // 2: host.firstChild.firstChild.nextSibling.nextSibling
      expect(appContents).toBe('.....');
      debugger;

      // Reset TView, so that we re-enter the first create pass as
      // we would normally do when we hydrate on the client.
      // TODO: find a better way to do that in tests, because there
      // might be nested components that would require the same.
      (SimpleComponent as any).ɵcmp.tView = null;
      (ProjectorCmp as any).ɵcmp.tView = null;

      const appRef = await hydrate(html, SimpleComponent);
      const compRef = getComponentRef<SimpleComponent>(appRef);
      appRef.tick();
      const rootNode = compRef.location.nativeElement;

      expect(rootNode.outerHTML).toBe('...');

      debugger;
    });

    fit('should work with *ngFor', async () => {
      @Component({
        standalone: true,
        selector: 'app',
        imports: [NgIf, NgFor],
        template: `
          <div>
            <span *ngFor="let item of items">
              {{ item }}
              <ng-container *ngIf="item > 15">Bigger than 15!</ng-container>
            </span>
            <p>Hi!</p>
          </div>
        `,
      })
      class SimpleComponent {
        isServer = isPlatformServer(inject(PLATFORM_ID));
        items = this.isServer ? [10, 20] : [30, 40, 50];
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

      expect(rootNode.outerHTML).toBe('...');

      debugger;
    });
  });
});
