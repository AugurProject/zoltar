import { signal } from '@preact/signals'

const modalScopes = signal<readonly AbortSignal[]>([])

// Capture the scope when a reviewed client is created, so opening another dialog
// cannot move an existing workflow or let it outlive its initiating form.
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
