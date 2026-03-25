import type { MarketSectionProps } from '../types/components.js'

export function MarketSection({ accountState, deploymentStatuses, marketForm, marketCreating, marketResult, marketError, onMarketFormChange, onCreateMarket, onResetMarket }: MarketSectionProps) {
	const zoltarQuestionDataStatus = deploymentStatuses.find(step => step.id === 'zoltarQuestionData')
	const securityPoolFactoryStatus = deploymentStatuses.find(step => step.id === 'securityPoolFactory')

	return (
		<section class="panel market-panel">
			<div class="market-header">
				<div>
					<p class="panel-label">Market Creation</p>
					<h2>Create yes/no markets</h2>
					<p class="detail">This uses the built contract artifacts and deterministic addresses from the deployment flow already shown above.</p>
				</div>
			</div>

			<div class="market-grid">
				<div class="market-column">
					<div class="status-card">
						<p class="panel-label">Required Contracts</p>
						<ul class="status-list">
							<li>
								<span>ZoltarQuestionData</span>
								<strong>{zoltarQuestionDataStatus?.deployed ? 'Ready' : 'Missing'}</strong>
							</li>
							<li>
								<span>SecurityPoolFactory</span>
								<strong>{securityPoolFactoryStatus?.deployed ? 'Ready' : 'Missing'}</strong>
							</li>
						</ul>
						<p class="detail">Question data address: {zoltarQuestionDataStatus?.address ?? 'Unavailable'}</p>
						<p class="detail">Security pool factory address: {securityPoolFactoryStatus?.address ?? 'Unavailable'}</p>
					</div>

					{marketResult === null ? null : (
						<div class="status-card">
							<p class="panel-label">Latest Market</p>
							<ul class="status-list hashes">
								<li>
									<span>Question Id</span>
									<strong>{marketResult.questionId}</strong>
								</li>
								<li>
									<span>Create Question Tx</span>
									<strong>{marketResult.createQuestionHash}</strong>
								</li>
								<li>
									<span>Deploy Pool Tx</span>
									<strong>{marketResult.deployPoolHash}</strong>
								</li>
							</ul>
						</div>
					)}
				</div>

				<div class="market-column">
					<div class="form-grid">
						<label class="field">
							<span>Title</span>
							<input value={marketForm.title} onInput={event => onMarketFormChange({ title: event.currentTarget.value })} placeholder="Will event X happen?" />
						</label>

						<label class="field">
							<span>Description</span>
							<textarea value={marketForm.description} onInput={event => onMarketFormChange({ description: event.currentTarget.value })} placeholder="Optional market context" />
						</label>

						<div class="field-row">
							<label class="field">
								<span>Start Time</span>
								<input type="datetime-local" value={marketForm.startTime} onInput={event => onMarketFormChange({ startTime: event.currentTarget.value })} />
							</label>
							<label class="field">
								<span>End Time</span>
								<input type="datetime-local" value={marketForm.endTime} onInput={event => onMarketFormChange({ endTime: event.currentTarget.value })} />
							</label>
						</div>

						<div class="field-row">
							<label class="field">
								<span>Security Multiplier</span>
								<input value={marketForm.securityMultiplier} onInput={event => onMarketFormChange({ securityMultiplier: event.currentTarget.value })} />
							</label>
							<label class="field">
								<span>Current Retention Rate</span>
								<input value={marketForm.currentRetentionRate} onInput={event => onMarketFormChange({ currentRetentionRate: event.currentTarget.value })} />
							</label>
						</div>

						<label class="field">
							<span>Starting REP / ETH Price</span>
							<input value={marketForm.startingRepEthPrice} onInput={event => onMarketFormChange({ startingRepEthPrice: event.currentTarget.value })} />
						</label>

						<div class="actions">
							<button onClick={onCreateMarket} disabled={accountState.address === null || marketCreating}>
								{marketCreating ? 'Creating Market...' : 'Create Market'}
							</button>
							<button class="secondary" onClick={onResetMarket}>
								Reset
							</button>
						</div>
					</div>

					{marketError === null ? null : <p class="notice error">{marketError}</p>}
				</div>
			</div>
		</section>
	)
}
