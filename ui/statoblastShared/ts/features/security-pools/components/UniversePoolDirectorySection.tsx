import { RetryableNotice } from '@zoltar/ui-core-shared/components/RetryableNotice.js'
import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js'
import * as securityPoolCopy from '../../../copy/securityPool.js'
import { CurrencyValue } from '@zoltar/ui-core-shared/components/CurrencyValue.js'
import { StateHint } from '@zoltar/ui-core-shared/components/StateHint.js'
import { UniverseBrowser } from '@zoltar/ui-core-shared/components/UniverseBrowser.js'
import type { ListedSecurityPool, ZoltarUniverseSummary } from '@zoltar/ui-core-shared/types/contracts.js'

type UniversePoolDirectorySectionProps = {
	activeUniverseId: bigint
	loadingSecurityPools?: boolean | undefined
	onRetry?: (() => void) | undefined
	securityPoolError?: string | undefined
	securityPools?: ListedSecurityPool[] | undefined
	zoltarUniverse: ZoltarUniverseSummary | undefined
}

function getUniversePoolMetrics(universeId: bigint, securityPools: ListedSecurityPool[]) {
	return securityPools.reduce(
		(metrics, pool) => {
			if (pool.universeId !== universeId) return metrics
			return {
				poolCount: metrics.poolCount + 1n,
				totalPoolHeldAttoRep: metrics.totalPoolHeldAttoRep + pool.totalPoolHeldAttoRep,
				vaultCount: metrics.vaultCount + pool.vaultCount,
			}
		},
		{ poolCount: 0n, totalPoolHeldAttoRep: 0n, vaultCount: 0n },
	)
}

function UniversePoolMetrics({ securityPools, universeId }: { securityPools: ListedSecurityPool[]; universeId: bigint }) {
	const metrics = getUniversePoolMetrics(universeId, securityPools)
	return (
		<>
			<p className='decision-amount'>
				<CurrencyValue value={metrics.totalPoolHeldAttoRep} suffix={commonCopy.rep} />
			</p>
			<p className='detail'>{securityPoolCopy.totalPoolHeldAttoRep}</p>
			<p className='inline-facts'>
				<span>{securityPoolCopy.universePoolCount(metrics.poolCount)}</span>
				<span>{securityPoolCopy.universeVaultCount(metrics.vaultCount)}</span>
			</p>
		</>
	)
}

/** Statoblast's universe browser: the shared lineage tree with pool-held REP and pool counts for each universe. */
export function UniversePoolDirectorySection({ activeUniverseId, loadingSecurityPools = false, onRetry, securityPoolError, securityPools, zoltarUniverse }: UniversePoolDirectorySectionProps) {
	if (zoltarUniverse === undefined) return <StateHint presentation={{ key: 'loading', badgeLabel: commonCopy.loading, badgeTone: 'loading', detail: commonCopy.loadingUniverseDetails }} />
	if (securityPoolError !== undefined && securityPools === undefined) return <RetryableNotice onRetry={onRetry} retryLabel={securityPoolCopy.retryLoadingPools} disabled={loadingSecurityPools} presentation={{ key: 'load_failed', badgeLabel: commonCopy.error, badgeTone: 'blocked', detail: securityPoolError }} />
	if (loadingSecurityPools || securityPools === undefined) return <StateHint presentation={{ key: 'loading', badgeLabel: commonCopy.loading, badgeTone: 'loading', detail: securityPoolCopy.loadingSecurityPools }} />

	return (
		<UniverseBrowser activeUniverseId={activeUniverseId} universe={zoltarUniverse} renderChildSummary={childUniverse => <UniversePoolMetrics securityPools={securityPools} universeId={childUniverse.universeId} />}>
			<UniversePoolMetrics securityPools={securityPools} universeId={zoltarUniverse.universeId} />
		</UniverseBrowser>
	)
}
