import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js'
import * as marketCopy from '@zoltar/ui-zoltar/copy/market.js'
import type { Address } from '@zoltar/shared/ethereum'
import { CurrencyValue } from '@zoltar/ui-core-shared/components/CurrencyValue.js'
import { ChildUniverseDeploymentSection } from '@zoltar/ui-zoltar/features/universes/components/ChildUniverseDeploymentSection.js'
import { DataGrid } from '@zoltar/ui-core-shared/components/DataGrid.js'
import { EntityCard } from '@zoltar/ui-core-shared/components/EntityCard.js'
import { Question } from '@zoltar/ui-core-shared/components/Question.js'
import { MetricField } from '@zoltar/ui-core-shared/components/MetricField.js'
import { ScalarDeploymentSection } from './ScalarDeploymentSection.js'
import { StateHint } from '@zoltar/ui-core-shared/components/StateHint.js'
import { TimestampValue } from '@zoltar/ui-core-shared/components/TimestampValue.js'
import { WorkflowSubsection } from '@zoltar/ui-core-shared/components/WorkflowSubsection.js'
import { WalletAssetControl } from '@zoltar/ui-core-shared/components/WalletAssetControl.js'
import type { LoadableValueState } from '@zoltar/ui-core-shared/lib/loadState.js'
import { getUniversePresentation } from '@zoltar/ui-core-shared/lib/userCopy.js'
import type { ZoltarUniverseSummary } from '@zoltar/ui-core-shared/types/contracts.js'
type MarketOverviewSectionProps = {
	accountAddress: Address | undefined
	isOnActiveAppChain: boolean
	loadingZoltarUniverse: boolean
	onCreateChildUniverseForOutcomeIndex: (outcomeIndex: bigint) => void
	zoltarChildUniverseError: string | undefined
	zoltarChildUniversePendingOutcomeIndex: bigint | undefined
	zoltarUniverse: ZoltarUniverseSummary | undefined
	zoltarUniverseState: LoadableValueState
}
export function MarketOverviewSection({ accountAddress, isOnActiveAppChain, loadingZoltarUniverse, onCreateChildUniverseForOutcomeIndex, zoltarChildUniverseError, zoltarChildUniversePendingOutcomeIndex, zoltarUniverse, zoltarUniverseState }: MarketOverviewSectionProps) {
	const rootUniverse = zoltarUniverse
	const universeMissing = zoltarUniverseState === 'missing'
	const hasForked = rootUniverse?.hasForked === true
	const isScalarFork = rootUniverse?.forkQuestionDetails?.marketType === 'scalar'
	const scalarQuestionDetails = rootUniverse?.forkQuestionDetails
	if (universeMissing) {
		const presentation = getUniversePresentation(zoltarUniverseState)
		return presentation === undefined ? undefined : <StateHint presentation={presentation} />
	}
	return (
		<>
			{rootUniverse === undefined ? (
				<StateHint presentation={getUniversePresentation('loading') ?? { key: 'loading', badgeLabel: commonCopy.loading, badgeTone: 'pending', detail: commonCopy.loadingUniverseDetails }} />
			) : (
				<>
					<DataGrid className='market-overview-grid'>
						<MetricField label={commonCopy.status}>{hasForked ? commonCopy.forked : marketCopy.unforked}</MetricField>
						{hasForked ? (
							<>
								<MetricField label={commonCopy.forkTime}>{loadingZoltarUniverse ? commonCopy.loadingWithEllipsis : <TimestampValue timestamp={rootUniverse.forkTime} />}</MetricField>
								<MetricField label={commonCopy.forkThresholdAttoRep}>
									<CurrencyValue value={rootUniverse.forkThresholdAttoRep} suffix={commonCopy.rep} />
								</MetricField>
							</>
						) : undefined}
						<MetricField label={commonCopy.reputationToken}>
							<WalletAssetControl accountAddress={accountAddress} address={rootUniverse.reputationToken} isSupportedChain={isOnActiveAppChain} tokenLabel={commonCopy.reputationToken} />
						</MetricField>
						<MetricField label={marketCopy.totalTheoreticalSupplyAttoRep}>
							<CurrencyValue value={rootUniverse.totalTheoreticalSupplyAttoRep} suffix={commonCopy.rep} />
						</MetricField>
					</DataGrid>
					{hasForked ? (
						<WorkflowSubsection title={marketCopy.forkQuestion}>
							<EntityCard surface='flat' title={marketCopy.selectedForkQuestion} variant='record'>
								<Question question={rootUniverse.forkQuestionDetails} loading={rootUniverse.forkQuestionDetails === undefined} />
							</EntityCard>
						</WorkflowSubsection>
					) : undefined}
					{isScalarFork ? (
						<ScalarDeploymentSection
							accountAddress={accountAddress}
							childUniverses={rootUniverse.childUniverses}
							hasForked={hasForked}
							isOnActiveAppChain={isOnActiveAppChain}
							onCreateChildUniverseForOutcomeIndex={onCreateChildUniverseForOutcomeIndex}
							questionDetails={scalarQuestionDetails}
							zoltarChildUniverseError={zoltarChildUniverseError}
							zoltarChildUniversePendingOutcomeIndex={zoltarChildUniversePendingOutcomeIndex}
						/>
					) : (
						<ChildUniverseDeploymentSection
							accountAddress={accountAddress}
							childUniverses={rootUniverse.childUniverses}
							hasForked={hasForked}
							isOnActiveAppChain={isOnActiveAppChain}
							onCreateChildUniverseForOutcomeIndex={onCreateChildUniverseForOutcomeIndex}
							pendingOutcomeIndex={zoltarChildUniversePendingOutcomeIndex}
						/>
					)}
				</>
			)}
		</>
	)
}
