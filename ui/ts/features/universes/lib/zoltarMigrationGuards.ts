import type { Address } from '@zoltar/shared/ethereum'
import type { ZoltarUniverseSummary } from '../../../types/contracts.js'
import { getWalletMainnetGuardState } from '../../../lib/actionGuards.js'

export function getMigrationGuardMessage(accountAddress: Address | undefined, isMainnet: boolean, rootUniverse: ZoltarUniverseSummary | undefined, loadingZoltarForkAccess: boolean, hasForked: boolean, loadingZoltarUniverse: boolean, notForkedAction: string): string | undefined {
	const walletGuardState = getWalletMainnetGuardState({ accountAddress, isMainnet })
	if (walletGuardState.blocked) return walletGuardState.reason
	if (rootUniverse === undefined) return loadingZoltarUniverse ? undefined : 'Refresh universe first.'
	if (loadingZoltarForkAccess) return undefined
	if (!hasForked) return notForkedAction
	return undefined
}
