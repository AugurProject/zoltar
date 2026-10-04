import type { Address } from '@zoltar/core-shared/evm/ethereum'
import type { ZoltarUniverseSummary } from '@zoltar/ui-core-shared/types/contracts.js'
import { getWalletActiveAppChainGuardState } from '@zoltar/ui-core-shared/transactions/actionGuards.js'

export function getMigrationGuardMessage(accountAddress: Address | undefined, isOnActiveAppChain: boolean, rootUniverse: ZoltarUniverseSummary | undefined, loadingZoltarUniverse: boolean): string | undefined {
	const walletGuardState = getWalletActiveAppChainGuardState({ accountAddress, isOnActiveAppChain })
	if (walletGuardState.blocked) return walletGuardState.reason
	if (rootUniverse === undefined) return loadingZoltarUniverse ? undefined : 'Refresh universe first.'
	return undefined
}
