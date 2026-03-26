import type { Signal } from '@preact/signals'

export function setSignalValue<T>(signal: Signal<T>, value: T) {
	signal.value = value
}

export function updateSignalValue<T>(signal: Signal<T>, updater: (current: T) => T) {
	signal.value = updater(signal.value)
}
