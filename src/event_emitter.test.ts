import { describe, expect, it } from 'vitest';
import { EventEmitter } from './event_emitter';

// A small fixed event map, standing in for what a real MapWidget/Layer/TileSource consumer would
// declare for itself (see event_emitter.ts's header comment) — just enough shapes to exercise
// payload typing without pulling in any of the map/tile code EVT-1 doesn't touch.
type TestEvents = {
  move: { x: number; y: number };
  ping: undefined;
};

describe('EventEmitter', () => {
  it('calls a subscribed listener when the event fires, with the payload passed through', () => {
    const emitter = new EventEmitter<TestEvents>();
    let received: { x: number; y: number } | null = null;
    emitter.on('move', (data) => {
      received = data;
    });
    emitter.fire('move', { x: 1, y: 2 });
    expect(received).toEqual({ x: 1, y: 2 });
  });

  it('calls every listener subscribed to the same event, in subscription order', () => {
    const emitter = new EventEmitter<TestEvents>();
    const calls: string[] = [];
    emitter.on('move', () => calls.push('first'));
    emitter.on('move', () => calls.push('second'));
    emitter.fire('move', { x: 0, y: 0 });
    expect(calls).toEqual(['first', 'second']);
  });

  it('firing an event with no listeners is a silent no-op', () => {
    const emitter = new EventEmitter<TestEvents>();
    expect(() => emitter.fire('move', { x: 0, y: 0 })).not.toThrow();
  });

  it('off() removes only the specified listener, leaving others subscribed', () => {
    const emitter = new EventEmitter<TestEvents>();
    const calls: string[] = [];
    const first = () => calls.push('first');
    const second = () => calls.push('second');
    emitter.on('move', first);
    emitter.on('move', second);
    emitter.off('move', first);
    emitter.fire('move', { x: 0, y: 0 });
    expect(calls).toEqual(['second']);
  });

  it('off() with a handler that was never subscribed (or already removed) is a no-op', () => {
    const emitter = new EventEmitter<TestEvents>();
    const handler = () => {};
    expect(() => emitter.off('move', handler)).not.toThrow();
    emitter.on('move', handler);
    emitter.off('move', handler);
    expect(() => emitter.off('move', handler)).not.toThrow();
  });

  it('once() fires exactly once, then auto-unsubscribes', () => {
    const emitter = new EventEmitter<TestEvents>();
    let count = 0;
    emitter.once('move', () => {
      count++;
    });
    emitter.fire('move', { x: 0, y: 0 });
    emitter.fire('move', { x: 0, y: 0 });
    expect(count).toBe(1);
  });

  it('on()/once() return an unsubscribe function equivalent to calling off()', () => {
    const emitter = new EventEmitter<TestEvents>();
    let count = 0;
    const unsubscribe = emitter.on('move', () => {
      count++;
    });
    emitter.fire('move', { x: 0, y: 0 });
    unsubscribe();
    emitter.fire('move', { x: 0, y: 0 });
    expect(count).toBe(1);
  });

  it('a handler calling off() on itself mid-fire does not disturb the current dispatch, and takes effect on the next fire()', () => {
    const emitter = new EventEmitter<TestEvents>();
    const calls: string[] = [];
    const selfRemoving = () => {
      calls.push('self');
      emitter.off('move', selfRemoving);
    };
    emitter.on('move', selfRemoving);
    emitter.on('move', () => calls.push('after'));

    emitter.fire('move', { x: 0, y: 0 });
    expect(calls).toEqual(['self', 'after']); // both ran during the first fire...

    calls.length = 0;
    emitter.fire('move', { x: 0, y: 0 });
    expect(calls).toEqual(['after']); // ...but selfRemoving is gone by the second.
  });

  it('a handler calling off() on a sibling listener mid-fire does not skip or crash on it — the sibling still runs this round', () => {
    const emitter = new EventEmitter<TestEvents>();
    const calls: string[] = [];
    const sibling = () => calls.push('sibling');
    const remover = () => {
      calls.push('remover');
      emitter.off('move', sibling);
    };
    emitter.on('move', remover);
    emitter.on('move', sibling);

    emitter.fire('move', { x: 0, y: 0 });
    expect(calls).toEqual(['remover', 'sibling']); // fire() dispatched from a pre-fire snapshot

    calls.length = 0;
    emitter.fire('move', { x: 0, y: 0 });
    expect(calls).toEqual(['remover']); // sibling is gone from here on
  });

  it('independent event names have independent listener lists', () => {
    const emitter = new EventEmitter<TestEvents>();
    const moveCalls: unknown[] = [];
    const pingCalls: unknown[] = [];
    emitter.on('move', (d) => moveCalls.push(d));
    emitter.on('ping', (d) => pingCalls.push(d));

    emitter.fire('ping', undefined);
    expect(moveCalls).toEqual([]);
    expect(pingCalls).toEqual([undefined]);
  });
});
