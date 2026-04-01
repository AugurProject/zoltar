import { EnumDropdown } from './EnumDropdown.js'
import { UniverseLink } from './UniverseLink.js'
import { isMainnetChain } from '../lib/network.js'
import { REPORTING_OUTCOME_OPTIONS } from '../lib/reporting.js'
import type { TradingSectionProps } from '../types/components.js'

export function TradingSection({ accountState, onCreateCompleteSet, onMigrateShares, onRedeemCompleteSet, onRedeemShares, onTradingFormChange, tradingError, tradingForm, tradingResult, showHeader = true, showSecurityPoolAddressInput = true }: TradingSectionProps) {
	const isMainnet = isMainnetChain(accountState.chainId)
	const isTradingDisabled = accountState.address === undefined || !isMainnet
	return (
		<section className="panel market-panel">
			{showHeader ? (
				<div className="market-header">
					<div>
						<h2>Trading</h2>
						<p className="detail">Use a security pool address to create complete sets with collateral or redeem complete sets back out of the pool.</p>
					</div>
				</div>
			) : undefined}

			<div className="market-grid">
				<div className="market-column">
					{tradingResult === undefined ? undefined : (
						<div className="status-card">
							<p className="panel-label">Latest Trading Action</p>
							<p className="detail">Action: {tradingResult.action}</p>
							<p className="detail">Pool: {tradingResult.securityPoolAddress}</p>
							<p className="detail">
								Universe: <UniverseLink universeId={tradingResult.universeId} />
							</p>
							<p className="detail">Transaction: {tradingResult.hash}</p>
						</div>
					)}
				</div>

				<div className="market-column">
					<div className="form-grid">
						{showSecurityPoolAddressInput ? (
							<label className="field">
								<span>Security Pool Address</span>
								<input value={tradingForm.securityPoolAddress} onInput={event => onTradingFormChange({ securityPoolAddress: event.currentTarget.value })} placeholder="0x..." />
							</label>
						) : undefined}

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
								<EnumDropdown options={REPORTING_OUTCOME_OPTIONS.map(option => ({ value: option.key, label: option.label }))} value={tradingForm.selectedOutcome} onChange={selectedOutcome => onTradingFormChange({ selectedOutcome })} />
							</label>
						</div>

						<div className="actions">
							<button onClick={onCreateCompleteSet} disabled={isTradingDisabled}>
								Mint Complete Sets
							</button>
							<button className="secondary" onClick={onRedeemCompleteSet} disabled={isTradingDisabled}>
								Redeem Complete Sets
							</button>
							<button className="secondary" onClick={onMigrateShares} disabled={isTradingDisabled}>
								Migrate Shares
							</button>
							<button className="secondary" onClick={onRedeemShares} disabled={isTradingDisabled}>
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
