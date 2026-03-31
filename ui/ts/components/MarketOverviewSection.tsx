import type { Address } from 'viem'
import { EntityCard } from './EntityCard.js'
import { LoadableValue } from './LoadableValue.js'
import { QuestionSummaryHeader } from './QuestionSummary.js'
import { ScalarDeploymentSection } from './ScalarDeploymentSection.js'
import { UniverseLink } from './UniverseLink.js'
import { formatAddress, formatCurrencyBalance, formatTimestamp } from '../lib/formatters.js'
import { formatUniverseCollectionLabel } from '../lib/universe.js'
import type { ZoltarUniverseSummary } from '../types/contracts.js'

type MarketOverviewSectionProps = {
	accountAddress: Address | undefined
	isMainnet: boolean
	loadingZoltarUniverse: boolean
	onCreateChildUniverseForOutcomeIndex: (outcomeIndex: bigint) => void
	onLoadZoltarUniverse: () => void
	zoltarChildUniverseError: string | undefined
	zoltarUniverse: ZoltarUniverseSummary | undefined
}

export function MarketOverviewSection({ accountAddress, isMainnet, loadingZoltarUniverse, onCreateChildUniverseForOutcomeIndex, onLoadZoltarUniverse, zoltarChildUniverseError, zoltarUniverse }: MarketOverviewSectionProps) {
	const rootUniverse = zoltarUniverse
	const hasForked = rootUniverse?.hasForked === true
	const currentUniverseName = rootUniverse === undefined ? 'Loading...' : formatUniverseCollectionLabel([rootUniverse.universeId])
	const forkQuestionLabel = rootUniverse === undefined ? 'Loading...' : (rootUniverse.forkQuestionDetails?.questionId ?? 'Loading question details...')
	const isScalarFork = rootUniverse?.forkQuestionDetails?.marketType === 'scalar'
	const scalarQuestionDetails = rootUniverse?.forkQuestionDetails

	return (
		<EntityCard
			className="market-overview-card"
			title={`Zoltar universe ${ currentUniverseName }`}
			badge={<span className="badge ok">{rootUniverse === undefined ? 'Loading...' : hasForked ? 'Forked' : 'Unforked'}</span>}
			actions={
				<button className="secondary" onClick={onLoadZoltarUniverse} disabled={loadingZoltarUniverse}>
					{loadingZoltarUniverse ? 'Loading Universe...' : 'Refresh Universe'}
				</button>
			}
		>
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
									<strong>{`${ formatCurrencyBalance(rootUniverse.forkThreshold) } REP`}</strong>
								</div>
							</>
						) : undefined}
						<div>
							<span className="metric-label">Reputation Token</span>
							<strong>{formatAddress(rootUniverse.reputationToken)}</strong>
						</div>
					</div>
					{isScalarFork ? (
						<ScalarDeploymentSection accountAddress={accountAddress} childUniverses={rootUniverse.childUniverses} hasForked={hasForked} isMainnet={isMainnet} onCreateChildUniverseForOutcomeIndex={onCreateChildUniverseForOutcomeIndex} questionDetails={scalarQuestionDetails} zoltarChildUniverseError={zoltarChildUniverseError} />
					) : rootUniverse.childUniverses.length === 0 ? undefined : (
						<div className="entity-card-subsection market-overview-subsection">
							<div className="entity-card-subsection-header">
								<h4>Child universes</h4>
							</div>
							<div className="entity-card-list">
								{rootUniverse.childUniverses.map(child => (
									<EntityCard
										key={child.universeId.toString()}
										className="compact"
										title={<UniverseLink universeId={child.universeId} />}
										badge={<span className={`badge ${ child.exists ? 'ok' : 'pending' }`}>{child.exists ? 'Exists' : 'Not deployed'}</span>}
										actions={
											<button className="secondary" onClick={() => onCreateChildUniverseForOutcomeIndex(child.outcomeIndex)} disabled={accountAddress === undefined || !isMainnet || child.exists}>
												{child.exists ? 'Deployed' : 'Deploy Universe'}
											</button>
										}
									>
										<div className="workflow-vault-grid">
											<div>
												<span className="metric-label">Outcome</span>
												<strong>{child.outcomeLabel}</strong>
											</div>
											{child.exists ? (
												<div>
													<span className="metric-label">Reputation Token</span>
													<strong>{formatAddress(child.reputationToken)}</strong>
												</div>
											) : undefined}
											<div>
												<span className="metric-label">Fork Time</span>
												<strong>{child.forkTime === 0n ? 'Not forked yet' : formatTimestamp(child.forkTime)}</strong>
											</div>
										</div>
									</EntityCard>
								))}
							</div>
						</div>
					)}
				</>
			)}
		</EntityCard>
	)
}
