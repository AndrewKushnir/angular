/**
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */
import '@angular/localize/init';

import {CommonModule, DOCUMENT, isPlatformServer, PlatformLocation, ɵgetDOM as getDOM} from '@angular/common';
import {APP_ID, ApplicationRef, CompilerFactory, Component, destroyPlatform, getPlatform, HostBinding, HostListener, importProvidersFrom, Inject, inject, Injectable, Injector, Input, NgModule, NgZone, OnInit, PLATFORM_ID, PlatformRef, Type, ViewEncapsulation, ɵclearTrackedLViews} from '@angular/core';
import {TestBed, waitForAsync} from '@angular/core/testing';
import {bootstrapApplication, makeStateKey, TransferState} from '@angular/platform-browser';
import {hydrateApplication} from '@angular/platform-browser/src/browser';

import {renderApplication} from '../src/utils';

function getAppContents(output: string): string {
  const result = output.match(/<body>(.*?)<\/body>/sg);
  if (!result) {
    throw new Error('App not found!');
  }
  return result[0];
}

function getAppDOM(output: string, doc: Document): HTMLElement {
  const contents = getAppContents(output);
  const container = doc.createElement('div');
  container.innerHTML = contents;
  return container;
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
    let doc: Document;

    beforeEach(() => {
      doc = TestBed.inject(DOCUMENT);
    });
    afterEach(() => {
      // First child is the `<app>` element.
      doc.body.firstChild!.remove();
    });

    async function hydrateAfterSSR(component: Type<unknown>): Promise<ApplicationRef> {
      ɵclearTrackedLViews();
      const appId = 'simple-cmp';
      const document = '<html><head></head><body><app></app></body></html>';
      const ssrOutput = await renderApplication(component, {document, appId});

      debugger;

      destroyPlatform();

      // Get HTML contents of the `<app>`, create a DOM element and append it into the body.
      const container = getAppDOM(ssrOutput, doc);
      const app = container.querySelector('app')!;
      doc.body.appendChild(app);

      // Also bring the serialized state.
      // Domino doesn't support complex selectors like `[id="simple-cmp-state"]` :(
      const serializedStateScript = container.querySelector('script');
      if (serializedStateScript) {
        doc.body.appendChild(serializedStateScript);
      }

      // Reset all tracked LViews, since we transition from the server -> client.
      ɵclearTrackedLViews();
      const providers = [
        {provide: APP_ID, useValue: appId},
        {provide: DOCUMENT, useValue: doc},
      ];
      return hydrateApplication(component, {providers});
    }

    // Run the set of tests with regular and standalone components.
    it(`using hydrateApplication should work`, async () => {
      @Component({
        standalone: true,
        imports: [CommonModule],
        selector: 'content-cmp',
        template: '<span>This is a content projected from another component!</span>',
      })
      class ContentCmp {
      }

      @Component({
        standalone: true,
        imports: [CommonModule],
        selector: 'projector-cmp',
        template: '<p>Projected content: <ng-content></ng-content></p>',
      })
      class ProjectorCmp {
      }

      @Component({
        standalone: true,
        imports: [CommonModule, ContentCmp, ProjectorCmp],
        selector: 'app',
        template: `
          <div (click)="increment()">Increment</div>
          <span>{{placeholder}}</span>
        `,
      })
      class SimpleStandaloneComp {
        placeholder = '';
        items = [1, 2, 3];
        count = 0;
        increment() {
          this.count++;
        }
      }

      const appRef = await hydrateAfterSSR(SimpleStandaloneComp);
      const el = appRef.components[0].location.nativeElement;
      verifyAllNodesHydrated(el);
      const target = el.querySelector('div');
      target.click();
      debugger;
      // TODO: run more tests and checks here...
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

      /*

                <h1>This is a chat app</h1>
          <h2 *ngIf="loading"><span *ngIf="loading"><span
         *ngIf="loading">Loading!</span></span></h2> <h3 *ngIf="!loading"><span
         *ngIf="!loading"><span *ngIf="!loading">Not Loading!</span></span></h3> <ng-container
         *ngIf="!loading"> <div *ngFor="let comment of comments"> [Comment #{{comment.id}}]
              {{comment.author}} said: {{comment.content}}
            </div>
          </ng-container>


            <ng-template [ngIf]="loading">
              <b>The content is loading...</b>
            </ng-template>
      */
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
          <h1>Hi</h1>
          <ng-template [ngIf]="isServer">
            <div>This is SERVER</div>
          </ng-template>
          <ng-template [ngIf]="!isServer">
            <div>This is BROWSER</div>
          </ng-template>
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

      const appRef = await hydrateAfterSSR(SimpleStandaloneComp);
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
