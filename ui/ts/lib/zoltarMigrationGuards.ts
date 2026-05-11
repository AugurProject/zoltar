import type { Address } from 'viem'
import type { ZoltarUniverseSummary } from '../types/contracts.js'
import { getWalletPresentation } from './userCopy.js'

export function getMigrationGuardMessage(accountAddress: Address | undefined, isMainnet: boolean, rootUniverse: ZoltarUniverseSummary | undefined, loadingZoltarForkAccess: boolean, hasForked: boolean, loadingZoltarUniverse: boolean, notForkedAction: string): string | undefined {
	const walletPresentation = getWalletPresentation({ accountAddress, isMainnet })
	if (walletPresentation !== undefined) return walletPresentation.detail
	if (rootUniverse === undefined) return loadingZoltarUniverse ? undefined : 'Refresh universe first.'
	if (loadingZoltarForkAccess) return undefined
	if (!hasForked) return notForkedAction
	return undefined
}
