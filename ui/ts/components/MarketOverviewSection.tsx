import * as commonCopy from '../copy/common.js'
import * as marketCopy from '../copy/market.js'
import { useState } from 'preact/hooks'
import type { Address } from '@zoltar/shared/ethereum'
import { AddressValue } from './AddressValue.js'
import { ChildUniverseDeploymentModal } from './ChildUniverseDeploymentModal.js'
import { CurrencyValue } from './CurrencyValue.js'
import { ChildUniverseDetails } from './ChildUniverseDetails.js'
import { DataGrid } from './DataGrid.js'
import { EntityCard } from './EntityCard.js'
import { ChildUniversesSection, ChildUniverseStatusBadge } from './ChildUniversesSection.js'
import { Question } from './Question.js'
import { MetricField } from './MetricField.js'
import { ScalarDeploymentSection } from './ScalarDeploymentSection.js'
import { StateHint } from './StateHint.js'
import { TimestampValue } from './TimestampValue.js'
import { WorkflowSubsection } from './WorkflowSubsection.js'
import type { LoadableValueState } from '../lib/loadState.js'
import { getUniversePresentation } from '../lib/userCopy.js'
import { formatUniverseCollectionLabel } from '../lib/universe.js'
import type { ZoltarUniverseSummary } from '../types/contracts.js'
type MarketOverviewSectionProps = {
	accountAddress: Address | undefined
	isMainnet: boolean
	loadingZoltarUniverse: boolean
	onCreateChildUniverseForOutcomeIndex: (outcomeIndex: bigint) => void
	zoltarChildUniverseError: string | undefined
	zoltarChildUniversePendingOutcomeIndex: bigint | undefined
	zoltarUniverse: ZoltarUniverseSummary | undefined
	zoltarUniverseState: LoadableValueState
}
export function MarketOverviewSection({ accountAddress, isMainnet, loadingZoltarUniverse, onCreateChildUniverseForOutcomeIndex, zoltarChildUniverseError, zoltarChildUniversePendingOutcomeIndex, zoltarUniverse, zoltarUniverseState }: MarketOverviewSectionProps) {
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
								<MetricField label={commonCopy.forkThreshold}>
									<CurrencyValue value={rootUniverse.forkThreshold} suffix={commonCopy.rep} />
								</MetricField>
							</>
						) : undefined}
						<MetricField label={commonCopy.reputationToken}>
							<AddressValue address={rootUniverse.reputationToken} />
						</MetricField>
						<MetricField label={marketCopy.totalTheoreticalSupply}>
							<CurrencyValue value={rootUniverse.totalTheoreticalSupply} suffix={commonCopy.rep} />
						</MetricField>
					</DataGrid>
					{hasForked ? (
						<WorkflowSubsection title={marketCopy.forkQuestion}>
							<EntityCard title={marketCopy.selectedForkQuestion} variant='record'>
								<Question question={rootUniverse.forkQuestionDetails} loading={rootUniverse.forkQuestionDetails === undefined} />
							</EntityCard>
						</WorkflowSubsection>
					) : undefined}
					{isScalarFork ? (
						<ScalarDeploymentSection
							accountAddress={accountAddress}
							childUniverses={rootUniverse.childUniverses}
							hasForked={hasForked}
							isMainnet={isMainnet}
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
									disabled: accountAddress === undefined || !isMainnet || !hasForked || child.exists,
									reason: (() => {
										if (accountAddress === undefined) return marketCopy.childDeploymentWalletRequiredReason
										if (!isMainnet) return undefined

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
							renderBody={child => <ChildUniverseDetails child={child} />}
						/>
					)}
					<ChildUniverseDeploymentModal
						actionAvailability={{
							disabled: selectedChildUniverse === undefined || accountAddress === undefined || !isMainnet || !hasForked || selectedChildUniverse.exists,
							reason:
								selectedChildUniverse === undefined
									? marketCopy.childDeploymentSelectionRequired
									: (() => {
											if (accountAddress === undefined) return marketCopy.childDeploymentWalletRequiredReason
											if (!isMainnet) return undefined

											return (() => {
												if (!hasForked) return marketCopy.childUniversesNotForkedReason
												if (selectedChildUniverse.exists) return marketCopy.childUniverseDeployedReason

												return undefined
											})()
										})(),
						}}
						description={marketCopy.childUniverseDeploymentDescription}
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
							<EntityCard className='compact' title={marketCopy.selectedChildUniverse} variant='compact'>
								<ChildUniverseDetails child={selectedChildUniverse} />
							</EntityCard>
						)}
					</ChildUniverseDeploymentModal>
				</>
			)}
		</>
	)
}
