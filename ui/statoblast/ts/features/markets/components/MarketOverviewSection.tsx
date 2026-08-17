import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js'
import * as marketCopy from '@zoltar/ui-zoltar/copy/market.js'
import { useState } from 'preact/hooks'
import type { Address } from '@zoltar/shared/ethereum'
import { ChildUniverseDeploymentModal } from '@zoltar/ui-zoltar/features/universes/components/ChildUniverseDeploymentModal.js'
import { CurrencyValue } from '@zoltar/ui-core-shared/components/CurrencyValue.js'
import { ChildUniverseDetails } from '@zoltar/ui-zoltar/features/universes/components/ChildUniverseDetails.js'
import { DataGrid } from '@zoltar/ui-core-shared/components/DataGrid.js'
import { EntityCard } from '@zoltar/ui-core-shared/components/EntityCard.js'
import { ChildUniversesSection, ChildUniverseStatusBadge } from '@zoltar/ui-zoltar/features/universes/components/ChildUniversesSection.js'
import { Question } from './Question.js'
import { MetricField } from '@zoltar/ui-core-shared/components/MetricField.js'
import { ScalarDeploymentSection } from './ScalarDeploymentSection.js'
import { StateHint } from '@zoltar/ui-core-shared/components/StateHint.js'
import { TimestampValue } from '@zoltar/ui-core-shared/components/TimestampValue.js'
import { WorkflowSubsection } from '@zoltar/ui-core-shared/components/WorkflowSubsection.js'
import { WalletAssetControl } from '@zoltar/ui-core-shared/components/WalletAssetControl.js'
import type { LoadableValueState } from '@zoltar/ui-core-shared/lib/loadState.js'
import { getUniversePresentation } from '@zoltar/ui-core-shared/lib/userCopy.js'
import { formatUniverseCollectionLabel } from '@zoltar/ui-zoltar/features/universes/lib/universe.js'
import type { ZoltarUniverseSummary } from '@zoltar/ui-core-shared/types/contracts.js'
import { getWrongNetworkMessage } from '@zoltar/ui-core-shared/lib/network.js'
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
	const currentUniverseName = rootUniverse === undefined ? undefined : formatUniverseCollectionLabel([rootUniverse.universeId])
	const isScalarFork = rootUniverse?.forkQuestionDetails?.marketType === 'scalar'
	const scalarQuestionDetails = rootUniverse?.forkQuestionDetails
	const [selectedChildOutcomeIndex, setSelectedChildOutcomeIndex] = useState<bigint | undefined>(undefined)
	const selectedChildUniverse = rootUniverse?.childUniverses.find(child => child.outcomeIndex === selectedChildOutcomeIndex)
	const childUniverseRequirements = [
		{ key: 'forked', label: marketCopy.universeIsForked, resolved: hasForked, ...(hasForked ? {} : { detail: marketCopy.childUniversesNotForkedReason }) },
		{ key: 'selection', label: marketCopy.childUniverseSelected, resolved: selectedChildUniverse !== undefined, ...(selectedChildUniverse === undefined ? { detail: marketCopy.childDeploymentSelectionRequired } : {}) },
		{ key: 'wallet', label: marketCopy.walletConnected, resolved: accountAddress !== undefined, ...(accountAddress !== undefined ? {} : { detail: marketCopy.childDeploymentWalletRequiredReason }) },
		{ key: 'exists', label: marketCopy.childUniverseNotAlreadyDeployed, resolved: selectedChildUniverse?.exists !== true, ...(selectedChildUniverse?.exists === true ? { detail: marketCopy.childUniverseDeployedReason } : {}) },
	]
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
						<MetricField label={commonCopy.universe}>{currentUniverseName ?? commonCopy.universe}</MetricField>
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
							<WalletAssetControl accountAddress={accountAddress} address={rootUniverse.reputationToken} isSupportedChain={isOnActiveAppChain} tokenLabel={`${currentUniverseName ?? commonCopy.universe} ${commonCopy.rep}`} />
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
						<ChildUniversesSection
							childUniverses={rootUniverse.childUniverses}
							emptyMessage={marketCopy.noChildUniverses}
							headerSubtitle={hasForked ? marketCopy.childUniverseDeploymentHint : undefined}
							headerTitle={marketCopy.childUniverses}
							action={child => ({
								availability: {
									disabled: accountAddress === undefined || !isOnActiveAppChain || !hasForked || child.exists,
									reason: (() => {
										if (accountAddress === undefined) return marketCopy.childDeploymentWalletRequiredReason
										if (!isOnActiveAppChain) return getWrongNetworkMessage() ?? commonCopy.mainnetRequiredReason

										return (() => {
											if (!hasForked) return marketCopy.childUniversesNotForkedReason
											if (child.exists) return marketCopy.childUniverseDeployedReason

											return undefined
										})()
									})(),
								},
								label: child.exists ? commonCopy.deployed : marketCopy.createChildUniverse,
								onClick: () => setSelectedChildOutcomeIndex(child.outcomeIndex),
								pending: zoltarChildUniversePendingOutcomeIndex === child.outcomeIndex,
								pendingLabel: commonCopy.opening,
							})}
							renderBadge={child => <ChildUniverseStatusBadge child={child} />}
							renderBody={child => <ChildUniverseDetails accountAddress={accountAddress} child={child} isSupportedChain={isOnActiveAppChain} />}
							surface='flat'
						/>
					)}
					<ChildUniverseDeploymentModal
						actionAvailability={{
							disabled: selectedChildUniverse === undefined || accountAddress === undefined || !isOnActiveAppChain || !hasForked || selectedChildUniverse.exists,
							reason:
								selectedChildUniverse === undefined
									? marketCopy.childDeploymentSelectionRequired
									: (() => {
											if (accountAddress === undefined) return marketCopy.childDeploymentWalletRequiredReason
											if (!isOnActiveAppChain) return getWrongNetworkMessage() ?? commonCopy.mainnetRequiredReason

											return (() => {
												if (!hasForked) return marketCopy.childUniversesNotForkedReason
												if (selectedChildUniverse.exists) return marketCopy.childUniverseDeployedReason

												return undefined
											})()
										})(),
						}}
						idleLabel={marketCopy.deployUniverse}
						isOpen={selectedChildUniverse !== undefined}
						onClose={() => setSelectedChildOutcomeIndex(undefined)}
						onConfirm={() => {
							if (selectedChildUniverse === undefined) return
							onCreateChildUniverseForOutcomeIndex(selectedChildUniverse.outcomeIndex)
						}}
						pending={selectedChildUniverse !== undefined && zoltarChildUniversePendingOutcomeIndex === selectedChildUniverse.outcomeIndex}
						pendingLabel={marketCopy.deployingUniverse}
						requirements={childUniverseRequirements}
						title={marketCopy.createChildUniverseTitle}
					>
						{selectedChildUniverse === undefined ? undefined : (
							<EntityCard className='compact' surface='flat' title={marketCopy.selectedChildUniverse} variant='compact'>
								<ChildUniverseDetails accountAddress={accountAddress} child={selectedChildUniverse} isSupportedChain={isOnActiveAppChain} />
							</EntityCard>
						)}
					</ChildUniverseDeploymentModal>
				</>
			)}
		</>
	)
}
