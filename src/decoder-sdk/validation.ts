import type {
  ArcLayerDef,
  ChartHints,
  Decoder,
  DecoderOutput,
  EventTypeDef,
  MessageInfo,
  MetricDef,
  Milestone,
  RGBA,
  StateDef,
} from './types';
import {
  EVENT_STRIDE,
  OP_LINK,
  OP_LOG,
  OP_METRIC,
  OP_PROGRESS,
  OP_STATE,
  OP_TRANSFER,
} from './types';

const MAX_SLOTS = 16;
const MAX_ISSUES = 24;

interface DecoderValidationIssue {
  path: string;
  message: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function pushIssue(issues: DecoderValidationIssue[], path: string, message: string): void {
  if (issues.length < MAX_ISSUES) issues.push({ path, message });
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value);
}

function isRgba(value: unknown): value is RGBA {
  return Array.isArray(value)
    && value.length === 4
    && value.every(channel => isFiniteNumber(channel));
}

function validateDefs<T>(
  defs: T[],
  label: string,
  issues: DecoderValidationIssue[],
): void {
  if (defs.length > MAX_SLOTS) {
    pushIssue(issues, label, 'max ' + MAX_SLOTS + ', got ' + defs.length);
  }
}

function validateStateDefs(states: StateDef[], issues: DecoderValidationIssue[]): void {
  validateDefs(states, 'states', issues);
  if (states.length === 0) pushIssue(issues, 'states', 'must contain at least one entry');
  states.forEach((state, idx) => {
    const path = 'states[' + idx + ']';
    if (!isRecord(state)) {
      pushIssue(issues, path, 'must be an object');
      return;
    }
    if (typeof state.name !== 'string' || state.name.length === 0) {
      pushIssue(issues, path + '.name', 'must be a non-empty string');
    }
    if (state.label !== undefined && typeof state.label !== 'string') {
      pushIssue(issues, path + '.label', 'must be a string when provided');
    }
    if (!isRgba(state.color)) pushIssue(issues, path + '.color', 'must be an RGBA tuple');
    if (typeof state.terminal !== 'boolean') {
      pushIssue(issues, path + '.terminal', 'must be a boolean');
    }
    if (state.initial !== undefined && typeof state.initial !== 'boolean') {
      pushIssue(issues, path + '.initial', 'must be a boolean when provided');
    }
    if (state.statsGroup !== undefined && typeof state.statsGroup !== 'string') {
      pushIssue(issues, path + '.statsGroup', 'must be a string when provided');
    }
    if (state.statsOrder !== undefined && !isInteger(state.statsOrder)) {
      pushIssue(issues, path + '.statsOrder', 'must be an integer when provided');
    }
  });
}

function validateArcLayers(layers: ArcLayerDef[], issues: DecoderValidationIssue[]): void {
  validateDefs(layers, 'arcLayers', issues);
  layers.forEach((layer, idx) => {
    const path = 'arcLayers[' + idx + ']';
    if (!isRecord(layer)) {
      pushIssue(issues, path, 'must be an object');
      return;
    }
    if (typeof layer.name !== 'string' || layer.name.length === 0) {
      pushIssue(issues, path + '.name', 'must be a non-empty string');
    }
    if (layer.label !== undefined && typeof layer.label !== 'string') {
      pushIssue(issues, path + '.label', 'must be a string when provided');
    }
    if (!isRgba(layer.color)) pushIssue(issues, path + '.color', 'must be an RGBA tuple');
    if (!isFiniteNumber(layer.lifetimeUs) || layer.lifetimeUs < 0) {
      pushIssue(issues, path + '.lifetimeUs', 'must be a non-negative number');
    }
    if (!isFiniteNumber(layer.travelUs) || layer.travelUs < 0) {
      pushIssue(issues, path + '.travelUs', 'must be a non-negative number');
    }
    if (!isFiniteNumber(layer.radius) || layer.radius < 0) {
      pushIssue(issues, path + '.radius', 'must be a non-negative number');
    }
  });
}

function validateMetrics(metrics: MetricDef[], issues: DecoderValidationIssue[]): void {
  validateDefs(metrics, 'metrics', issues);
  metrics.forEach((metric, idx) => {
    const path = 'metrics[' + idx + ']';
    if (!isRecord(metric)) {
      pushIssue(issues, path, 'must be an object');
      return;
    }
    if (typeof metric.name !== 'string' || metric.name.length === 0) {
      pushIssue(issues, path + '.name', 'must be a non-empty string');
    }
    if (metric.label !== undefined && typeof metric.label !== 'string') {
      pushIssue(issues, path + '.label', 'must be a string when provided');
    }
    if (metric.color !== undefined && !isRgba(metric.color)) {
      pushIssue(issues, path + '.color', 'must be an RGBA tuple when provided');
    }
    if (metric.format !== 'count' && metric.format !== 'bytes' && metric.format !== 'rate') {
      pushIssue(issues, path + '.format', 'must be one of count, bytes, rate');
    }
    if (metric.aggregate !== 'sum' && metric.aggregate !== 'last') {
      pushIssue(issues, path + '.aggregate', 'must be one of sum, last');
    }
    if (metric.overlay !== undefined && metric.overlay !== 'ring') {
      pushIssue(issues, path + '.overlay', 'must be undefined or "ring"');
    }
    if (metric.overlayGroup !== undefined && typeof metric.overlayGroup !== 'string') {
      pushIssue(issues, path + '.overlayGroup', 'must be a string when provided');
    }
    if (metric.overlayLabel !== undefined && typeof metric.overlayLabel !== 'string') {
      pushIssue(issues, path + '.overlayLabel', 'must be a string when provided');
    }
    if (metric.statsGroup !== undefined && typeof metric.statsGroup !== 'string') {
      pushIssue(issues, path + '.statsGroup', 'must be a string when provided');
    }
    if (metric.statsOrder !== undefined && !isInteger(metric.statsOrder)) {
      pushIssue(issues, path + '.statsOrder', 'must be an integer when provided');
    }
    if (metric.kind !== undefined && metric.kind !== 'nodeCount') {
      pushIssue(issues, path + '.kind', 'must be undefined or "nodeCount"');
    }
  });
}

function validateEventTypes(eventTypes: EventTypeDef[] | undefined, issues: DecoderValidationIssue[]): void {
  if (!eventTypes) return;
  eventTypes.forEach((eventType, idx) => {
    const path = 'eventTypes[' + idx + ']';
    if (!isRecord(eventType)) {
      pushIssue(issues, path, 'must be an object');
      return;
    }
    if (typeof eventType.code !== 'string' || eventType.code.length === 0) {
      pushIssue(issues, path + '.code', 'must be a non-empty string');
    }
    if (typeof eventType.name !== 'string' || eventType.name.length === 0) {
      pushIssue(issues, path + '.name', 'must be a non-empty string');
    }
    if (eventType.color !== undefined && typeof eventType.color !== 'string') {
      pushIssue(issues, path + '.color', 'must be a string when provided');
    }
  });
}

function validateHeader(
  header: DecoderOutput['header'],
  issues: DecoderValidationIssue[],
): void {
  header.nodes.forEach((node, idx) => {
    const path = 'header.nodes[' + idx + ']';
    if (!isRecord(node)) {
      pushIssue(issues, path, 'must be an object');
      return;
    }
    if (typeof node.name !== 'string' || node.name.length === 0) {
      pushIssue(issues, path + '.name', 'must be a non-empty string');
    }
    if (!isRecord(node.props)) pushIssue(issues, path + '.props', 'must be an object');
  });

  header.edges.forEach((edge, idx) => {
    const path = 'header.edges[' + idx + ']';
    if (!isRecord(edge)) {
      pushIssue(issues, path, 'must be an object');
      return;
    }
    if (!isInteger(edge.source) || edge.source < 0 || edge.source >= header.nodes.length) {
      pushIssue(issues, path + '.source', 'must reference a valid node index');
    }
    if (!isInteger(edge.target) || edge.target < 0 || edge.target >= header.nodes.length) {
      pushIssue(issues, path + '.target', 'must reference a valid node index');
    }
    if (!isFiniteNumber(edge.latency) || edge.latency < 0) {
      pushIssue(issues, path + '.latency', 'must be a non-negative number');
    }
  });
}

function validateMilestones(milestones: Milestone[], issues: DecoderValidationIssue[]): void {
  milestones.forEach((milestone, idx) => {
    const path = 'milestones[' + idx + ']';
    if (!isRecord(milestone)) {
      pushIssue(issues, path, 'must be an object');
      return;
    }
    if (!isFiniteNumber(milestone.time)) pushIssue(issues, path + '.time', 'must be a finite number');
    if (typeof milestone.label !== 'string') pushIssue(issues, path + '.label', 'must be a string');
    if (typeof milestone.color !== 'string') pushIssue(issues, path + '.color', 'must be a CSS color string');
  });
}

function validateMessages(
  messages: MessageInfo[] | undefined,
  issues: DecoderValidationIssue[],
): void {
  if (!messages) return;
  messages.forEach((message, idx) => {
    const path = 'messages[' + idx + ']';
    if (!isRecord(message)) {
      pushIssue(issues, path, 'must be an object');
      return;
    }
    if (typeof message.id !== 'string' || message.id.length === 0) {
      pushIssue(issues, path + '.id', 'must be a non-empty string');
    }
    if (!isFiniteNumber(message.firstTs)) pushIssue(issues, path + '.firstTs', 'must be a finite number');
    if (!isFiniteNumber(message.lastTs)) pushIssue(issues, path + '.lastTs', 'must be a finite number');
    if (isFiniteNumber(message.firstTs) && isFiniteNumber(message.lastTs) && message.lastTs < message.firstTs) {
      pushIssue(issues, path, 'lastTs must be greater than or equal to firstTs');
    }
    if (typeof message.label !== 'string') pushIssue(issues, path + '.label', 'must be a string');
  });
}

function validateChartHints(
  chartHints: ChartHints,
  stateCount: number,
  arcLayerCount: number,
  nodeCount: number,
  metricCount: number,
  issues: DecoderValidationIssue[],
): void {
  if (chartHints.cdf) {
    if (!isRecord(chartHints.cdf)) {
      pushIssue(issues, 'chartHints.cdf', 'must be an object');
    } else if (!isInteger(chartHints.cdf.stateIdx) || chartHints.cdf.stateIdx < 0 || chartHints.cdf.stateIdx >= stateCount) {
      pushIssue(issues, 'chartHints.cdf.stateIdx', 'must reference a valid state index');
    }
  }

  if (chartHints.bandwidth) {
    if (!isRecord(chartHints.bandwidth)) {
      pushIssue(issues, 'chartHints.bandwidth', 'must be an object');
    } else {
      if (!isInteger(chartHints.bandwidth.arcLayer) || chartHints.bandwidth.arcLayer < 0 || chartHints.bandwidth.arcLayer >= arcLayerCount) {
        pushIssue(issues, 'chartHints.bandwidth.arcLayer', 'must reference a valid arc layer index');
      }
      if (
        chartHints.bandwidth.originNode !== undefined
        && (!isInteger(chartHints.bandwidth.originNode)
          || chartHints.bandwidth.originNode < 0
          || chartHints.bandwidth.originNode >= nodeCount)
      ) {
        pushIssue(issues, 'chartHints.bandwidth.originNode', 'must reference a valid node index');
      }
    }
  }

  if (chartHints.race) {
    if (!isRecord(chartHints.race)) {
      pushIssue(issues, 'chartHints.race', 'must be an object');
    } else if (!isInteger(chartHints.race.stateIdx) || chartHints.race.stateIdx < 0 || chartHints.race.stateIdx >= stateCount) {
      pushIssue(issues, 'chartHints.race.stateIdx', 'must reference a valid state index');
    }
  }

  if (chartHints.series !== undefined) {
    if (!Array.isArray(chartHints.series)) {
      pushIssue(issues, 'chartHints.series', 'must be an array');
      return;
    }
    chartHints.series.forEach((series, idx) => {
      const path = 'chartHints.series[' + idx + ']';
      if (!isRecord(series)) {
        pushIssue(issues, path, 'must be an object');
        return;
      }
      if (typeof series.name !== 'string' || series.name.length === 0) {
        pushIssue(issues, path + '.name', 'must be a non-empty string');
      }
      if (!isInteger(series.metricIdx) || series.metricIdx < 0 || series.metricIdx >= metricCount) {
        pushIssue(issues, path + '.metricIdx', 'must reference a valid metric index');
      }
      if (typeof series.percentiles !== 'boolean') {
        pushIssue(issues, path + '.percentiles', 'must be a boolean');
      }
    });
  }
}

function validateEvents(output: DecoderOutput, issues: DecoderValidationIssue[]): void {
  const { buf, count, logTexts, eventTypeIdxs, peerNodeIdxs } = output.events;
  if (!(buf instanceof Float64Array)) pushIssue(issues, 'events.buf', 'must be a Float64Array');
  if (!isInteger(count) || count < 0) pushIssue(issues, 'events.count', 'must be a non-negative integer');
  if (buf.length !== count * EVENT_STRIDE) {
    pushIssue(issues, 'events.buf', 'length must equal events.count * EVENT_STRIDE');
    return;
  }
  if (eventTypeIdxs !== undefined && (!(eventTypeIdxs instanceof Int16Array) || eventTypeIdxs.length !== count)) {
    pushIssue(issues, 'events.eventTypeIdxs', 'must be an Int16Array with length events.count');
  }
  if (peerNodeIdxs !== undefined && (!(peerNodeIdxs instanceof Int32Array) || peerNodeIdxs.length !== count)) {
    pushIssue(issues, 'events.peerNodeIdxs', 'must be an Int32Array with length events.count');
  }

  const nodeCount = output.header.nodes.length;
  const stateCount = output.states.length;
  const arcLayerCount = output.arcLayers.length;
  const metricCount = output.metrics.length;
  const eventTypeCount = output.eventTypes?.length ?? 0;

  for (let i = 0; i < count && issues.length < MAX_ISSUES; i += 1) {
    const base = i * EVENT_STRIDE;
    const time = buf[base];
    const nodeIdx = buf[base + 1];
    const opcode = buf[base + 2];
    const field0 = buf[base + 3];
    const field1 = buf[base + 4];
    const field2 = buf[base + 5];
    const path = 'events[' + i + ']';

    if (eventTypeIdxs) {
      const eventTypeIdx = eventTypeIdxs[i];
      if (eventTypeIdx < -1 || eventTypeIdx >= eventTypeCount) {
        pushIssue(issues, path + '.eventTypeIdx', 'must reference a valid eventTypes index or -1');
      }
    }
    if (peerNodeIdxs) {
      const peerNodeIdx = peerNodeIdxs[i];
      if (peerNodeIdx < -1 || peerNodeIdx >= nodeCount) {
        pushIssue(issues, path + '.peerNodeIdx', 'must reference a valid node index or -1');
      }
    }

    if (!Number.isFinite(time)) pushIssue(issues, path + '.time', 'must be finite');
    if (!isInteger(nodeIdx) || nodeIdx < 0 || nodeIdx >= nodeCount) {
      pushIssue(issues, path + '.node', 'must reference a valid node index');
      continue;
    }
    if (!isInteger(opcode)) {
      pushIssue(issues, path + '.opcode', 'must be an integer');
      continue;
    }

    switch (opcode) {
      case OP_STATE:
        if (!isInteger(field0) || field0 < 0 || field0 >= stateCount) {
          pushIssue(issues, path + '.field0', 'state opcode must reference a valid state index');
        }
        break;
      case OP_TRANSFER:
        if (!isInteger(field0) || field0 < 0 || field0 >= nodeCount) {
          pushIssue(issues, path + '.field0', 'transfer opcode must reference a valid peer index');
        }
        if (!isFiniteNumber(field1) || field1 < 0) {
          pushIssue(issues, path + '.field1', 'transfer opcode bytes must be a non-negative number');
        }
        if (!isInteger(field2) || field2 < 0 || field2 >= arcLayerCount) {
          pushIssue(issues, path + '.field2', 'transfer opcode must reference a valid arc layer index');
        }
        break;
      case OP_PROGRESS:
        if (!isFiniteNumber(field0) || field0 < 0) {
          pushIssue(issues, path + '.field0', 'progress opcode have must be a non-negative number');
        }
        if (!isFiniteNumber(field1) || field1 < 0) {
          pushIssue(issues, path + '.field1', 'progress opcode need must be a non-negative number');
        }
        break;
      case OP_METRIC:
        if (!isInteger(field0) || field0 < 0 || field0 >= metricCount) {
          pushIssue(issues, path + '.field0', 'metric opcode must reference a valid metric index');
        }
        if (!isFiniteNumber(field1)) pushIssue(issues, path + '.field1', 'metric opcode value must be finite');
        break;
      case OP_LINK:
        if (!isInteger(field0) || field0 < 0 || field0 >= nodeCount) {
          pushIssue(issues, path + '.field0', 'link opcode must reference a valid peer index');
        }
        if (field1 !== 0 && field1 !== 1) {
          pushIssue(issues, path + '.field1', 'link opcode connected must be 0 or 1');
        }
        break;
      case OP_LOG:
        if (!isInteger(field0) || field0 < 0 || field0 >= logTexts.length) {
          pushIssue(issues, path + '.field0', 'log opcode must reference a valid log text index');
        }
        break;
      default:
        pushIssue(issues, path + '.opcode', 'unknown opcode ' + opcode);
        break;
    }
  }
}

function formatIssues(title: string, issues: DecoderValidationIssue[]): string {
  const lines = issues.map(issue => issue.path + ': ' + issue.message);
  return title + '\n' + lines.join('\n');
}

export function assertDecoder(value: unknown): asserts value is Decoder {
  if (!isRecord(value)) throw new Error('Decoder must be an object');
  if (typeof value.name !== 'string' || value.name.length === 0) {
    throw new Error('Decoder.name must be a non-empty string');
  }
  if (typeof value.version !== 'string' || value.version.length === 0) {
    throw new Error('Decoder.version must be a non-empty string');
  }
  if (typeof value.decode !== 'function') throw new Error('Decoder.decode must be a function');
}

export function validateDecoderOutput(output: DecoderOutput): DecoderOutput {
  const issues: DecoderValidationIssue[] = [];
  if (!isRecord(output.header.meta)) pushIssue(issues, 'header.meta', 'must be an object');
  validateHeader(output.header, issues);
  validateStateDefs(output.states, issues);
  validateArcLayers(output.arcLayers, issues);
  validateMetrics(output.metrics, issues);
  validateEventTypes(output.eventTypes, issues);
  validateMilestones(output.milestones, issues);
  validateMessages(output.messages, issues);
  validateChartHints(
    output.chartHints,
    output.states.length,
    output.arcLayers.length,
    output.header.nodes.length,
    output.metrics.length,
    issues,
  );
  validateEvents(output, issues);

  if (issues.length > 0) {
    throw new Error(formatIssues('Invalid decoder output', issues));
  }
  return output;
}
