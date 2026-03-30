import { EntityCard } from './EntityCard.js'
import { QuestionSummaryHeader } from './QuestionSummary.js'
import { UniverseLink } from './UniverseLink.js'
import { isMainnetChain } from '../lib/network.js'
import { formatOpenInterestFeePerYearPercent } from '../lib/retentionRate.js'
import type { SecurityPoolSectionProps } from '../types/components.js'

export function SecurityPoolSection({ accountState, checkingDuplicateOriginPool, duplicateOriginPoolExists, lastCreatedQuestionId, loadingMarketDetails, marketDetails, onCreateSecurityPool, onLoadLatestMarket, onLoadMarket, onSecurityPoolFormChange, securityPools, securityPoolCreating, securityPoolError, securityPoolForm, securityPoolResult, showHeader = true }: SecurityPoolSectionProps) {
	const isMainnet = isMainnetChain(accountState.chainId)
	const isCreateDisabled = accountState.address === undefined || !isMainnet || securityPoolCreating || checkingDuplicateOriginPool || duplicateOriginPoolExists || marketDetails?.marketType !== 'binary'
	const matchingPools = marketDetails === undefined ? [] : securityPools.filter(pool => pool.questionId.toLowerCase() === marketDetails.questionId.toLowerCase())
	const hasMatchingSecurityMultiplier = matchingPools.some(pool => pool.securityMultiplier.toString() === securityPoolForm.securityMultiplier.trim())

	return (
		<section className="panel market-panel">
			{showHeader ? (
				<div className="market-header">
					<div>
						<h2>Create Pool</h2>
					</div>
				</div>
			) : undefined}

			<div className="market-grid">
				<div className="market-column">
					{marketDetails === undefined ? undefined : (
						<EntityCard
							title={marketDetails.title === '' ? 'Untitled question' : marketDetails.title}
							badge={<span className="badge ok">{marketDetails.marketType}</span>}
							actions={
								<div className="actions">
									<button className="secondary" onClick={onLoadMarket} disabled={loadingMarketDetails}>
										{loadingMarketDetails ? 'Loading Question...' : 'Reload Question'}
									</button>
									<button className="secondary" onClick={onLoadLatestMarket} disabled={lastCreatedQuestionId === undefined}>
										Use Latest Question
									</button>
								</div>
							}
						>
							<QuestionSummaryHeader description={marketDetails.description.trim() === '' ? 'No description provided.' : marketDetails.description} questionId={marketDetails.questionId} title={marketDetails.title.trim() === '' ? 'Untitled question' : marketDetails.title} />
							{marketDetails.marketType === 'scalar' ? undefined : (
								<div className="question-chip-row">
									{marketDetails.outcomeLabels.map(label => (
										<span key={label} className="status-chip muted">
											{label}
										</span>
									))}
								</div>
							)}
						</EntityCard>
					)}

					{matchingPools.length === 0 ? undefined : (
						<EntityCard title="Existing Pools For This Question" badge={<span className="badge muted">{matchingPools.length} existing</span>}>
							<div className="entity-card-list">
								{matchingPools.map(pool => (
									<EntityCard key={pool.securityPoolAddress} className="compact" title={pool.securityPoolAddress} badge={<span className="badge ok">{pool.systemState}</span>}>
										<div className="workflow-vault-grid">
											<div>
												<span className="metric-label">Security Multiplier</span>
												<strong>{pool.securityMultiplier.toString()}</strong>
											</div>
											<div>
												<span className="metric-label">Open Interest Fee / Year</span>
												<strong>{formatOpenInterestFeePerYearPercent(pool.currentRetentionRate)}</strong>
											</div>
										</div>
									</EntityCard>
								))}
							</div>
						</EntityCard>
					)}

					{securityPoolResult === undefined ? undefined : (
						<EntityCard title="Pool created" badge={<span className="badge ok">Deployed</span>}>
							<ul className="status-list hashes">
								<li>
									<span>Question ID</span>
									<strong>{securityPoolResult.questionId}</strong>
								</li>
								<li>
									<span>Security Multiplier</span>
									<strong>{securityPoolResult.securityMultiplier.toString()}</strong>
								</li>
								<li>
									<span>Universe</span>
									<strong>
										<UniverseLink universeId={securityPoolResult.universeId} />
									</strong>
								</li>
								<li>
									<span>Deploy Pool Tx</span>
									<strong>{securityPoolResult.deployPoolHash}</strong>
								</li>
							</ul>
						</EntityCard>
					)}
				</div>

				<div className="market-column">
					<div className="form-grid">
						<label className="field">
							<span>Question ID</span>
							<input value={securityPoolForm.marketId} onInput={event => onSecurityPoolFormChange({ marketId: event.currentTarget.value })} placeholder="0x..." />
						</label>

						<div className="actions">
							<button className="secondary" onClick={onLoadMarket} disabled={loadingMarketDetails}>
								{loadingMarketDetails ? 'Loading Question...' : 'Load Question'}
							</button>
							<button className="secondary" onClick={onLoadLatestMarket} disabled={lastCreatedQuestionId === undefined}>
								Use Latest Question
							</button>
						</div>

						<label className="field">
							<span>Security Multiplier</span>
							<input value={securityPoolForm.securityMultiplier} onInput={event => onSecurityPoolFormChange({ securityMultiplier: event.currentTarget.value })} />
						</label>

						<label className="field">
							<span>Open Interest Fee / Year (%)</span>
							<input value={securityPoolForm.currentRetentionRate} onInput={event => onSecurityPoolFormChange({ currentRetentionRate: event.currentTarget.value })} placeholder={formatOpenInterestFeePerYearPercent(999999996848000000n)} />
						</label>

						<label className="field">
							<span>Starting REP / ETH Price</span>
							<input value={securityPoolForm.startingRepEthPrice} onInput={event => onSecurityPoolFormChange({ startingRepEthPrice: event.currentTarget.value })} />
						</label>

						<div className="actions">
							<button onClick={onCreateSecurityPool} disabled={isCreateDisabled}>
								{securityPoolCreating ? 'Creating Pool...' : checkingDuplicateOriginPool ? 'Checking Duplicate...' : duplicateOriginPoolExists ? 'Pool Already Exists' : matchingPools.length > 0 ? 'Create Another Pool' : 'Create Pool'}
							</button>
						</div>
					</div>

					{!duplicateOriginPoolExists && !hasMatchingSecurityMultiplier ? undefined : <p className="detail">A pool for this question and security multiplier already exists. Origin pool deployment is deterministic for that pair, so change the security multiplier to create a different pool.</p>}
					{securityPoolError === undefined ? undefined : <p className="notice error">{securityPoolError}</p>}
				</div>
			</div>
		</section>
	)
}
