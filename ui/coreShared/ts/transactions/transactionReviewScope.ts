import { signal } from '@preact/signals'

const modalScopes = signal<readonly AbortSignal[]>([])

// Capture before asynchronous preparation and pass the signal to reviewed clients,
// so opening another dialog cannot move an action out of its initiating form.
export function getTransactionReviewSignal() {
	return modalScopes.peek().at(-1)
}

export function registerTransactionReviewScope(scope: AbortSignal) {
	modalScopes.value = [...modalScopes.peek(), scope]
	return () => {
		modalScopes.value = modalScopes.peek().filter(candidate => candidate !== scope)
	}
}

export function isEmbeddedTransactionReview(scope: AbortSignal | undefined) {
	return scope !== undefined && modalScopes.value.includes(scope)
}

// The price form prepares its funding plan before the user presses any transaction button.
// Only these explicitly registered scopes wait for that first action in the form.
const preparationScopes = new WeakSet<AbortSignal>()

export function registerTransactionPreparationScope(scope: AbortSignal) {
	preparationScopes.add(scope)
	return () => preparationScopes.delete(scope)
}

export function isTransactionPreparationScope(scope: AbortSignal | undefined) {
	return scope !== undefined && preparationScopes.has(scope)
}
