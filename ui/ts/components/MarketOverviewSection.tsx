import type { Address } from 'viem'
import { AddressValue } from './AddressValue.js'
import { CurrencyValue } from './CurrencyValue.js'
import { ChildUniverseDetails } from './ChildUniverseDetails.js'
import { EntityCard } from './EntityCard.js'
import { ChildUniversesSection } from './ChildUniversesSection.js'
import { LoadableValue } from './LoadableValue.js'
import { Question } from './Question.js'
import { MetricField } from './MetricField.js'
import { ScalarDeploymentSection } from './ScalarDeploymentSection.js'
import { StateHint } from './StateHint.js'
import { TimestampValue } from './TimestampValue.js'
import type { LoadableValueState } from '../lib/loadState.js'
import { getUniversePresentation } from '../lib/userCopy.js'
import { formatUniverseCollectionLabel } from '../lib/universe.js'
import type { ZoltarUniverseSummary } from '../types/contracts.js'

type MarketOverviewSectionProps = {
	accountAddress: Address | undefined
	loadingZoltarUniverse: boolean
	onCreateChildUniverseForOutcomeIndex: (outcomeIndex: bigint) => void
	walletMatchesActiveNetwork: boolean
	zoltarChildUniverseError: string | undefined
	zoltarUniverse: ZoltarUniverseSummary | undefined
	zoltarUniverseState: LoadableValueState
}

export function MarketOverviewSection({ accountAddress, loadingZoltarUniverse, onCreateChildUniverseForOutcomeIndex, walletMatchesActiveNetwork, zoltarChildUniverseError, zoltarUniverse, zoltarUniverseState }: MarketOverviewSectionProps) {
	const rootUniverse = zoltarUniverse
	const universeMissing = zoltarUniverseState === 'missing'
	const hasForked = rootUniverse?.hasForked === true
	const currentUniverseName = rootUniverse === undefined ? undefined : formatUniverseCollectionLabel([rootUniverse.universeId])
	const isScalarFork = rootUniverse?.forkQuestionDetails?.marketType === 'scalar'
	const scalarQuestionDetails = rootUniverse?.forkQuestionDetails

	if (universeMissing) {
		const presentation = getUniversePresentation(zoltarUniverseState)
		return (
			<EntityCard className='market-overview-card' title='Universe'>
				{presentation === undefined ? undefined : <StateHint presentation={presentation} />}
			</EntityCard>
		)
	}

	return (
		<EntityCard className='market-overview-card' title={rootUniverse === undefined ? 'Universe' : (currentUniverseName ?? 'Universe')} badge={rootUniverse === undefined ? undefined : <span className='badge ok'>{hasForked ? 'Forked' : 'Unforked'}</span>}>
			{rootUniverse === undefined ? (
				<p className='detail'>
					<span className='loading-value' role='status' aria-label='Loading universe data'>
						<span className='spinner' aria-hidden='true' />
					</span>
				</p>
			) : (
				<>
					{hasForked ? (
						<EntityCard title='Fork Question'>
							<Question question={rootUniverse.forkQuestionDetails} loading={rootUniverse.forkQuestionDetails === undefined} />
						</EntityCard>
					) : undefined}
					<div className='workflow-question-grid market-overview-grid'>
						{hasForked ? (
							<>
								<MetricField label='Fork Time'>
									<LoadableValue loading={loadingZoltarUniverse} placeholder='Loading...'>
										<TimestampValue timestamp={rootUniverse.forkTime} />
									</LoadableValue>
								</MetricField>
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
					</div>
					{isScalarFork ? (
						<ScalarDeploymentSection
							accountAddress={accountAddress}
							childUniverses={rootUniverse.childUniverses}
							hasForked={hasForked}
							onCreateChildUniverseForOutcomeIndex={onCreateChildUniverseForOutcomeIndex}
							questionDetails={scalarQuestionDetails}
							walletMatchesActiveNetwork={walletMatchesActiveNetwork}
							zoltarChildUniverseError={zoltarChildUniverseError}
						/>
					) : (
						<ChildUniversesSection
							childUniverses={rootUniverse.childUniverses}
							emptyMessage='No child universes yet.'
							headerTitle='Child universes'
							action={child => ({
								disabled: accountAddress === undefined || !walletMatchesActiveNetwork || child.exists,
								label: child.exists ? 'Deployed' : 'Deploy Universe',
								onClick: () => onCreateChildUniverseForOutcomeIndex(child.outcomeIndex),
								className: 'secondary',
							})}
							renderBadge={child => <span className={`badge ${child.exists ? 'ok' : 'pending'}`}>{child.exists ? 'Exists' : 'Not deployed'}</span>}
							renderBody={child => <ChildUniverseDetails child={child} />}
						/>
					)}
				</>
			)}
		</EntityCard>
	)
}
