import type { TradingSectionProps } from '../types/components.js'

export function TradingSection({ accountState, onCreateCompleteSet, onRedeemCompleteSet, onTradingFormChange, tradingError, tradingForm, tradingResult }: TradingSectionProps) {
	return (
		<section class="panel market-panel">
			<div class="market-header">
				<div>
					<p class="panel-label">Trading</p>
					<h2>Mint and redeem complete sets</h2>
					<p class="detail">Use a security pool address to create complete sets with collateral or redeem complete sets back out of the pool.</p>
				</div>
			</div>

			<div class="market-grid">
				<div class="market-column">
					{tradingResult === undefined ? null : (
						<div class="status-card">
							<p class="panel-label">Latest Trading Action</p>
							<p class="detail">Action: {tradingResult.action}</p>
							<p class="detail">Pool: {tradingResult.securityPoolAddress}</p>
							<p class="detail">Universe: {tradingResult.universeId.toString()}</p>
							<p class="detail">Transaction: {tradingResult.hash}</p>
						</div>
					)}
				</div>

				<div class="market-column">
					<div class="form-grid">
						<label class="field">
							<span>Security Pool Address</span>
							<input value={tradingForm.securityPoolAddress} onInput={event => onTradingFormChange({ securityPoolAddress: event.currentTarget.value })} placeholder="0x..." />
						</label>

						<div class="field-row">
							<label class="field">
								<span>Mint Complete Sets Amount</span>
								<input value={tradingForm.completeSetAmount} onInput={event => onTradingFormChange({ completeSetAmount: event.currentTarget.value })} />
							</label>
							<label class="field">
								<span>Redeem Complete Sets Amount</span>
								<input value={tradingForm.redeemAmount} onInput={event => onTradingFormChange({ redeemAmount: event.currentTarget.value })} />
							</label>
						</div>

						<div class="actions">
							<button onClick={onCreateCompleteSet} disabled={accountState.address === undefined || !accountState.isMainnet}>
								Mint Complete Sets
							</button>
							<button class="secondary" onClick={onRedeemCompleteSet} disabled={accountState.address === undefined || !accountState.isMainnet}>
								Redeem Complete Sets
							</button>
						</div>
					</div>

					{tradingError === undefined ? null : <p class="notice error">{tradingError}</p>}
				</div>
			</div>
		</section>
	)
}
