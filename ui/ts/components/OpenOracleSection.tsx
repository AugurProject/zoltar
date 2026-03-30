import { parseOracleQueueOperationInput } from '../lib/inputs.js'
import { isMainnetChain } from '../lib/network.js'
import type { OpenOracleSectionProps } from '../types/components.js'

export function OpenOracleSection({ accountState, loadingOracleManager, onApproveToken1, onApproveToken2, onLoadOracleManager, onOpenOracleFormChange, onQueueOperation, onRequestPrice, onSettleReport, onSubmitInitialReport, openOracleError, openOracleForm, openOracleResult, oracleManagerDetails }: OpenOracleSectionProps) {
	const isMainnet = isMainnetChain(accountState.chainId)
	return (
		<section className="panel market-panel">
			<div className="market-header">
				<div></div>
			</div>

			<div className="market-grid">
				<div className="market-column">
					{oracleManagerDetails === undefined ? undefined : (
						<div className="status-card">
							<p className="panel-label">Oracle Manager</p>
							<ul className="status-list hashes">
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
							<p className="detail">Token1: {oracleManagerDetails.token1 ?? 'Unavailable'}</p>
							<p className="detail">Token2: {oracleManagerDetails.token2 ?? 'Unavailable'}</p>
						</div>
					)}

					{openOracleResult === undefined ? undefined : (
						<div className="status-card">
							<p className="panel-label">Latest Oracle Action</p>
							<p className="detail">Action: {openOracleResult.action}</p>
							<p className="detail">Transaction: {openOracleResult.hash}</p>
						</div>
					)}
				</div>

				<div className="market-column">
					<div className="form-grid">
						<label className="field">
							<span>Manager Address</span>
							<input value={openOracleForm.managerAddress} onInput={event => onOpenOracleFormChange({ managerAddress: event.currentTarget.value })} placeholder="0x..." />
						</label>

						<div className="actions">
							<button className="secondary" onClick={onLoadOracleManager} disabled={loadingOracleManager}>
								{loadingOracleManager ? 'Loading Oracle...' : 'Load Oracle Manager'}
							</button>
							<button onClick={onRequestPrice} disabled={accountState.address === undefined || !isMainnet}>
								Request Price
							</button>
						</div>

						<label className="field">
							<span>Queued Operation</span>
							<select value={openOracleForm.queuedOperation} onInput={event => onOpenOracleFormChange({ queuedOperation: parseOracleQueueOperationInput(event.currentTarget.value) })}>
								<option value="liquidation">Liquidation</option>
								<option value="withdrawRep">Withdraw REP</option>
								<option value="setSecurityBondsAllowance">Set Security Bonds Allowance</option>
							</select>
						</label>

						<div className="field-row">
							<label className="field">
								<span>Operation Target Vault</span>
								<input value={openOracleForm.operationTargetVault} onInput={event => onOpenOracleFormChange({ operationTargetVault: event.currentTarget.value })} placeholder="0x..." />
							</label>
							<label className="field">
								<span>Operation Amount</span>
								<input value={openOracleForm.operationAmount} onInput={event => onOpenOracleFormChange({ operationAmount: event.currentTarget.value })} />
							</label>
						</div>

						<div className="actions">
							<button className="secondary" onClick={onQueueOperation} disabled={accountState.address === undefined || !isMainnet}>
								Request Price If Needed & Queue Operation
							</button>
						</div>

						<label className="field">
							<span>Report ID</span>
							<input value={openOracleForm.reportId} onInput={event => onOpenOracleFormChange({ reportId: event.currentTarget.value })} />
						</label>

						<label className="field">
							<span>State Hash</span>
							<input value={openOracleForm.stateHash} onInput={event => onOpenOracleFormChange({ stateHash: event.currentTarget.value })} />
						</label>

						<div className="field-row">
							<label className="field">
								<span>Token1 Amount</span>
								<input value={openOracleForm.amount1} onInput={event => onOpenOracleFormChange({ amount1: event.currentTarget.value })} />
							</label>
							<label className="field">
								<span>Token2 Amount</span>
								<input value={openOracleForm.amount2} onInput={event => onOpenOracleFormChange({ amount2: event.currentTarget.value })} />
							</label>
						</div>

						<div className="actions">
							<button className="secondary" onClick={onApproveToken1} disabled={accountState.address === undefined || !isMainnet}>
								Approve Token1
							</button>
							<button className="secondary" onClick={onApproveToken2} disabled={accountState.address === undefined || !isMainnet}>
								Approve Token2
							</button>
						</div>

						<div className="actions">
							<button onClick={onSubmitInitialReport} disabled={accountState.address === undefined || !isMainnet}>
								Submit Initial Report
							</button>
							<button className="secondary" onClick={onSettleReport} disabled={accountState.address === undefined || !isMainnet}>
								Settle Report
							</button>
						</div>
					</div>

					{openOracleError === undefined ? undefined : <p className="notice error">{openOracleError}</p>}
				</div>
			</div>
		</section>
	)
}
