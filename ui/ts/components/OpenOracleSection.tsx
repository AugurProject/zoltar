import { parseOracleQueueOperationInput } from '../lib/inputs.js'
import type { OpenOracleSectionProps } from '../types/components.js'

export function OpenOracleSection({ accountState, loadingOracleManager, onApproveToken1, onApproveToken2, onLoadOracleManager, onOpenOracleFormChange, onQueueOperation, onRequestPrice, onSettleReport, onSubmitInitialReport, openOracleError, openOracleForm, openOracleResult, oracleManagerDetails }: OpenOracleSectionProps) {
	return (
		<section class="panel market-panel">
			<div class="market-header">
				<div>
					<p class="panel-label">Open Oracle</p>
					<h2>Operate price requests and reports</h2>
					<p class="detail">Load a price-oracle manager to request pricing, inspect pending report state, approve tokens for OpenOracle, submit a report, and settle it.</p>
				</div>
			</div>

			<div class="market-grid">
				<div class="market-column">
					{oracleManagerDetails === undefined ? undefined : (
						<div class="status-card">
							<p class="panel-label">Oracle Manager</p>
							<ul class="status-list hashes">
								<li>
									<span>Manager</span>
									<strong>{oracleManagerDetails.managerAddress}</strong>
								</li>
								<li>
									<span>OpenOracle</span>
									<strong>{oracleManagerDetails.openOracleAddress}</strong>
								</li>
								<li>
									<span>Pending Report ID</span>
									<strong>{oracleManagerDetails.pendingReportId.toString()}</strong>
								</li>
								<li>
									<span>Last Price</span>
									<strong>{oracleManagerDetails.lastPrice.toString()}</strong>
								</li>
								<li>
									<span>Request Price ETH Cost</span>
									<strong>{oracleManagerDetails.requestPriceEthCost.toString()}</strong>
								</li>
								<li>
									<span>State Hash</span>
									<strong>{oracleManagerDetails.callbackStateHash ?? 'Unavailable'}</strong>
								</li>
							</ul>
							<p class="detail">Token1: {oracleManagerDetails.token1 ?? 'Unavailable'}</p>
							<p class="detail">Token2: {oracleManagerDetails.token2 ?? 'Unavailable'}</p>
						</div>
					)}

					{openOracleResult === undefined ? undefined : (
						<div class="status-card">
							<p class="panel-label">Latest Oracle Action</p>
							<p class="detail">Action: {openOracleResult.action}</p>
							<p class="detail">Transaction: {openOracleResult.hash}</p>
						</div>
					)}
				</div>

				<div class="market-column">
					<div class="form-grid">
						<label class="field">
							<span>Manager Address</span>
							<input value={openOracleForm.managerAddress} onInput={event => onOpenOracleFormChange({ managerAddress: event.currentTarget.value })} placeholder="0x..." />
						</label>

						<div class="actions">
							<button class="secondary" onClick={onLoadOracleManager} disabled={loadingOracleManager}>
								{loadingOracleManager ? 'Loading Oracle...' : 'Load Oracle Manager'}
							</button>
							<button onClick={onRequestPrice} disabled={accountState.address === undefined || !accountState.isMainnet}>
								Request Price
							</button>
						</div>

						<label class="field">
							<span>Queued Operation</span>
							<select value={openOracleForm.queuedOperation} onInput={event => onOpenOracleFormChange({ queuedOperation: parseOracleQueueOperationInput(event.currentTarget.value) })}>
								<option value="liquidation">Liquidation</option>
								<option value="withdrawRep">Withdraw REP</option>
								<option value="setSecurityBondsAllowance">Set Security Bonds Allowance</option>
							</select>
						</label>

						<div class="field-row">
							<label class="field">
								<span>Operation Target Vault</span>
								<input value={openOracleForm.operationTargetVault} onInput={event => onOpenOracleFormChange({ operationTargetVault: event.currentTarget.value })} placeholder="0x..." />
							</label>
							<label class="field">
								<span>Operation Amount</span>
								<input value={openOracleForm.operationAmount} onInput={event => onOpenOracleFormChange({ operationAmount: event.currentTarget.value })} />
							</label>
						</div>

						<div class="actions">
							<button class="secondary" onClick={onQueueOperation} disabled={accountState.address === undefined || !accountState.isMainnet}>
								Request Price If Needed & Queue Operation
							</button>
						</div>

						<label class="field">
							<span>Report ID</span>
							<input value={openOracleForm.reportId} onInput={event => onOpenOracleFormChange({ reportId: event.currentTarget.value })} />
						</label>

						<label class="field">
							<span>State Hash</span>
							<input value={openOracleForm.stateHash} onInput={event => onOpenOracleFormChange({ stateHash: event.currentTarget.value })} />
						</label>

						<div class="field-row">
							<label class="field">
								<span>Token1 Amount</span>
								<input value={openOracleForm.amount1} onInput={event => onOpenOracleFormChange({ amount1: event.currentTarget.value })} />
							</label>
							<label class="field">
								<span>Token2 Amount</span>
								<input value={openOracleForm.amount2} onInput={event => onOpenOracleFormChange({ amount2: event.currentTarget.value })} />
							</label>
						</div>

						<div class="actions">
							<button class="secondary" onClick={onApproveToken1} disabled={accountState.address === undefined || !accountState.isMainnet}>
								Approve Token1
							</button>
							<button class="secondary" onClick={onApproveToken2} disabled={accountState.address === undefined || !accountState.isMainnet}>
								Approve Token2
							</button>
						</div>

						<div class="actions">
							<button onClick={onSubmitInitialReport} disabled={accountState.address === undefined || !accountState.isMainnet}>
								Submit Initial Report
							</button>
							<button class="secondary" onClick={onSettleReport} disabled={accountState.address === undefined || !accountState.isMainnet}>
								Settle Report
							</button>
						</div>
					</div>

					{openOracleError === undefined ? undefined : <p class="notice error">{openOracleError}</p>}
				</div>
			</div>
		</section>
	)
}
