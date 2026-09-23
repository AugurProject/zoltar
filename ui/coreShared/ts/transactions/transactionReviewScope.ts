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
