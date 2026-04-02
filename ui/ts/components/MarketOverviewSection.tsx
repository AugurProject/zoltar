import type { Address } from 'viem'
import { ChildUniverseDetails } from './ChildUniverseDetails.js'
import { EntityCard } from './EntityCard.js'
import { ChildUniversesSection } from './ChildUniversesSection.js'
import { LoadableValue } from './LoadableValue.js'
import { QuestionSummaryHeader } from './QuestionSummary.js'
import { ScalarDeploymentSection } from './ScalarDeploymentSection.js'
import { formatCurrencyBalance, formatTimestamp } from '../lib/formatters.js'
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
	const currentUniverseName = rootUniverse === undefined ? (universeMissing ? 'Missing' : 'Loading...') : formatUniverseCollectionLabel([rootUniverse.universeId])
	const forkQuestionLabel = rootUniverse === undefined ? 'Loading...' : (rootUniverse.forkQuestionDetails?.questionId ?? 'Loading question details...')
	const isScalarFork = rootUniverse?.forkQuestionDetails?.marketType === 'scalar'
	const scalarQuestionDetails = rootUniverse?.forkQuestionDetails

	if (universeMissing) {
		return (
			<EntityCard className="market-overview-card" title="Zoltar universe missing" badge={<span className="badge blocked">Missing</span>}>
				<p className="notice error">The universe does not exist.</p>
			</EntityCard>
		)
	}

	return (
		<EntityCard className="market-overview-card" title={`Zoltar universe ${currentUniverseName}`} badge={<span className="badge ok">{rootUniverse === undefined ? 'Loading...' : hasForked ? 'Forked' : 'Unforked'}</span>}>
			{rootUniverse === undefined ? (
				<p className="detail market-overview-loading">Loading Zoltar universe...</p>
			) : (
				<>
					<div className="workflow-question-grid market-overview-grid">
						{hasForked ? (
							<>
								<div className="market-overview-question-summary">
									<span className="metric-label">Fork Question</span>
									<QuestionSummaryHeader description={rootUniverse.forkQuestionDetails === undefined ? 'Loading question details...' : rootUniverse.forkQuestionDetails.description.trim() === '' ? 'No description provided.' : rootUniverse.forkQuestionDetails.description} loading={rootUniverse.forkQuestionDetails === undefined} questionId={forkQuestionLabel} title={rootUniverse.forkQuestionDetails === undefined ? 'Question details' : rootUniverse.forkQuestionDetails.title.trim() === '' ? 'Untitled question' : rootUniverse.forkQuestionDetails.title} />
								</div>
								<div>
									<span className="metric-label">Fork Time</span>
									<strong>
										<LoadableValue loading={loadingZoltarUniverse} placeholder="Loading...">
											{formatTimestamp(rootUniverse.forkTime)}
										</LoadableValue>
									</strong>
								</div>
								<div>
									<span className="metric-label">Fork Threshold</span>
									<strong>{`${formatCurrencyBalance(rootUniverse.forkThreshold)} REP`}</strong>
								</div>
							</>
						) : undefined}
						<div>
							<span className="metric-label">Reputation Token</span>
							<strong>{rootUniverse.reputationToken}</strong>
						</div>
						<div>
							<span className="metric-label">Total Theoretical Supply</span>
							<strong>{`${formatCurrencyBalance(rootUniverse.totalTheoreticalSupply)} REP`}</strong>
						</div>
					</div>
					{isScalarFork ? (
						<ScalarDeploymentSection accountAddress={accountAddress} childUniverses={rootUniverse.childUniverses} hasForked={hasForked} isMainnet={isMainnet} onCreateChildUniverseForOutcomeIndex={onCreateChildUniverseForOutcomeIndex} questionDetails={scalarQuestionDetails} zoltarChildUniverseError={zoltarChildUniverseError} />
					) : (
						<ChildUniversesSection
							childUniverses={rootUniverse.childUniverses}
							emptyMessage="No child universes yet."
							headerTitle="Child universes"
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
