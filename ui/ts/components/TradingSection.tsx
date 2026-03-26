import { parseReportingOutcomeInput } from '../lib/inputs.js'
import { isMainnetChain } from '../lib/network.js'
import { REPORTING_OUTCOME_OPTIONS } from '../lib/reporting.js'
import type { TradingSectionProps } from '../types/components.js'

export function TradingSection({ accountState, onCreateCompleteSet, onMigrateShares, onRedeemCompleteSet, onRedeemShares, onTradingFormChange, tradingError, tradingForm, tradingResult }: TradingSectionProps) {
	const isMainnet = isMainnetChain(accountState.chainId)
	return (
		<section className="panel market-panel">
			<div className="market-header">
				<div>
					<p className="panel-label">Trading</p>
					<h2>Mint and redeem complete sets</h2>
					<p className="detail">Use a security pool address to create complete sets with collateral or redeem complete sets back out of the pool.</p>
				</div>
			</div>

			<div className="market-grid">
				<div className="market-column">
					{tradingResult === undefined ? undefined : (
						<div className="status-card">
							<p className="panel-label">Latest Trading Action</p>
							<p className="detail">Action: {tradingResult.action}</p>
							<p className="detail">Pool: {tradingResult.securityPoolAddress}</p>
							<p className="detail">Universe: {tradingResult.universeId.toString()}</p>
							<p className="detail">Transaction: {tradingResult.hash}</p>
						</div>
					)}
				</div>

				<div className="market-column">
					<div className="form-grid">
						<label className="field">
							<span>Security Pool Address</span>
							<input value={tradingForm.securityPoolAddress} onInput={event => onTradingFormChange({ securityPoolAddress: event.currentTarget.value })} placeholder="0x..." />
						</label>

						<div className="field-row">
							<label className="field">
								<span>Mint Complete Sets Amount</span>
								<input value={tradingForm.completeSetAmount} onInput={event => onTradingFormChange({ completeSetAmount: event.currentTarget.value })} />
							</label>
							<label className="field">
								<span>Redeem Complete Sets Amount</span>
								<input value={tradingForm.redeemAmount} onInput={event => onTradingFormChange({ redeemAmount: event.currentTarget.value })} />
							</label>
						</div>

						<div className="field-row">
							<label className="field">
								<span>From Universe ID</span>
								<input value={tradingForm.fromUniverseId} onInput={event => onTradingFormChange({ fromUniverseId: event.currentTarget.value })} />
							</label>
							<label className="field">
								<span>Outcome To Migrate</span>
								<select value={tradingForm.selectedOutcome} onInput={event => onTradingFormChange({ selectedOutcome: parseReportingOutcomeInput(event.currentTarget.value) })}>
									{REPORTING_OUTCOME_OPTIONS.map(option => (
										<option key={option.key} value={option.key}>
											{option.label}
										</option>
									))}
								</select>
							</label>
						</div>

						<div className="actions">
							<button onClick={onCreateCompleteSet} disabled={accountState.address === undefined || !isMainnet}>
								Mint Complete Sets
							</button>
							<button className="secondary" onClick={onRedeemCompleteSet} disabled={accountState.address === undefined || !isMainnet}>
								Redeem Complete Sets
							</button>
							<button className="secondary" onClick={onMigrateShares} disabled={accountState.address === undefined || !isMainnet}>
								Migrate Shares
							</button>
							<button className="secondary" onClick={onRedeemShares} disabled={accountState.address === undefined || !isMainnet}>
								Redeem Shares
							</button>
						</div>
					</div>

					{tradingError === undefined ? undefined : <p className="notice error">{tradingError}</p>}
				</div>
			</div>
		</section>
	)
}
