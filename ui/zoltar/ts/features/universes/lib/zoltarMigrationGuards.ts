import type { Address } from '@zoltar/shared/ethereum'
import type { ZoltarUniverseSummary } from '@zoltar/ui-core-shared/types/contracts.js'
import { getWalletActiveAppChainGuardState } from '@zoltar/ui-core-shared/lib/actionGuards.js'

export function getMigrationGuardMessage(accountAddress: Address | undefined, isOnActiveAppChain: boolean, rootUniverse: ZoltarUniverseSummary | undefined, loadingZoltarForkAccess: boolean, _hasForked: boolean, loadingZoltarUniverse: boolean, _notForkedAction: string): string | undefined {
	const walletGuardState = getWalletActiveAppChainGuardState({ accountAddress, isOnActiveAppChain })
	if (walletGuardState.blocked) return walletGuardState.reason
	if (rootUniverse === undefined) return loadingZoltarUniverse ? undefined : 'Refresh universe first.'
	if (loadingZoltarForkAccess) return undefined
	return undefined
}
