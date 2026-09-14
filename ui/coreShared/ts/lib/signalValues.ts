import type { ReadonlySignal } from '@preact/signals'

type SignalValues<TSignals> = { readonly [TKey in keyof TSignals]: TSignals[TKey] extends ReadonlySignal<infer TValue> ? TValue : never }

// Build property descriptors without reading signals. Only the component that
// reads a property subscribes to it; spreading the result defeats this boundary.
export function signalValues<TSignals extends Record<string, ReadonlySignal<unknown>>>(signals: TSignals): SignalValues<TSignals> {
	const descriptors = Object.fromEntries(Object.entries(signals).map(([key, signal]) => [key, { enumerable: true, get: () => signal.value }]))
	return Object.defineProperties({}, descriptors) as SignalValues<TSignals>
}
