import { useState } from 'preact/hooks'

/** Holds a confirmation that applies only to the exact action `key` names; any other key, or none, reads as unconfirmed. */
export function useKeyedConfirmation(key: string | undefined) {
	const [confirmedKey, setConfirmedKey] = useState<string | undefined>(undefined)
	return { confirmed: key !== undefined && confirmedKey === key, setConfirmed: (confirmed: boolean) => setConfirmedKey(confirmed ? key : undefined) }
}
