import type { Address } from 'viem'
import { AddressValue } from './AddressValue.js'
import { CurrencyValue } from './CurrencyValue.js'
import { ChildUniverseDetails } from './ChildUniverseDetails.js'
import { EntityCard } from './EntityCard.js'
import { ChildUniversesSection } from './ChildUniversesSection.js'
import { LoadingText } from './LoadingText.js'
import { LoadableValue } from './LoadableValue.js'
import { Question } from './Question.js'
import { ScalarDeploymentSection } from './ScalarDeploymentSection.js'
import { formatTimestamp } from '../lib/formatters.js'
import { formatUniverseCollectionLabel } from '../lib/universe.js'
import type { ZoltarUniverseSummary } from '../types/contracts.js'

type MarketOverviewSectionProps = {
	accountAddress: Address | undefined
	isMainnet: boolean
	loadingZoltarUniverse: boolean
	onCreateChildUniverseForOutcomeIndex: (outcomeIndex: bigint) => void
	zoltarChildUniverseError: string | undefined
	zoltarUniverse: ZoltarUniverseSummary | undefined
	zoltarUniverseMissing: boolean
}

export function MarketOverviewSection({ accountAddress, isMainnet, loadingZoltarUniverse, onCreateChildUniverseForOutcomeIndex, zoltarChildUniverseError, zoltarUniverse, zoltarUniverseMissing }: MarketOverviewSectionProps) {
	const rootUniverse = zoltarUniverse
	const universeMissing = rootUniverse === undefined && zoltarUniverseMissing && !loadingZoltarUniverse
	const hasForked = rootUniverse?.hasForked === true
	const currentUniverseName = rootUniverse === undefined ? undefined : formatUniverseCollectionLabel([rootUniverse.universeId])
	const isScalarFork = rootUniverse?.forkQuestionDetails?.marketType === 'scalar'
	const scalarQuestionDetails = rootUniverse?.forkQuestionDetails

	if (universeMissing) {
		return (
			<EntityCard className='market-overview-card' title='Zoltar universe missing' badge={<span className='badge blocked'>Missing</span>}>
				<p className='notice error'>The universe does not exist.</p>
			</EntityCard>
		)
	}

	return (
		<EntityCard className='market-overview-card' title={rootUniverse === undefined ? 'Universe' : (currentUniverseName ?? 'Universe')} badge={rootUniverse === undefined ? undefined : <span className='badge ok'>{hasForked ? 'Forked' : 'Unforked'}</span>}>
			{rootUniverse === undefined ? (
				<p className='detail market-overview-loading'>
					<LoadingText>Loading Universe Data...</LoadingText>
				</p>
			) : (
				<>
					{hasForked ? (
						<EntityCard title='Fork Question' badge={<span className='badge muted'>{rootUniverse.forkQuestionDetails?.marketType ?? 'Loading'}</span>}>
							<Question question={rootUniverse.forkQuestionDetails} loading={rootUniverse.forkQuestionDetails === undefined} />
						</EntityCard>
					) : undefined}
					<div className='workflow-question-grid market-overview-grid'>
						{hasForked ? (
							<>
								<div>
									<span className='metric-label'>Fork Time</span>
									<strong>
										<LoadableValue loading={loadingZoltarUniverse} placeholder='Loading...'>
											{formatTimestamp(rootUniverse.forkTime)}
										</LoadableValue>
									</strong>
								</div>
								<div>
									<span className='metric-label'>Fork Threshold</span>
									<strong>
										<CurrencyValue value={rootUniverse.forkThreshold} suffix='REP' />
									</strong>
								</div>
							</>
						) : undefined}
						<div>
							<span className='metric-label'>Reputation Token</span>
							<strong>
								<AddressValue address={rootUniverse.reputationToken} />
							</strong>
						</div>
						<div>
							<span className='metric-label'>Total Theoretical Supply</span>
							<strong>
								<CurrencyValue value={rootUniverse.totalTheoreticalSupply} suffix='REP' />
							</strong>
						</div>
					</div>
					{isScalarFork ? (
						<ScalarDeploymentSection
							accountAddress={accountAddress}
							childUniverses={rootUniverse.childUniverses}
							hasForked={hasForked}
							isMainnet={isMainnet}
							onCreateChildUniverseForOutcomeIndex={onCreateChildUniverseForOutcomeIndex}
							questionDetails={scalarQuestionDetails}
							zoltarChildUniverseError={zoltarChildUniverseError}
						/>
					) : (
						<ChildUniversesSection
							childUniverses={rootUniverse.childUniverses}
							emptyMessage='No child universes yet.'
							headerTitle='Child universes'
							action={child => ({
								disabled: accountAddress === undefined || !isMainnet || child.exists,
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
