import type { OperatorSnapshot } from '#state/operator-state'
import type { Address } from '@zoltar/bot-shared/ethereum'

/** Keep the startup conflict visible until execution is armed or the active signer changes. */
export function createSignerConflictSnapshot(startupConflict: string | undefined, initialWallet: Address | undefined) {
	let conflict = startupConflict
	return (snapshot: OperatorSnapshot): OperatorSnapshot => {
		if (snapshot.execute || snapshot.wallet !== initialWallet) conflict = undefined
		return conflict === undefined ? snapshot : { ...snapshot, lastError: conflict }
	}
}
