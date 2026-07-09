import type { Address } from '@zoltar/shared/ethereum'
import type { ZoltarUniverseSummary } from '../types/contracts.js'

export function getMigrationGuardMessage(accountAddress: Address | undefined, isMainnet: boolean, rootUniverse: ZoltarUniverseSummary | undefined, loadingZoltarForkAccess: boolean, hasForked: boolean, loadingZoltarUniverse: boolean, notForkedAction: string): string | undefined {
	if (accountAddress === undefined) return 'Connect wallet to continue.'
	if (!isMainnet) return undefined
	if (rootUniverse === undefined) return loadingZoltarUniverse ? undefined : 'Refresh universe first.'
	if (loadingZoltarForkAccess) return undefined
	if (!hasForked) return notForkedAction
	return undefined
}
