import { AddressValue } from './AddressValue.js'
import { EnumDropdown, type EnumDropdownOption } from './EnumDropdown.js'
import { LoadingText } from './LoadingText.js'
import { TransactionHashLink } from './TransactionHashLink.js'
import type { OpenOracleFormState } from '../types/app.js'
import type { OpenOracleSectionProps } from '../types/components.js'

const OPEN_ORACLE_OPERATION_OPTIONS: EnumDropdownOption<OpenOracleFormState['queuedOperation']>[] = [
	{ value: 'liquidation', label: 'Liquidation' },
	{ value: 'withdrawRep', label: 'Withdraw REP' },
	{ value: 'setSecurityBondsAllowance', label: 'Set Security Bonds Allowance' },
]

const DISPUTE_TOKEN_OPTIONS: EnumDropdownOption<OpenOracleFormState['disputeTokenToSwap']>[] = [
	{ value: 'token1', label: 'Token1' },
	{ value: 'token2', label: 'Token2' },
]

export function OpenOracleSection({
	accountState,
	loadingOracleManager,
	loadingOracleReport,
	onApproveToken1,
	onApproveToken2,
	onDisputeReport,
	onLoadOracleManager,
	onLoadOracleReport,
	onOpenOracleFormChange,
	onQueueOperation,
	onRequestPrice,
	onSettleReport,
	onSubmitInitialReport,
	openOracleError,
	openOracleForm,
	openOracleReportDetails,
	openOracleResult,
	oracleManagerDetails,
}: OpenOracleSectionProps) {
	const isConnected = accountState.address !== undefined
	return (
		<section className='panel market-panel'>
			<div className='market-grid'>
				<div className='market-column'>
					{openOracleReportDetails !== undefined ? (
						<div className='status-card'>
							<p className='panel-label'>Report Details</p>
							<ul className='status-list hashes'>
								<li>
									<span>Report ID</span>
									<strong>{openOracleReportDetails.reportId.toString()}</strong>
								</li>
								<li>
									<span>OpenOracle</span>
									<strong>
										<AddressValue address={openOracleReportDetails.openOracleAddress} />
									</strong>
								</li>
								<li>
									<span>Token1</span>
									<strong>
										<AddressValue address={openOracleReportDetails.token1} />
									</strong>
								</li>
								<li>
									<span>Token2</span>
									<strong>
										<AddressValue address={openOracleReportDetails.token2} />
									</strong>
								</li>
								<li>
									<span>Exact Token1 Required</span>
									<strong>{openOracleReportDetails.exactToken1Report.toString()}</strong>
								</li>
								<li>
									<span>Current Reporter</span>
									<strong>{openOracleReportDetails.currentReporter === '0x0000000000000000000000000000000000000000' ? 'None (awaiting initial report)' : <AddressValue address={openOracleReportDetails.currentReporter} />}</strong>
								</li>
								<li>
									<span>Current Amount1</span>
									<strong>{openOracleReportDetails.currentAmount1.toString()}</strong>
								</li>
								<li>
									<span>Current Amount2</span>
									<strong>{openOracleReportDetails.currentAmount2.toString()}</strong>
								</li>
								<li>
									<span>Price (amount1/amount2 * 1e18)</span>
									<strong>{openOracleReportDetails.price.toString()}</strong>
								</li>
								<li>
									<span>Report Timestamp</span>
									<strong>{openOracleReportDetails.reportTimestamp.toString()}</strong>
								</li>
								<li>
									<span>Settlement Time</span>
									<strong>
										{openOracleReportDetails.settlementTime.toString()}
										{openOracleReportDetails.timeType ? 's' : ' blocks'}
									</strong>
								</li>
								<li>
									<span>Dispute Delay</span>
									<strong>
										{openOracleReportDetails.disputeDelay.toString()}
										{openOracleReportDetails.timeType ? 's' : ' blocks'}
									</strong>
								</li>
								<li>
									<span>Multiplier</span>
									<strong>{openOracleReportDetails.multiplier.toString()}x/100</strong>
								</li>
								<li>
									<span>Dispute Occurred</span>
									<strong>{openOracleReportDetails.disputeOccurred ? 'Yes' : 'No'}</strong>
								</li>
								<li>
									<span>Settled</span>
									<strong>{openOracleReportDetails.isDistributed ? `Yes (at ${openOracleReportDetails.settlementTimestamp.toString()})` : 'No'}</strong>
								</li>
								<li>
									<span>Num Reports</span>
									<strong>{openOracleReportDetails.numReports.toString()}</strong>
								</li>
								<li>
									<span>State Hash</span>
									<strong>{openOracleReportDetails.stateHash}</strong>
								</li>
								<li>
									<span>Callback Contract</span>
									<strong>{openOracleReportDetails.callbackContract === '0x0000000000000000000000000000000000000000' ? 'None' : <AddressValue address={openOracleReportDetails.callbackContract} />}</strong>
								</li>
							</ul>
						</div>
					) : undefined}

					{oracleManagerDetails !== undefined ? (
						<div className='status-card'>
							<p className='panel-label'>Oracle Manager</p>
							<ul className='status-list hashes'>
								<li>
									<span>Manager</span>
									<strong>
										<AddressValue address={oracleManagerDetails.managerAddress} />
									</strong>
								</li>
								<li>
									<span>OpenOracle</span>
									<strong>
										<AddressValue address={oracleManagerDetails.openOracleAddress} />
									</strong>
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
							<p className='detail'>Token1: {oracleManagerDetails.token1 ?? 'Unavailable'}</p>
							<p className='detail'>Token2: {oracleManagerDetails.token2 ?? 'Unavailable'}</p>
						</div>
					) : undefined}

					{openOracleResult !== undefined ? (
						<div className='status-card'>
							<p className='panel-label'>Latest Oracle Action</p>
							<p className='detail'>Action: {openOracleResult.action}</p>
							<p className='detail'>
								Transaction: <TransactionHashLink hash={openOracleResult.hash} />
							</p>
						</div>
					) : undefined}
				</div>

				<div className='market-column'>
					<div className='form-grid'>
						<p className='panel-label'>Browse Oracle Game</p>

						<label className='field'>
							<span>OpenOracle Address</span>
							<input value={openOracleForm.openOracleAddress} onInput={event => onOpenOracleFormChange({ openOracleAddress: event.currentTarget.value })} placeholder='0x...' />
						</label>

						<label className='field'>
							<span>Report ID</span>
							<input value={openOracleForm.reportId} onInput={event => onOpenOracleFormChange({ reportId: event.currentTarget.value })} />
						</label>

						<div className='actions'>
							<button className='secondary' onClick={onLoadOracleReport} disabled={loadingOracleReport}>
								{loadingOracleReport ? <LoadingText>Loading...</LoadingText> : 'Load Report'}
							</button>
						</div>

						<p className='panel-label'>Submit Initial Report</p>

						<label className='field'>
							<span>State Hash</span>
							<input value={openOracleForm.stateHash} onInput={event => onOpenOracleFormChange({ stateHash: event.currentTarget.value })} />
						</label>

						<div className='field-row'>
							<label className='field'>
								<span>Token1 Amount</span>
								<input value={openOracleForm.amount1} onInput={event => onOpenOracleFormChange({ amount1: event.currentTarget.value })} />
							</label>
							<label className='field'>
								<span>Token2 Amount</span>
								<input value={openOracleForm.amount2} onInput={event => onOpenOracleFormChange({ amount2: event.currentTarget.value })} />
							</label>
						</div>

						<div className='actions'>
							<button className='secondary' onClick={onApproveToken1} disabled={!isConnected}>
								Approve Token1
							</button>
							<button className='secondary' onClick={onApproveToken2} disabled={!isConnected}>
								Approve Token2
							</button>
						</div>

						<div className='actions'>
							<button className='primary' onClick={onSubmitInitialReport} disabled={!isConnected}>
								Submit Initial Report
							</button>
							<button className='secondary' onClick={onSettleReport} disabled={!isConnected}>
								Settle Report
							</button>
						</div>

						<p className='panel-label'>Dispute Report</p>

						<label className='field'>
							<span>Token to Swap Out</span>
							<EnumDropdown options={DISPUTE_TOKEN_OPTIONS} value={openOracleForm.disputeTokenToSwap} onChange={disputeTokenToSwap => onOpenOracleFormChange({ disputeTokenToSwap })} />
						</label>

						<div className='field-row'>
							<label className='field'>
								<span>New Token1 Amount</span>
								<input value={openOracleForm.disputeNewAmount1} onInput={event => onOpenOracleFormChange({ disputeNewAmount1: event.currentTarget.value })} />
							</label>
							<label className='field'>
								<span>New Token2 Amount</span>
								<input value={openOracleForm.disputeNewAmount2} onInput={event => onOpenOracleFormChange({ disputeNewAmount2: event.currentTarget.value })} />
							</label>
						</div>

						<div className='actions'>
							<button className='secondary' onClick={onDisputeReport} disabled={!isConnected || openOracleReportDetails === undefined}>
								Dispute & Swap
							</button>
						</div>

						<p className='panel-label'>Oracle Manager (Zoltar)</p>

						<label className='field'>
							<span>Manager Address</span>
							<input value={openOracleForm.managerAddress} onInput={event => onOpenOracleFormChange({ managerAddress: event.currentTarget.value })} placeholder='0x...' />
						</label>

						<div className='actions'>
							<button className='secondary' onClick={onLoadOracleManager} disabled={loadingOracleManager}>
								{loadingOracleManager ? <LoadingText>Loading Oracle...</LoadingText> : 'Load Oracle Manager'}
							</button>
							<button className='primary' onClick={onRequestPrice} disabled={!isConnected}>
								Request Price
							</button>
						</div>

						<label className='field'>
							<span>Queued Operation</span>
							<EnumDropdown options={OPEN_ORACLE_OPERATION_OPTIONS} value={openOracleForm.queuedOperation} onChange={queuedOperation => onOpenOracleFormChange({ queuedOperation })} />
						</label>

						<div className='field-row'>
							<label className='field'>
								<span>Operation Target Vault</span>
								<input value={openOracleForm.operationTargetVault} onInput={event => onOpenOracleFormChange({ operationTargetVault: event.currentTarget.value })} placeholder='0x...' />
							</label>
							<label className='field'>
								<span>Operation Amount</span>
								<input value={openOracleForm.operationAmount} onInput={event => onOpenOracleFormChange({ operationAmount: event.currentTarget.value })} />
							</label>
						</div>

						<div className='actions'>
							<button className='secondary' onClick={onQueueOperation} disabled={!isConnected}>
								Request Price If Needed & Queue Operation
							</button>
						</div>
					</div>

					{openOracleError !== undefined ? <p className='notice error'>{openOracleError}</p> : undefined}
				</div>
			</div>
		</section>
	)
}
