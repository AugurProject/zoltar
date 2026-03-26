import { parseMarketTypeInput } from '../lib/inputs.js'
import { isMainnetChain } from '../lib/network.js'
import type { MarketSectionProps } from '../types/components.js'

export function MarketSection({ accountState, deploymentStatuses, marketForm, marketCreating, marketResult, marketError, onMarketFormChange, onCreateMarket, onResetMarket }: MarketSectionProps) {
	const isMainnet = isMainnetChain(accountState.chainId)
	const zoltarQuestionDataStatus = deploymentStatuses.find(step => step.id === 'zoltarQuestionData')
	const securityPoolFactoryStatus = deploymentStatuses.find(step => step.id === 'securityPoolFactory')
	const requiresSecurityPool = marketForm.marketType === 'binary'

	return (
		<section className="panel market-panel">
			<div className="market-header">
				<div>
					<p className="panel-label">Market Creation</p>
					<h2>Create binary, categorical, or scalar markets</h2>
					<p className="detail">Binary markets create the question and deploy a security pool. Categorical and scalar markets create the question only.</p>
				</div>
			</div>

			<div className="market-grid">
				<div className="market-column">
					<div className="status-card">
						<p className="panel-label">Required Contracts</p>
						<ul className="status-list">
							<li>
								<span>ZoltarQuestionData</span>
								<strong>{zoltarQuestionDataStatus?.deployed ? 'Ready' : 'Missing'}</strong>
							</li>
							<li>
								<span>SecurityPoolFactory</span>
								<strong>{requiresSecurityPool ? (securityPoolFactoryStatus?.deployed ? 'Ready' : 'Missing') : 'Optional'}</strong>
							</li>
						</ul>
						<p className="detail">Question data address: {zoltarQuestionDataStatus?.address ?? 'Unavailable'}</p>
						<p className="detail">Security pool factory address: {securityPoolFactoryStatus?.address ?? 'Unavailable'}</p>
					</div>

					{marketResult === undefined ? undefined : (
						<div className="status-card">
							<p className="panel-label">Latest Market</p>
							<ul className="status-list hashes">
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
							<p className="detail">Created market ID: {marketResult.questionId}</p>
						</div>
					)}
				</div>

				<div className="market-column">
					<div className="form-grid">
						<label className="field">
							<span>Market Type</span>
							<select value={marketForm.marketType} onInput={event => onMarketFormChange({ marketType: parseMarketTypeInput(event.currentTarget.value) })}>
								<option value="binary">Binary</option>
								<option value="categorical">Categorical</option>
								<option value="scalar">Scalar</option>
							</select>
						</label>

						<label className="field">
							<span>Title</span>
							<input value={marketForm.title} onInput={event => onMarketFormChange({ title: event.currentTarget.value })} placeholder="Will event X happen?" />
						</label>

						<label className="field">
							<span>Description</span>
							<textarea value={marketForm.description} onInput={event => onMarketFormChange({ description: event.currentTarget.value })} placeholder="Optional market context" />
						</label>

						<div className="field-row">
							<label className="field">
								<span>Start Time</span>
								<input type="datetime-local" value={marketForm.startTime} onInput={event => onMarketFormChange({ startTime: event.currentTarget.value })} />
							</label>
							<label className="field">
								<span>End Time</span>
								<input type="datetime-local" value={marketForm.endTime} onInput={event => onMarketFormChange({ endTime: event.currentTarget.value })} />
							</label>
						</div>

						{marketForm.marketType === 'categorical' ? (
							<label className="field">
								<span>Outcome Labels</span>
								<textarea value={marketForm.categoricalOutcomes} onInput={event => onMarketFormChange({ categoricalOutcomes: event.currentTarget.value })} placeholder={'One outcome per line\nApple\nBanana\nCherry'} />
							</label>
						) : undefined}

						{marketForm.marketType === 'scalar' ? (
							<>
								<div className="field-row">
									<label className="field">
										<span>Number Of Ticks</span>
										<input value={marketForm.numTicks} onInput={event => onMarketFormChange({ numTicks: event.currentTarget.value })} />
									</label>
									<label className="field">
										<span>Answer Unit</span>
										<input value={marketForm.answerUnit} onInput={event => onMarketFormChange({ answerUnit: event.currentTarget.value })} placeholder="USD" />
									</label>
								</div>

								<div className="field-row">
									<label className="field">
										<span>Display Value Min</span>
										<input value={marketForm.displayValueMin} onInput={event => onMarketFormChange({ displayValueMin: event.currentTarget.value })} />
									</label>
									<label className="field">
										<span>Display Value Max</span>
										<input value={marketForm.displayValueMax} onInput={event => onMarketFormChange({ displayValueMax: event.currentTarget.value })} />
									</label>
								</div>

								<label className="field">
									<span>Initial Scalar Reference Value</span>
									<input value={marketForm.scalarStartValue} onInput={event => onMarketFormChange({ scalarStartValue: event.currentTarget.value })} />
								</label>
							</>
						) : undefined}

						{marketForm.marketType === 'binary' ? (
							<>
								<div className="field-row">
									<label className="field">
										<span>Security Multiplier</span>
										<input value={marketForm.securityMultiplier} onInput={event => onMarketFormChange({ securityMultiplier: event.currentTarget.value })} />
									</label>
									<label className="field">
										<span>Current Retention Rate</span>
										<input value={marketForm.currentRetentionRate} onInput={event => onMarketFormChange({ currentRetentionRate: event.currentTarget.value })} />
									</label>
								</div>

								<label className="field">
									<span>Starting REP / ETH Price</span>
									<input value={marketForm.startingRepEthPrice} onInput={event => onMarketFormChange({ startingRepEthPrice: event.currentTarget.value })} />
								</label>
							</>
						) : undefined}

						<div className="actions">
							<button onClick={onCreateMarket} disabled={accountState.address === undefined || !isMainnet || marketCreating}>
								{marketCreating ? 'Creating Market...' : marketForm.marketType === 'binary' ? 'Create Market And Pool' : 'Create Question'}
							</button>
							<button className="secondary" onClick={onResetMarket}>
								Reset
							</button>
						</div>
					</div>

					{marketError === undefined ? undefined : <p className="notice error">{marketError}</p>}
				</div>
			</div>
		</section>
	)
}
