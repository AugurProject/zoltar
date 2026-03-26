import type { MarketSectionProps } from '../types/components.js'

export function MarketSection({ accountState, deploymentStatuses, marketForm, marketCreating, marketResult, marketError, onMarketFormChange, onCreateMarket, onResetMarket }: MarketSectionProps) {
	const zoltarQuestionDataStatus = deploymentStatuses.find(step => step.id === 'zoltarQuestionData')
	const securityPoolFactoryStatus = deploymentStatuses.find(step => step.id === 'securityPoolFactory')
	const requiresSecurityPool = marketForm.marketType === 'binary'

	return (
		<section class="panel market-panel">
			<div class="market-header">
				<div>
					<p class="panel-label">Market Creation</p>
					<h2>Create binary, categorical, or scalar markets</h2>
					<p class="detail">Binary markets create the question and deploy a security pool. Categorical and scalar markets create the question only.</p>
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
								<strong>{requiresSecurityPool ? (securityPoolFactoryStatus?.deployed ? 'Ready' : 'Missing') : 'Optional'}</strong>
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
									<span>Type</span>
									<strong>{marketResult.marketType}</strong>
								</li>
								<li>
									<span>Question Id</span>
									<strong>{marketResult.questionId}</strong>
								</li>
								<li>
									<span>Create Question Tx</span>
									<strong>{marketResult.createQuestionHash}</strong>
								</li>
							</ul>
							<p class="detail">Created market ID: {marketResult.questionId}</p>
						</div>
					)}
				</div>

				<div class="market-column">
					<div class="form-grid">
						<label class="field">
							<span>Market Type</span>
							<select value={marketForm.marketType} onInput={event => onMarketFormChange({ marketType: event.currentTarget.value as typeof marketForm.marketType })}>
								<option value="binary">Binary</option>
								<option value="categorical">Categorical</option>
								<option value="scalar">Scalar</option>
							</select>
						</label>

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

						{marketForm.marketType === 'categorical' ? (
							<label class="field">
								<span>Outcome Labels</span>
								<textarea value={marketForm.categoricalOutcomes} onInput={event => onMarketFormChange({ categoricalOutcomes: event.currentTarget.value })} placeholder={'One outcome per line\nApple\nBanana\nCherry'} />
							</label>
						) : null}

						{marketForm.marketType === 'scalar' ? (
							<>
								<div class="field-row">
									<label class="field">
										<span>Number Of Ticks</span>
										<input value={marketForm.numTicks} onInput={event => onMarketFormChange({ numTicks: event.currentTarget.value })} />
									</label>
									<label class="field">
										<span>Answer Unit</span>
										<input value={marketForm.answerUnit} onInput={event => onMarketFormChange({ answerUnit: event.currentTarget.value })} placeholder="USD" />
									</label>
								</div>

								<div class="field-row">
									<label class="field">
										<span>Display Value Min</span>
										<input value={marketForm.displayValueMin} onInput={event => onMarketFormChange({ displayValueMin: event.currentTarget.value })} />
									</label>
									<label class="field">
										<span>Display Value Max</span>
										<input value={marketForm.displayValueMax} onInput={event => onMarketFormChange({ displayValueMax: event.currentTarget.value })} />
									</label>
								</div>

								<label class="field">
									<span>Initial Scalar Reference Value</span>
									<input value={marketForm.scalarStartValue} onInput={event => onMarketFormChange({ scalarStartValue: event.currentTarget.value })} />
								</label>
							</>
						) : null}

						{marketForm.marketType === 'binary' ? (
							<>
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
							</>
						) : null}

						<div class="actions">
							<button onClick={onCreateMarket} disabled={accountState.address === null || marketCreating}>
								{marketCreating ? 'Creating Market...' : marketForm.marketType === 'binary' ? 'Create Market And Pool' : 'Create Question'}
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
