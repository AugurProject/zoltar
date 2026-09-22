import { RetryableNotice } from '@zoltar/ui-core-shared/components/RetryableNotice.js'
import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js'
import * as securityPoolCopy from '../../../copy/securityPool.js'
import { ChildUniverseList } from '@zoltar/ui-zoltar-shared/features/universes/components/ChildUniverseList.js'
import { UniverseContextSummary } from '@zoltar/ui-zoltar-shared/features/universes/components/UniverseContextSummary.js'
import { CurrencyValue } from '@zoltar/ui-core-shared/components/CurrencyValue.js'
import { SectionBlock } from '@zoltar/ui-core-shared/components/SectionBlock.js'
import { StateHint } from '@zoltar/ui-core-shared/components/StateHint.js'
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

export function UniversePoolDirectorySection({ activeUniverseId, loadingSecurityPools = false, onRetry, securityPoolError, securityPools, zoltarUniverse }: UniversePoolDirectorySectionProps) {
	if (zoltarUniverse === undefined) return <StateHint presentation={{ key: 'loading', badgeLabel: commonCopy.loading, badgeTone: 'loading', detail: commonCopy.loadingUniverseDetails }} />
	if (securityPoolError !== undefined && securityPools === undefined) return <RetryableNotice onRetry={onRetry} retryLabel={securityPoolCopy.retryLoadingPools} disabled={loadingSecurityPools} presentation={{ key: 'load_failed', badgeLabel: commonCopy.error, badgeTone: 'blocked', detail: securityPoolError }} />
	if (loadingSecurityPools || securityPools === undefined) return <StateHint presentation={{ key: 'loading', badgeLabel: commonCopy.loading, badgeTone: 'loading', detail: securityPoolCopy.loadingSecurityPools }} />

	const activeUniversePoolMetrics = getUniversePoolMetrics(zoltarUniverse.universeId, securityPools)

	return (
		<div className='route-view-flow'>
			<SectionBlock variant='plain'>
				<UniverseContextSummary universe={zoltarUniverse}>
					<p className='decision-amount'>
						<CurrencyValue value={activeUniversePoolMetrics.totalPoolHeldAttoRep} suffix={commonCopy.rep} />
					</p>
					<p className='detail'>{securityPoolCopy.totalPoolHeldAttoRep}</p>
					<p className='inline-facts'>
						<span>{securityPoolCopy.universePoolCount(activeUniversePoolMetrics.poolCount)}</span>
						<span>{securityPoolCopy.universeVaultCount(activeUniversePoolMetrics.vaultCount)}</span>
					</p>
				</UniverseContextSummary>
			</SectionBlock>

			<ChildUniverseList
				activeUniverseId={activeUniverseId}
				childUniverses={zoltarUniverse.childUniverses}
				renderSummary={childUniverse => {
					const childUniversePoolMetrics = getUniversePoolMetrics(childUniverse.universeId, securityPools)
					return (
						<>
							<p className='decision-amount'>
								<CurrencyValue value={childUniversePoolMetrics.totalPoolHeldAttoRep} suffix={commonCopy.rep} />
							</p>
							<p className='detail'>{securityPoolCopy.totalPoolHeldAttoRep}</p>
							<p className='inline-facts'>
								<span>{securityPoolCopy.universePoolCount(childUniversePoolMetrics.poolCount)}</span>
								<span>{securityPoolCopy.universeVaultCount(childUniversePoolMetrics.vaultCount)}</span>
							</p>
						</>
					)
				}}
			/>
		</div>
	)
}
