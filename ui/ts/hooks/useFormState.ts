import { useSignal } from '@preact/signals'

/**
 * Wraps a Preact signal with a typed updater setter — the same pattern used
 * across all form-holding hooks.
 *
 * Usage:
 *   const { state: myForm, setState: setMyForm } = useFormState(getDefaultMyFormState())
 *   // In the hook body: myForm.value
 *   // Returned to consumers: myForm.value and setMyForm
 */
export function useFormState<T>(defaultState: T) {
	const state = useSignal<T>(defaultState)
	const setState = (updater: (current: T) => T) => {
		state.value = updater(state.value)
	}
	return { state, setState }
}
