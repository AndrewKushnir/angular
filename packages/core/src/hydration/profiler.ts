/**
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */

import {global} from '../util/global';

const NG_DEV_MODE = typeof ngDevMode === 'undefined' || !!ngDevMode;

export const enum SsrPerfMetrics {
  /**
   * Total time it takes to process a request.
   */
  OverallSsrTime = 'Overall SSR time (in ms)',

  /**
   * Time it takes to serialize DOM (using Domino).
   */
  DomSerializationTime = 'Overall DOM serialization time (in ms)',

  /**
   * Total time it takes to hydrate
   */
  OverallHydrationTime = 'Overall hydration time (in ms)',

  /**
   * Total number of serialized components
   */
  SerializedComponents = 'Serialized Components',

  /**
   * Total number of serialized DOM nodes
   */
  SerializedDomNodes = 'Serialized DOM Nodes',

  /**
   * Total time it takes to hydrate
   */
  OverallHtmlSize = 'Overall HTML size (in character length)',

  /**
   * Total time it takes to hydrate
   */
  NghAnnotationSize = 'Hydration annotation size (in character length)',

  /**
   * Empty text nodes that needed to be restored
   */
  EmptyTextNodeCount = 'Empty Text Node count',

  /**
   * Number of compoents that do not require any NGH annotations
   */
  ComponentsWithEmptyNgh = 'Components with empty NGH'
}

interface TimespanMetric {
  start: number;
  end: number;
}

/**
 * The profiler for server side rendering performance metrics
 */
export class SsrProfiler {
  private metrics: Record<SsrPerfMetrics, TimespanMetric|number> = {
    [SsrPerfMetrics.OverallSsrTime]: this.initTimespanMetric(),
    [SsrPerfMetrics.DomSerializationTime]: this.initTimespanMetric(),
    [SsrPerfMetrics.OverallHydrationTime]: this.initTimespanMetric(),
    [SsrPerfMetrics.SerializedComponents]: 0,
    [SsrPerfMetrics.SerializedDomNodes]: 0,
    [SsrPerfMetrics.OverallHtmlSize]: 0,
    [SsrPerfMetrics.NghAnnotationSize]: 0,
    [SsrPerfMetrics.EmptyTextNodeCount]: 0,
    [SsrPerfMetrics.ComponentsWithEmptyNgh]: 0,
  };

  private initTimespanMetric(): TimespanMetric {
    return {start: 0, end: 0};
  }

  invokeAndMeasure<T>(functionToProfile: () => T, metric: SsrPerfMetrics): T {
    this.startTimespan(metric);
    const result = functionToProfile();
    this.stopTimespan(metric);
    return result;
  }

  startTimespan(metric: SsrPerfMetrics) {
    const _metric = this.metrics[metric] as {start: number};
    if (typeof _metric === 'object') {
      _metric.start = performance.now();
    }
  }

  stopTimespan(metric: SsrPerfMetrics) {
    const _metric = this.metrics[metric] as {end: number};
    if (typeof _metric === 'object') {
      if (_metric.end <= 0) {
        _metric.end = performance.now();
      } else {
        throw new Error(`We already stopped measuring for metric ${metric}.`);
      }
    }
  }

  incrementMetricValue(metric: SsrPerfMetrics, value: number) {
    const _metric = this.metrics[metric];
    if (typeof _metric === 'number') {
      (this.metrics[metric] as number) += value;
    }
  }

  serializeMetrics(): string {
    const overallSsTime = this.getMetric(SsrPerfMetrics.OverallSsrTime);
    const overallHydrationTime = this.getMetric(SsrPerfMetrics.OverallHydrationTime);
    const domSerializationTime = this.getMetric(SsrPerfMetrics.DomSerializationTime);
    const overallHtmlSize = this.getMetric(SsrPerfMetrics.OverallHtmlSize);
    const nghAnnotationSize = this.getMetric(SsrPerfMetrics.NghAnnotationSize);
    const serializedComponents = this.getMetric(SsrPerfMetrics.SerializedComponents);
    const componentsWithNoNgh = this.getMetric(SsrPerfMetrics.ComponentsWithEmptyNgh);

    const hydrationPercentage = (overallHydrationTime / overallSsTime) * 100;
    const domSerializationPercentage = (domSerializationTime / overallSsTime) * 100;
    const annotationPercentage = (nghAnnotationSize / overallHtmlSize) * 100;
    const noNghComponentPercentage = (componentsWithNoNgh / serializedComponents) * 100;

    return `\n
***** Performance results ***
Overall SSR time:          ${overallSsTime.toFixed(2)}ms
Hydration annotation time: ${overallHydrationTime.toFixed(2)}ms (${hydrationPercentage.toFixed(2)}%)
DOM serialization time:    ${domSerializationTime.toFixed(2)}ms (${
        domSerializationPercentage.toFixed(2)}%)

Components Serialized:     ${this.getMetric(SsrPerfMetrics.SerializedComponents)}
Components without ngh:    ${this.getMetric(SsrPerfMetrics.ComponentsWithEmptyNgh)} (${
        noNghComponentPercentage.toFixed(2)}%)
DOM Nodes Serialized:      ${this.getMetric(SsrPerfMetrics.SerializedDomNodes)}
Empty Text Nodes Restored: ${this.getMetric(SsrPerfMetrics.EmptyTextNodeCount)}

Overall HTML size:         ${toKilobytes(overallHtmlSize)}kb
NGH annotation size:       ${toKilobytes(nghAnnotationSize)}kb (${annotationPercentage.toFixed(2)}%)
*****************************
\n`;
  }

  getMetric(metric: SsrPerfMetrics): number {
    const _metric = this.metrics[metric];
    if (typeof _metric === 'object') {
      return _metric.end - _metric.start;
    }
    return this.metrics[metric] as number;
  }
}

function toKilobytes(chars: number): string{return (chars / 1024).toFixed(2)}

let currentProfiler: SsrProfiler|null = null;

export function enableSsrPeformanceProfiler(profiler?: SsrProfiler) {
  currentProfiler = profiler ?? new SsrProfiler();
}

export function disableSsrPeformanceProfiler() {
  currentProfiler = null;
}

export function isSsrProfilerEnabled(): boolean {
  return !!currentProfiler;
}

export function getSsrProfiler(): SsrProfiler|null {
  return currentProfiler;
}
