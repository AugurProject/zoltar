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
import { UI_STRINGS, TSX_STRINGS } from '../lib/uiStrings.js'
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
		{ key: 'forked', label: UI_STRINGS.marketOverviewSection.universeIsForkedLabel, resolved: hasForked, ...(hasForked ? {} : { detail: UI_STRINGS.marketOverviewSection.childUniversesUnavailableReason }) },
		{ key: 'selection', label: TSX_STRINGS.componentsMarketOverviewSection.copy001, resolved: selectedChildUniverse !== undefined, ...(selectedChildUniverse === undefined ? { detail: TSX_STRINGS.componentsMarketOverviewSection.copy002 } : {}) },
		{ key: 'wallet', label: TSX_STRINGS.componentsMarketOverviewSection.copy003, resolved: accountAddress !== undefined, ...(accountAddress !== undefined ? {} : { detail: TSX_STRINGS.componentsMarketOverviewSection.copy004 }) },
		{ key: 'exists', label: UI_STRINGS.marketOverviewSection.childUniverseNotAlreadyDeployedLabel, resolved: selectedChildUniverse?.exists !== true, ...(selectedChildUniverse?.exists === true ? { detail: UI_STRINGS.marketOverviewSection.childUniverseAlreadyDeployedReason } : {}) },
	]
	if (universeMissing) {
		const presentation = getUniversePresentation(zoltarUniverseState)
		return presentation === undefined ? undefined : <StateHint presentation={presentation} />
	}
	return (
		<>
			{rootUniverse === undefined ? (
				<StateHint presentation={getUniversePresentation('loading') ?? { key: 'loading', badgeLabel: TSX_STRINGS.componentsMarketOverviewSection.copy005, badgeTone: 'pending', detail: TSX_STRINGS.componentsMarketOverviewSection.copy006 }} />
			) : (
				<>
					<DataGrid className='market-overview-grid'>
						<MetricField label={TSX_STRINGS.componentsMarketOverviewSection.copy007}>{currentUniverseName ?? TSX_STRINGS.componentsMarketOverviewSection.copy008}</MetricField>
						<MetricField label={TSX_STRINGS.componentsMarketOverviewSection.copy009}>{hasForked ? TSX_STRINGS.componentsMarketOverviewSection.copy010 : TSX_STRINGS.componentsMarketOverviewSection.copy011}</MetricField>
						{hasForked ? (
							<>
								<MetricField label={TSX_STRINGS.componentsMarketOverviewSection.copy012}>{loadingZoltarUniverse ? TSX_STRINGS.componentsMarketOverviewSection.copy013 : <TimestampValue timestamp={rootUniverse.forkTime} />}</MetricField>
								<MetricField label={TSX_STRINGS.componentsMarketOverviewSection.copy014}>
									<CurrencyValue value={rootUniverse.forkThreshold} suffix={TSX_STRINGS.componentsMarketOverviewSection.copy015} />
								</MetricField>
							</>
						) : undefined}
						<MetricField label={TSX_STRINGS.componentsMarketOverviewSection.copy016}>
							<AddressValue address={rootUniverse.reputationToken} />
						</MetricField>
						<MetricField label={TSX_STRINGS.componentsMarketOverviewSection.copy017}>
							<CurrencyValue value={rootUniverse.totalTheoreticalSupply} suffix={TSX_STRINGS.componentsMarketOverviewSection.copy018} />
						</MetricField>
					</DataGrid>
					{hasForked ? (
						<WorkflowSubsection title={TSX_STRINGS.componentsMarketOverviewSection.copy019}>
							<EntityCard title={TSX_STRINGS.componentsMarketOverviewSection.copy020} variant='record'>
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
							emptyMessage={TSX_STRINGS.componentsMarketOverviewSection.copy021}
							headerSubtitle={hasForked ? TSX_STRINGS.componentsMarketOverviewSection.copy022 : undefined}
							headerTitle={TSX_STRINGS.componentsMarketOverviewSection.copy023}
							action={child => ({
								availability: {
									disabled: accountAddress === undefined || !isMainnet || !hasForked || child.exists,
									reason: (() => {
										if (accountAddress === undefined) return TSX_STRINGS.componentsMarketOverviewSection.copy024
										if (!isMainnet) return undefined

										return (() => {
											if (!hasForked) return UI_STRINGS.marketOverviewSection.childUniversesUnavailableReason
											if (child.exists) return UI_STRINGS.marketOverviewSection.childUniverseAlreadyDeployedReason

											return undefined
										})()
									})(),
								},
								label: child.exists ? TSX_STRINGS.componentsMarketOverviewSection.copy025 : TSX_STRINGS.componentsMarketOverviewSection.copy026,
								onClick: () => setSelectedChildOutcomeIndex(child.outcomeIndex),
								pending: zoltarChildUniversePendingOutcomeIndex === child.outcomeIndex,
								pendingLabel: TSX_STRINGS.componentsMarketOverviewSection.copy027,
								safetyId: 'child-universe.deploy',
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
									? TSX_STRINGS.componentsMarketOverviewSection.copy028
									: (() => {
											if (accountAddress === undefined) return TSX_STRINGS.componentsMarketOverviewSection.copy029
											if (!isMainnet) return undefined

											return (() => {
												if (!hasForked) return UI_STRINGS.marketOverviewSection.childUniversesUnavailableReason
												if (selectedChildUniverse.exists) return UI_STRINGS.marketOverviewSection.childUniverseAlreadyDeployedReason

												return undefined
											})()
										})(),
						}}
						description={TSX_STRINGS.componentsMarketOverviewSection.copy030}
						idleLabel={TSX_STRINGS.componentsMarketOverviewSection.copy031}
						isOpen={selectedChildUniverse !== undefined}
						onClose={() => setSelectedChildOutcomeIndex(undefined)}
						onConfirm={() => {
							if (selectedChildUniverse === undefined) return
							onCreateChildUniverseForOutcomeIndex(selectedChildUniverse.outcomeIndex)
						}}
						pending={selectedChildUniverse !== undefined && zoltarChildUniversePendingOutcomeIndex === selectedChildUniverse.outcomeIndex}
						pendingLabel={TSX_STRINGS.componentsMarketOverviewSection.copy032}
						requirements={childUniverseRequirements}
						safetyId='child-universe.deploy'
						title={TSX_STRINGS.componentsMarketOverviewSection.copy033}
					>
						{selectedChildUniverse === undefined ? undefined : (
							<EntityCard className='compact' title={TSX_STRINGS.componentsMarketOverviewSection.copy034} variant='compact'>
								<ChildUniverseDetails child={selectedChildUniverse} />
							</EntityCard>
						)}
					</ChildUniverseDeploymentModal>
				</>
			)}
		</>
	)
}
