import type { Address } from '@zoltar/shared/ethereum'
import type { ZoltarUniverseSummary } from '../../../types/contracts.js'
import { getWalletActiveAppChainGuardState } from '../../../lib/actionGuards.js'

export function getMigrationGuardMessage(accountAddress: Address | undefined, isOnActiveAppChain: boolean, rootUniverse: ZoltarUniverseSummary | undefined, loadingZoltarForkAccess: boolean, hasForked: boolean, loadingZoltarUniverse: boolean, notForkedAction: string): string | undefined {
	const walletGuardState = getWalletActiveAppChainGuardState({ accountAddress, isOnActiveAppChain })
	if (walletGuardState.blocked) return walletGuardState.reason
	if (rootUniverse === undefined) return loadingZoltarUniverse ? undefined : 'Refresh universe first.'
	if (loadingZoltarForkAccess) return undefined
	if (!hasForked) return notForkedAction
	return undefined
}
