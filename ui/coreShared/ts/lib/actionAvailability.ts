import type { ActionAvailability } from '../types/components.js'

export function pickFirstReason(...reasons: ReadonlyArray<string | undefined>) {
	for (const reason of reasons) {
		if (reason !== undefined) return reason
	}

	return undefined
}

export function createActionAvailability(...reasons: ReadonlyArray<string | undefined>): ActionAvailability {
	const reason = pickFirstReason(...reasons)
	return {
		disabled: reason !== undefined,
		reason,
	}
}
