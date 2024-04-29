/**
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */

import {createEventInfoFromParameters, EventInfo} from './event_info';

export class EventContractLight {
  public events: EventInfo[] = [];
  // ['click', clickHandler, 'input', inputHandler, ...]
  public listeners: Array<string | EventListener> = [];

  constructor(
    public namespace: string,
    public container: Element,
  ) {}

  addEvent(eventType: string) {
    const container = this.container;
    const listener = (event: Event) => {
      const target = event.target as Element;
      const eventInfo = createEventInfoFromParameters(
        /* eventType= */ eventType,
        /* event= */ event,
        /* targetElement= */ target,
        /* container= */ container,
        /* timestamp= */ Date.now(),
      );
      this.events.push(eventInfo);
    };
    this.listeners.push(eventType, listener);
    container.addEventListener(eventType, listener);
  }
}

export function disposeEventContract(ec: EventContractLight) {
  const listeners = ec.listeners;
  for (let i = 0; i < listeners.length; i += 2) {
    const eventType = listeners[i] as string;
    const listener = listeners[i + 1] as EventListener;
    ec.container.removeEventListener(eventType, listener);
  }
  ec.listeners = [];
  ec.events = [];
}
