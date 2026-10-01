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

export type FormStateSetter<T> = (updater: (current: T) => T) => void

/** Sets one form field, keeping the current form object when the value is unchanged. */
export function setFormField<T, K extends keyof T>(setForm: FormStateSetter<T>, key: K, value: T[K]) {
	setForm(current => (current[key] === value ? current : { ...current, [key]: value }))
}
