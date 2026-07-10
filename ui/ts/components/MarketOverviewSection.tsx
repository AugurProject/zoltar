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
import {
	UI_STRING_CHILD_UNIVERSES,
	UI_STRING_CHILD_UNIVERSE_ALREADY_DEPLOYED,
	UI_STRING_CHILD_UNIVERSE_NOT_ALREADY_DEPLOYED,
	UI_STRING_CHILD_UNIVERSE_SELECTED,
	UI_STRING_CHILD_UNIVERSES_UNAVAILABLE_BECAUSE_UNIVERSE_HAS_NOT_FORKED,
	UI_STRING_CONFIRM_THE_SELECTED_FORK_OUTCOME_AND_DEPLOY_ITS_CHILD_UNIVERSE_IN_ONE,
	UI_STRING_CONNECT_A_WALLET_BEFORE_DEPLOYING_A_CHILD_UNIVERSE,
	UI_STRING_CREATE_CHILD_UNIVERSE,
	UI_STRING_CREATE_CHILD_UNIVERSE_TITLE,
	UI_STRING_DEPLOYED,
	UI_STRING_DEPLOYING_UNIVERSE,
	UI_STRING_DEPLOY_CHILD_UNIVERSES_AS_NEEDED_FOR_FORK_RESOLUTION,
	UI_STRING_DEPLOY_UNIVERSE,
	UI_STRING_FORKED,
	UI_STRING_FORK_QUESTION,
	UI_STRING_FORK_THRESHOLD,
	UI_STRING_FORK_TIME,
	UI_STRING_LOADING,
	UI_STRING_LOADING_UNIVERSE_DETAILS,
	UI_STRING_LOADING_WITH_ELLIPSIS,
	UI_STRING_NO_CHILD_UNIVERSES,
	UI_STRING_OPENING,
	UI_STRING_REP,
	UI_STRING_REPUTATION_TOKEN,
	UI_STRING_SELECTED_CHILD_UNIVERSE,
	UI_STRING_SELECTED_FORK_QUESTION,
	UI_STRING_SELECT_A_CHILD_UNIVERSE_TO_DEPLOY,
	UI_STRING_STATUS,
	UI_STRING_TOTAL_THEORETICAL_SUPPLY,
	UI_STRING_UNFORKED,
	UI_STRING_UNIVERSE,
	UI_STRING_UNIVERSE_IS_FORKED,
	UI_STRING_WALLET_CONNECTED,
} from '../lib/uiStrings.js'
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
		{ key: 'forked', label: UI_STRING_UNIVERSE_IS_FORKED, resolved: hasForked, ...(hasForked ? {} : { detail: UI_STRING_CHILD_UNIVERSES_UNAVAILABLE_BECAUSE_UNIVERSE_HAS_NOT_FORKED }) },
		{ key: 'selection', label: UI_STRING_CHILD_UNIVERSE_SELECTED, resolved: selectedChildUniverse !== undefined, ...(selectedChildUniverse === undefined ? { detail: UI_STRING_SELECT_A_CHILD_UNIVERSE_TO_DEPLOY } : {}) },
		{ key: 'wallet', label: UI_STRING_WALLET_CONNECTED, resolved: accountAddress !== undefined, ...(accountAddress !== undefined ? {} : { detail: UI_STRING_CONNECT_A_WALLET_BEFORE_DEPLOYING_A_CHILD_UNIVERSE }) },
		{ key: 'exists', label: UI_STRING_CHILD_UNIVERSE_NOT_ALREADY_DEPLOYED, resolved: selectedChildUniverse?.exists !== true, ...(selectedChildUniverse?.exists === true ? { detail: UI_STRING_CHILD_UNIVERSE_ALREADY_DEPLOYED } : {}) },
	]
	if (universeMissing) {
		const presentation = getUniversePresentation(zoltarUniverseState)
		return presentation === undefined ? undefined : <StateHint presentation={presentation} />
	}
	return (
		<>
			{rootUniverse === undefined ? (
				<StateHint presentation={getUniversePresentation('loading') ?? { key: 'loading', badgeLabel: UI_STRING_LOADING, badgeTone: 'pending', detail: UI_STRING_LOADING_UNIVERSE_DETAILS }} />
			) : (
				<>
					<DataGrid className='market-overview-grid'>
						<MetricField label={UI_STRING_UNIVERSE}>{currentUniverseName ?? UI_STRING_UNIVERSE}</MetricField>
						<MetricField label={UI_STRING_STATUS}>{hasForked ? UI_STRING_FORKED : UI_STRING_UNFORKED}</MetricField>
						{hasForked ? (
							<>
								<MetricField label={UI_STRING_FORK_TIME}>{loadingZoltarUniverse ? UI_STRING_LOADING_WITH_ELLIPSIS : <TimestampValue timestamp={rootUniverse.forkTime} />}</MetricField>
								<MetricField label={UI_STRING_FORK_THRESHOLD}>
									<CurrencyValue value={rootUniverse.forkThreshold} suffix={UI_STRING_REP} />
								</MetricField>
							</>
						) : undefined}
						<MetricField label={UI_STRING_REPUTATION_TOKEN}>
							<AddressValue address={rootUniverse.reputationToken} />
						</MetricField>
						<MetricField label={UI_STRING_TOTAL_THEORETICAL_SUPPLY}>
							<CurrencyValue value={rootUniverse.totalTheoreticalSupply} suffix={UI_STRING_REP} />
						</MetricField>
					</DataGrid>
					{hasForked ? (
						<WorkflowSubsection title={UI_STRING_FORK_QUESTION}>
							<EntityCard title={UI_STRING_SELECTED_FORK_QUESTION} variant='record'>
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
							emptyMessage={UI_STRING_NO_CHILD_UNIVERSES}
							headerSubtitle={hasForked ? UI_STRING_DEPLOY_CHILD_UNIVERSES_AS_NEEDED_FOR_FORK_RESOLUTION : undefined}
							headerTitle={UI_STRING_CHILD_UNIVERSES}
							action={child => ({
								availability: {
									disabled: accountAddress === undefined || !isMainnet || !hasForked || child.exists,
									reason: (() => {
										if (accountAddress === undefined) return UI_STRING_CONNECT_A_WALLET_BEFORE_DEPLOYING_A_CHILD_UNIVERSE
										if (!isMainnet) return undefined

										return (() => {
											if (!hasForked) return UI_STRING_CHILD_UNIVERSES_UNAVAILABLE_BECAUSE_UNIVERSE_HAS_NOT_FORKED
											if (child.exists) return UI_STRING_CHILD_UNIVERSE_ALREADY_DEPLOYED

											return undefined
										})()
									})(),
								},
								label: child.exists ? UI_STRING_DEPLOYED : UI_STRING_CREATE_CHILD_UNIVERSE,
								onClick: () => setSelectedChildOutcomeIndex(child.outcomeIndex),
								pending: zoltarChildUniversePendingOutcomeIndex === child.outcomeIndex,
								pendingLabel: UI_STRING_OPENING,
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
									? UI_STRING_SELECT_A_CHILD_UNIVERSE_TO_DEPLOY
									: (() => {
											if (accountAddress === undefined) return UI_STRING_CONNECT_A_WALLET_BEFORE_DEPLOYING_A_CHILD_UNIVERSE
											if (!isMainnet) return undefined

											return (() => {
												if (!hasForked) return UI_STRING_CHILD_UNIVERSES_UNAVAILABLE_BECAUSE_UNIVERSE_HAS_NOT_FORKED
												if (selectedChildUniverse.exists) return UI_STRING_CHILD_UNIVERSE_ALREADY_DEPLOYED

												return undefined
											})()
										})(),
						}}
						description={UI_STRING_CONFIRM_THE_SELECTED_FORK_OUTCOME_AND_DEPLOY_ITS_CHILD_UNIVERSE_IN_ONE}
						idleLabel={UI_STRING_DEPLOY_UNIVERSE}
						isOpen={selectedChildUniverse !== undefined}
						onClose={() => setSelectedChildOutcomeIndex(undefined)}
						onConfirm={() => {
							if (selectedChildUniverse === undefined) return
							onCreateChildUniverseForOutcomeIndex(selectedChildUniverse.outcomeIndex)
						}}
						pending={selectedChildUniverse !== undefined && zoltarChildUniversePendingOutcomeIndex === selectedChildUniverse.outcomeIndex}
						pendingLabel={UI_STRING_DEPLOYING_UNIVERSE}
						requirements={childUniverseRequirements}
						title={UI_STRING_CREATE_CHILD_UNIVERSE_TITLE}
					>
						{selectedChildUniverse === undefined ? undefined : (
							<EntityCard className='compact' title={UI_STRING_SELECTED_CHILD_UNIVERSE} variant='compact'>
								<ChildUniverseDetails child={selectedChildUniverse} />
							</EntityCard>
						)}
					</ChildUniverseDeploymentModal>
				</>
			)}
		</>
	)
}
