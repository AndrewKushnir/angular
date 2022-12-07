/**
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */
import '@angular/localize/init';

import {CommonModule, DOCUMENT, isPlatformServer, NgIf, PlatformLocation, ɵgetDOM as getDOM} from '@angular/common';
import {APP_ID, ApplicationRef, CompilerFactory, Component, ComponentRef, destroyPlatform, getPlatform, HostBinding, HostListener, importProvidersFrom, Inject, inject, Injectable, Injector, Input, NgModule, NgZone, OnInit, PLATFORM_ID, PlatformRef, Type, ViewEncapsulation} from '@angular/core';
import {TestBed, waitForAsync} from '@angular/core/testing';
import {bootstrapApplication, makeStateKey, TransferState} from '@angular/platform-browser';
import {hydrateApplication} from '@angular/platform-browser/src/browser';

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

(function() {
if (getDOM().supportsDOMEvents) return;  // NODE only

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

      const providers = [
        {provide: APP_ID, useValue: appId},
        {provide: DOCUMENT, useValue: doc},
      ];
      return hydrateApplication(component, {providers});
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
        selector: 'app',
        template: 'Hi!',
      })
      class SimpleComponent {
      }

      const html = await ssr(SimpleComponent);
      const appContents = getAppContents(html);
      expect(appContents).toBe('<app ngh="r0|0">Hi!<!r0:0?0></app>');

      const appRef = await hydrate(html, SimpleComponent);
      const root = getAppRootNode(appRef);
      verifyAllNodesHydrated(root);
    });

    it('should work with simple components and `*ngIf`s', async () => {
      @Component({
        standalone: true,
        selector: 'app',
        imports: [NgIf],
        template: `
          <div>
            <i *ngIf="!visible">Not visible</i>
            <b *ngIf="visible">Visible</b>
          </div>
        `,
      })
      class SimpleComponent {
        visible = true;
      }

      const html = await ssr(SimpleComponent);
      const appContents = getAppContents(html);
      const expected =  //
          '<app ngh="r0|0">' +
          '<div ngh="r0:0|0">' +
          '<!r0:0|1>' +  // This is an anchor node for the `<i *ngIf="!visible">` view.
          '<b ngh="r0:0:2+0|0">Visible<!r0:0:2+0?1></b><!r0:0|2>' +
          '</div>' +
          '</app>';
      expect(appContents).toBe(expected);

      const appRef = await hydrate(html, SimpleComponent);
      const compRef = getComponentRef<SimpleComponent>(appRef);
      const rootNode = compRef.location.nativeElement;

      verifyAllNodesHydrated(rootNode);

      expect(rootNode.querySelector('b').outerHTML).toBe('<b>Visible</b>');
      expect(rootNode.querySelector('i')).toBe(undefined);

      // Toggle visibility.
      compRef.instance.visible = false;
      compRef.changeDetectorRef.detectChanges();

      expect(rootNode.querySelector('i').outerHTML).toBe('<i>Not visible</i>');
      expect(rootNode.querySelector('b')).toBe(undefined);
    });

    it('should work with elements that have listeners', async () => {
      @Component({
        standalone: true,
        selector: 'app',
        template: '<div (click)="increment()">{{ count }}</div>',
      })
      class ComponentWithListeners {
        count = 0;
        increment() {
          this.count++;
        }
      }

      const html = await ssr(ComponentWithListeners);
      const appContents = getAppContents(html);
      debugger;
      expect(appContents)  //
          .toBe('<app ngh="r0|0"><div ngh="r0:0|0">0<!r0:0?1></div></app>');

      const appRef = await hydrate(html, ComponentWithListeners);
      const compRef = getComponentRef<ComponentWithListeners>(appRef);
      const rootNode = compRef.location.nativeElement;

      verifyAllNodesHydrated(rootNode);

      expect(compRef.instance.count).toBe(0);

      // Simulate a click event.
      const div = rootNode.querySelector('div');
      div.click();
      compRef.changeDetectorRef.detectChanges();

      expect(compRef.instance.count).toBe(1);
      expect(div.textContent).toBe('1');
    });

    it('should work with simple content projection', async () => {
      @Component({
        standalone: true,
        imports: [CommonModule],
        selector: 'projector-cmp',
        template: 'Projected content: <ng-content></ng-content>',
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
      class RootComp {
        count = 0;
        increment() {
          this.count++;
        }
      }

      const html = await ssr(RootComp);
      const appContents = getAppContents(html);
      const expected =  //
          '<app ngh="r0|0">' +
          '<p ngh="r0:0|0">Counter: 0<!r0:0?1></p>' +
          '<projector-cmp ngh="r0:0|2">Projected content: <!r0:0:2?0>' +
          '<div ngh="r0:0|3">0<!r0:0?4></div>' +
          '</projector-cmp>' +
          '</app>';
      expect(appContents).toBe(expected);

      const appRef = await hydrate(html, RootComp);
      const compRef = getComponentRef<RootComp>(appRef);
      const rootNode = compRef.location.nativeElement;

      verifyAllNodesHydrated(rootNode);

      expect(compRef.instance.count).toBe(0);

      // Simulate a click event.
      const div = rootNode.querySelector('div');
      div.click();
      compRef.changeDetectorRef.detectChanges();

      expect(compRef.instance.count).toBe(1);
      expect(div.textContent).toBe('1');

      const p = rootNode.querySelector('p');
      expect(p.textContent).toBe('Counter: 1');
    });

    fit(`using hydrateApplication should work`, async () => {
      const dataFromServer = {
        comments: [
          {id: 1, author: 'Andrew', content: 'Hello'},
          {id: 2, author: 'Alex', content: 'Hi!'},
          {id: 3, author: 'Andrew', content: 'What\'s up?'},
        ]
      };
      const COMMENTS_KEY = makeStateKey<any>('comments');
      @Component({
        standalone: true,
        imports: [CommonModule],
        selector: 'projector-cmp',
        template: '<article>Projected content: <ng-content></ng-content></article>',
      })
      class ProjectorCmp {
      }

      @Component({
        standalone: true,
        imports: [CommonModule, ProjectorCmp],
        selector: 'app',
        template: `
          <h1>Hi, this is a chat app!</h1>
          <h2 *ngIf="loading">Loading...</h2>
          <h2 *ngIf="!loading">Loaded! <span *ngIf="!loading">(not loading)</span></h2>
          <div *ngFor="let comment of comments">
            [Comment #{{comment.id}}]
            {{comment.author}} said: {{comment.content}}
          </div>
        `,
      })
      class SimpleStandaloneComp {
        loading = true;
        loggedIn = true;
        items = [1, 2];
        comments: any[] = [];
        isServer = isPlatformServer(inject(PLATFORM_ID));
        serverState = inject(TransferState);

        ngOnInit() {
          debugger;
          if (this.isServer) {
            setTimeout(() => {
              // As if we are doing an HTTP request...
              // ... and storing the result in the transfer state object.
              this.comments = dataFromServer.comments;
              this.loading = false;
              this.serverState.set(COMMENTS_KEY, dataFromServer.comments);
            });
          } else {
            this.comments = this.serverState.get(COMMENTS_KEY, []);
            this.loading = false;
          }
        }
      }

      const appRef = await ssrAndHydrate(SimpleStandaloneComp);
      const el = appRef.components[0].location.nativeElement;

      debugger;
      verifyAllNodesHydrated(el);
      // const target = el.querySelector('div');
      // target.click();
      debugger;
      // TODO: run more tests and checks here...
    });
  });
});
})();
