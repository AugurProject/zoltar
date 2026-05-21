import { useEffect, useRef, useState } from 'preact/hooks'
import type { Address } from 'viem'
import { AddressValue } from './AddressValue.js'
import { OperationModal } from './OperationModal.js'
import { RequirementsChecklist } from './RequirementsChecklist.js'
import { CurrencyValue } from './CurrencyValue.js'
import { ChildUniverseDetails } from './ChildUniverseDetails.js'
import { DataGrid } from './DataGrid.js'
import { EntityCard } from './EntityCard.js'
import { ChildUniversesSection } from './ChildUniversesSection.js'
import { Question } from './Question.js'
import { MetricField } from './MetricField.js'
import { ScalarDeploymentSection } from './ScalarDeploymentSection.js'
import { StateHint } from './StateHint.js'
import { TimestampValue } from './TimestampValue.js'
import { TransactionActionButton } from './TransactionActionButton.js'
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
	const previousPendingOutcomeIndexRef = useRef<bigint | undefined>(undefined)
	const selectedChildUniverse = rootUniverse?.childUniverses.find(child => child.outcomeIndex === selectedChildOutcomeIndex)
	const childUniverseRequirements = [
		{ key: 'forked', label: 'Universe is forked', resolved: hasForked, ...(hasForked ? {} : { detail: 'Fork Zoltar before deploying child universes.' }) },
		{ key: 'selection', label: 'Child universe selected', resolved: selectedChildUniverse !== undefined, ...(selectedChildUniverse === undefined ? { detail: 'Select a child universe to deploy.' } : {}) },
		{ key: 'wallet', label: 'Wallet connected', resolved: accountAddress !== undefined, ...(accountAddress !== undefined ? {} : { detail: 'Connect a wallet before deploying a child universe.' }) },
		{ key: 'mainnet', label: 'Ethereum mainnet selected', resolved: isMainnet, ...(isMainnet ? {} : { detail: 'Switch to Ethereum mainnet before deploying a child universe.' }) },
		{ key: 'exists', label: 'Child universe not already deployed', resolved: selectedChildUniverse?.exists !== true, ...(selectedChildUniverse?.exists === true ? { detail: 'This child universe is already deployed.' } : {}) },
	]

	useEffect(() => {
		if (previousPendingOutcomeIndexRef.current === undefined || zoltarChildUniversePendingOutcomeIndex !== undefined) {
			previousPendingOutcomeIndexRef.current = zoltarChildUniversePendingOutcomeIndex
			return
		}
		setSelectedChildOutcomeIndex(undefined)
		previousPendingOutcomeIndexRef.current = zoltarChildUniversePendingOutcomeIndex
	}, [zoltarChildUniversePendingOutcomeIndex])

	if (universeMissing) {
		const presentation = getUniversePresentation(zoltarUniverseState)
		return presentation === undefined ? undefined : <StateHint presentation={presentation} />
	}

	return (
		<>
			{rootUniverse === undefined ? (
				<StateHint presentation={getUniversePresentation('loading') ?? { key: 'loading', badgeLabel: 'Loading', badgeTone: 'pending', detail: 'Loading universe details.' }} />
			) : (
				<>
					<DataGrid className='market-overview-grid'>
						<MetricField label='Universe'>{currentUniverseName ?? 'Universe'}</MetricField>
						<MetricField label='Status'>{hasForked ? 'Forked' : 'Unforked'}</MetricField>
						{hasForked ? (
							<>
								<MetricField label='Fork Time'>{loadingZoltarUniverse ? 'Loading...' : <TimestampValue timestamp={rootUniverse.forkTime} />}</MetricField>
								<MetricField label='Fork Threshold'>
									<CurrencyValue value={rootUniverse.forkThreshold} suffix='REP' />
								</MetricField>
							</>
						) : undefined}
						<MetricField label='Reputation Token'>
							<AddressValue address={rootUniverse.reputationToken} />
						</MetricField>
						<MetricField label='Total Theoretical Supply'>
							<CurrencyValue value={rootUniverse.totalTheoreticalSupply} suffix='REP' />
						</MetricField>
					</DataGrid>
					{hasForked ? (
						<WorkflowSubsection title='Fork Question'>
							<EntityCard title='Selected Fork Question' variant='record'>
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
							emptyMessage='No child universes'
							headerSubtitle={hasForked ? 'Deploy child universes as needed for fork resolution.' : undefined}
							headerTitle='Child Universes'
							action={child => ({
								availability: {
									disabled: accountAddress === undefined || !isMainnet || !hasForked || child.exists,
									reason:
										accountAddress === undefined ? 'Connect a wallet before deploying a child universe.' : !isMainnet ? 'Switch to Ethereum mainnet before deploying a child universe.' : !hasForked ? 'Fork Zoltar before deploying child universes.' : child.exists ? 'This child universe is already deployed.' : undefined,
								},
								label: child.exists ? 'Deployed' : 'Create child universe',
								onClick: () => setSelectedChildOutcomeIndex(child.outcomeIndex),
								pending: zoltarChildUniversePendingOutcomeIndex === child.outcomeIndex,
								pendingLabel: 'Opening...',
							})}
							renderBadge={child => <span className={`badge ${child.exists ? 'ok' : 'pending'}`}>{child.exists ? 'Exists' : 'Not deployed'}</span>}
							renderBody={child => <ChildUniverseDetails child={child} />}
						/>
					)}
					<OperationModal isOpen={selectedChildUniverse !== undefined} onClose={() => setSelectedChildOutcomeIndex(undefined)} title='Create Child Universe' description='Confirm the selected fork outcome and deploy its child universe in one bounded execution flow.'>
						{selectedChildUniverse === undefined ? undefined : (
							<>
								<EntityCard className='compact' title='Selected Child Universe' variant='compact'>
									<ChildUniverseDetails child={selectedChildUniverse} />
								</EntityCard>
								<RequirementsChecklist items={childUniverseRequirements} />
								<div className='actions'>
									<TransactionActionButton
										idleLabel='Deploy Universe'
										pendingLabel='Deploying universe...'
										onClick={() => onCreateChildUniverseForOutcomeIndex(selectedChildUniverse.outcomeIndex)}
										pending={zoltarChildUniversePendingOutcomeIndex === selectedChildUniverse.outcomeIndex}
										tone='secondary'
										availability={{
											disabled: accountAddress === undefined || !isMainnet || !hasForked || selectedChildUniverse.exists,
											reason:
												accountAddress === undefined
													? 'Connect a wallet before deploying a child universe.'
													: !isMainnet
														? 'Switch to Ethereum mainnet before deploying a child universe.'
														: !hasForked
															? 'Fork Zoltar before deploying child universes.'
															: selectedChildUniverse.exists
																? 'This child universe is already deployed.'
																: undefined,
										}}
									/>
								</div>
							</>
						)}
					</OperationModal>
				</>
			)}
		</>
	)
}
