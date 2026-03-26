import { formatTimestamp } from '../lib/formatters.js'
import type { SecurityPoolSectionProps } from '../types/components.js'

export function SecurityPoolSection({ accountState, deploymentStatuses, lastCreatedQuestionId, loadingMarketDetails, marketDetails, onCreateSecurityPool, onLoadLatestMarket, onLoadMarket, onSecurityPoolFormChange, securityPoolCreating, securityPoolError, securityPoolForm, securityPoolResult }: SecurityPoolSectionProps) {
	const securityPoolFactoryStatus = deploymentStatuses.find(step => step.id === 'securityPoolFactory')

	return (
		<section class="panel market-panel">
			<div class="market-header">
				<div>
					<p class="panel-label">Security Pool Creation</p>
					<h2>Deploy a security pool for a binary market</h2>
					<p class="detail">Load a market by ID to inspect it before deploying. Only binary markets can have origin security pools.</p>
				</div>
			</div>

			<div class="market-grid">
				<div class="market-column">
					<div class="status-card">
						<p class="panel-label">Required Contract</p>
						<ul class="status-list">
							<li>
								<span>SecurityPoolFactory</span>
								<strong>{securityPoolFactoryStatus?.deployed ? 'Ready' : 'Missing'}</strong>
							</li>
						</ul>
						<p class="detail">Security pool factory address: {securityPoolFactoryStatus?.address ?? 'Unavailable'}</p>
					</div>

					{marketDetails === null ? null : (
						<div class="status-card">
							<p class="panel-label">Loaded Market</p>
							<ul class="status-list hashes">
								<li>
									<span>Market ID</span>
									<strong>{marketDetails.questionId}</strong>
								</li>
								<li>
									<span>Type</span>
									<strong>{marketDetails.marketType}</strong>
								</li>
								<li>
									<span>Title</span>
									<strong>{marketDetails.title}</strong>
								</li>
								<li>
									<span>Starts</span>
									<strong>{formatTimestamp(marketDetails.startTime)}</strong>
								</li>
								<li>
									<span>Ends</span>
									<strong>{formatTimestamp(marketDetails.endTime)}</strong>
								</li>
							</ul>
							<p class="detail">{marketDetails.description === '' ? 'No description provided.' : marketDetails.description}</p>
							{marketDetails.marketType === 'scalar' ? (
								<p class="detail">
									Scalar range: {marketDetails.displayValueMin.toString()} to {marketDetails.displayValueMax.toString()} {marketDetails.answerUnit}
								</p>
							) : (
								<p class="detail">Outcomes: {marketDetails.outcomeLabels.join(', ') || 'None'}</p>
							)}
						</div>
					)}

					{securityPoolResult === null ? null : (
						<div class="status-card">
							<p class="panel-label">Latest Security Pool</p>
							<ul class="status-list hashes">
								<li>
									<span>Market ID</span>
									<strong>{securityPoolResult.questionId}</strong>
								</li>
								<li>
									<span>Security Multiplier</span>
									<strong>{securityPoolResult.securityMultiplier.toString()}</strong>
								</li>
								<li>
									<span>Deploy Pool Tx</span>
									<strong>{securityPoolResult.deployPoolHash}</strong>
								</li>
							</ul>
						</div>
					)}
				</div>

				<div class="market-column">
					<div class="form-grid">
						<label class="field">
							<span>Market ID</span>
							<input value={securityPoolForm.marketId} onInput={event => onSecurityPoolFormChange({ marketId: event.currentTarget.value })} placeholder="0x..." />
						</label>

						<div class="actions">
							<button class="secondary" onClick={onLoadMarket} disabled={loadingMarketDetails}>
								{loadingMarketDetails ? 'Loading Market...' : 'Load Market'}
							</button>
							<button class="secondary" onClick={onLoadLatestMarket} disabled={lastCreatedQuestionId === null}>
								Use Latest Market
							</button>
						</div>

						<label class="field">
							<span>Security Multiplier</span>
							<input value={securityPoolForm.securityMultiplier} onInput={event => onSecurityPoolFormChange({ securityMultiplier: event.currentTarget.value })} />
						</label>

						<label class="field">
							<span>Current Retention Rate</span>
							<input value={securityPoolForm.currentRetentionRate} onInput={event => onSecurityPoolFormChange({ currentRetentionRate: event.currentTarget.value })} />
						</label>

						<label class="field">
							<span>Starting REP / ETH Price</span>
							<input value={securityPoolForm.startingRepEthPrice} onInput={event => onSecurityPoolFormChange({ startingRepEthPrice: event.currentTarget.value })} />
						</label>

						<div class="actions">
							<button onClick={onCreateSecurityPool} disabled={accountState.address === null || securityPoolCreating || marketDetails?.marketType !== 'binary'}>
								{securityPoolCreating ? 'Creating Security Pool...' : 'Create Security Pool'}
							</button>
						</div>
					</div>

					{lastCreatedQuestionId === null ? null : <p class="detail">Latest created market ID: {lastCreatedQuestionId}</p>}
					{securityPoolError === null ? null : <p class="notice error">{securityPoolError}</p>}
				</div>
			</div>
		</section>
	)
}
