import { formatTimestamp } from '../lib/formatters.js'
import { isMainnetChain } from '../lib/network.js'
import type { SecurityPoolSectionProps } from '../types/components.js'

export function SecurityPoolSection({ accountState, deploymentStatuses, lastCreatedQuestionId, loadingMarketDetails, marketDetails, onCreateSecurityPool, onLoadLatestMarket, onLoadMarket, onSecurityPoolFormChange, securityPoolCreating, securityPoolError, securityPoolForm, securityPoolResult }: SecurityPoolSectionProps) {
	const isMainnet = isMainnetChain(accountState.chainId)
	const securityPoolFactoryStatus = deploymentStatuses.find(step => step.id === 'securityPoolFactory')

	return (
		<section className="panel market-panel">
			<div className="market-header">
				<div>
					<p className="panel-label">Security Pool Creation</p>
					<h2>Deploy a security pool for a binary market</h2>
					<p className="detail">Load a market by ID to inspect it before deploying. Only binary markets can have origin security pools.</p>
				</div>
			</div>

			<div className="market-grid">
				<div className="market-column">
					<div className="status-card">
						<p className="panel-label">Required Contract</p>
						<ul className="status-list">
							<li>
								<span>SecurityPoolFactory</span>
								<strong>{securityPoolFactoryStatus?.deployed ? 'Ready' : 'Missing'}</strong>
							</li>
						</ul>
						<p className="detail">Security pool factory address: {securityPoolFactoryStatus?.address ?? 'Unavailable'}</p>
					</div>

					{marketDetails === undefined ? undefined : (
						<div className="status-card">
							<p className="panel-label">Loaded Market</p>
							<ul className="status-list hashes">
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
							<p className="detail">{marketDetails.description === '' ? 'No description provided.' : marketDetails.description}</p>
							{marketDetails.marketType === 'scalar' ? (
								<p className="detail">
									Scalar range: {marketDetails.displayValueMin.toString()} to {marketDetails.displayValueMax.toString()} {marketDetails.answerUnit}
								</p>
							) : (
								<p className="detail">Outcomes: {marketDetails.outcomeLabels.join(', ') || 'None'}</p>
							)}
						</div>
					)}

					{securityPoolResult === undefined ? undefined : (
						<div className="status-card">
							<p className="panel-label">Latest Security Pool</p>
							<ul className="status-list hashes">
								<li>
									<span>Market ID</span>
									<strong>{securityPoolResult.questionId}</strong>
								</li>
								<li>
									<span>Security Multiplier</span>
									<strong>{securityPoolResult.securityMultiplier.toString()}</strong>
								</li>
								<li>
									<span>Universe</span>
									<strong>{securityPoolResult.universeId.toString()}</strong>
								</li>
								<li>
									<span>Deploy Pool Tx</span>
									<strong>{securityPoolResult.deployPoolHash}</strong>
								</li>
							</ul>
						</div>
					)}
				</div>

				<div className="market-column">
					<div className="form-grid">
						<label className="field">
							<span>Market ID</span>
							<input value={securityPoolForm.marketId} onInput={event => onSecurityPoolFormChange({ marketId: event.currentTarget.value })} placeholder="0x..." />
						</label>

						<div className="actions">
							<button className="secondary" onClick={onLoadMarket} disabled={loadingMarketDetails}>
								{loadingMarketDetails ? 'Loading Market...' : 'Load Market'}
							</button>
							<button className="secondary" onClick={onLoadLatestMarket} disabled={lastCreatedQuestionId === undefined}>
								Use Latest Market
							</button>
						</div>

						<label className="field">
							<span>Security Multiplier</span>
							<input value={securityPoolForm.securityMultiplier} onInput={event => onSecurityPoolFormChange({ securityMultiplier: event.currentTarget.value })} />
						</label>

						<label className="field">
							<span>Current Retention Rate</span>
							<input value={securityPoolForm.currentRetentionRate} onInput={event => onSecurityPoolFormChange({ currentRetentionRate: event.currentTarget.value })} />
						</label>

						<label className="field">
							<span>Starting REP / ETH Price</span>
							<input value={securityPoolForm.startingRepEthPrice} onInput={event => onSecurityPoolFormChange({ startingRepEthPrice: event.currentTarget.value })} />
						</label>

						<div className="actions">
							<button onClick={onCreateSecurityPool} disabled={accountState.address === undefined || !isMainnet || securityPoolCreating || marketDetails?.marketType !== 'binary'}>
								{securityPoolCreating ? 'Creating Security Pool...' : 'Create Security Pool'}
							</button>
						</div>
					</div>

					{lastCreatedQuestionId === undefined ? undefined : <p className="detail">Latest created market ID: {lastCreatedQuestionId}</p>}
					{securityPoolError === undefined ? undefined : <p className="notice error">{securityPoolError}</p>}
				</div>
			</div>
		</section>
	)
}
