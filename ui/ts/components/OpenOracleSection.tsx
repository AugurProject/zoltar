import { AddressValue } from './AddressValue.js'
import { EntityCard } from './EntityCard.js'
import { EnumDropdown, type EnumDropdownOption } from './EnumDropdown.js'
import { LoadingText } from './LoadingText.js'
import { TransactionHashLink } from './TransactionHashLink.js'
import { formatTimestamp } from '../lib/formatters.js'
import { isMainnetChain } from '../lib/network.js'
import type { OpenOracleActionResult, OpenOracleGameSummary } from '../types/contracts.js'
import type { OpenOracleCreateFormState } from '../types/app.js'
import type { OpenOracleSectionProps } from '../types/components.js'

const BOOLEAN_OPTIONS: EnumDropdownOption<OpenOracleCreateFormState['keepFee']>[] = [
	{ value: 'true', label: 'Yes' },
	{ value: 'false', label: 'No' },
]

const TIME_TYPE_OPTIONS: EnumDropdownOption<OpenOracleCreateFormState['timeType']>[] = [
	{ value: 'true', label: 'Seconds' },
	{ value: 'false', label: 'Blocks' },
]

function getOpenOracleActionLabel(action: OpenOracleActionResult['action']) {
	switch (action) {
		case 'approveToken1':
			return 'Approve Token1'
		case 'approveToken2':
			return 'Approve Token2'
		case 'createReportInstance':
			return 'Create Game'
		case 'settle':
			return 'Settle Report'
		case 'submitInitialReport':
			return 'Submit Initial Report'
	}
}

function getOpenOracleGameStatus(game: OpenOracleGameSummary) {
	if (game.isSettled) return 'Settled'
	if (game.isSubmitted) return 'Submitted'
	return 'Created'
}

function renderBooleanField<T extends OpenOracleCreateFormState['keepFee'] | OpenOracleCreateFormState['timeType'] | OpenOracleCreateFormState['trackDisputes']>(label: string, value: T, options: EnumDropdownOption<T>[], onChange: (value: T) => void) {
	return (
		<label className='field'>
			<span>{label}</span>
			<EnumDropdown options={options} value={value} onChange={onChange} />
		</label>
	)
}

function renderOpenOracleGameCard(game: OpenOracleGameSummary, onLoadReportGame: (reportId: bigint) => void) {
	return (
		<EntityCard
			key={game.reportId.toString()}
			title={`Report #${game.reportId.toString()}`}
			badge={<span className='badge ok'>{getOpenOracleGameStatus(game)}</span>}
			actions={
				<div className='actions'>
					<button className='secondary' onClick={() => onLoadReportGame(game.reportId)}>
						Load For Report
					</button>
				</div>
			}
		>
			<div className='entity-card-subsection'>
				<div className='workflow-metric-grid'>
					<div>
						<span className='metric-label'>Token1</span>
						<strong>
							<AddressValue address={game.token1} />
						</strong>
					</div>
					<div>
						<span className='metric-label'>Token2</span>
						<strong>
							<AddressValue address={game.token2} />
						</strong>
					</div>
					<div>
						<span className='metric-label'>Exact Token1 Report</span>
						<strong>{game.exactToken1Report.toString()}</strong>
					</div>
					<div>
						<span className='metric-label'>Current Amounts</span>
						<strong>
							{game.currentAmount1.toString()} / {game.currentAmount2.toString()}
						</strong>
					</div>
					<div>
						<span className='metric-label'>Price</span>
						<strong>{game.price.toString()}</strong>
					</div>
					<div>
						<span className='metric-label'>Reporter</span>
						<strong>
							<AddressValue address={game.isSubmitted ? game.currentReporter : undefined} />
						</strong>
					</div>
					<div>
						<span className='metric-label'>Created</span>
						<strong>{game.reportTimestamp === 0n ? 'Not submitted' : formatTimestamp(game.reportTimestamp)}</strong>
					</div>
					<div>
						<span className='metric-label'>Settled</span>
						<strong>{game.isSettled ? formatTimestamp(game.settlementTimestamp) : 'Pending'}</strong>
					</div>
					<div>
						<span className='metric-label'>State Hash</span>
						<strong>{game.stateHash}</strong>
					</div>
				</div>
			</div>
		</EntityCard>
	)
}

export function OpenOracleSection({
	accountState,
	loadingOpenOracleGames,
	nextReportId,
	onApproveToken1,
	onApproveToken2,
	onCreateOpenOracleGame,
	onLoadOpenOracleGames,
	onLoadReportGame,
	onOpenOracleCreateFormChange,
	onOpenOracleReportFormChange,
	onSettleReport,
	onSubmitInitialReport,
	openOracleAddress,
	openOracleCreateForm,
	openOracleError,
	openOracleGames,
	openOracleReportForm,
	openOracleResult,
}: OpenOracleSectionProps) {
	const isMainnet = isMainnetChain(accountState.chainId)
	const loadedGameCount = openOracleGames.length
	const actionDisabled = accountState.address === undefined || !isMainnet
	const selectedReportId = openOracleReportForm.reportId.trim() === '' ? undefined : openOracleReportForm.reportId

	return (
		<section className='panel market-panel'>
			<div className='workflow-stack'>
				<EntityCard
					title='Open Oracle'
					actions={
						<button className='secondary' onClick={onLoadOpenOracleGames} disabled={loadingOpenOracleGames}>
							{loadingOpenOracleGames ? <LoadingText>Loading Games...</LoadingText> : 'Refresh Games'}
						</button>
					}
				>
					<div className='workflow-metric-grid'>
						<div>
							<span className='metric-label'>Deployment Address</span>
							<strong>
								<AddressValue address={openOracleAddress} />
							</strong>
						</div>
						<div>
							<span className='metric-label'>Loaded Games</span>
							<strong>{loadingOpenOracleGames ? <LoadingText>Loading...</LoadingText> : `${loadedGameCount} loaded`}</strong>
						</div>
						<div>
							<span className='metric-label'>Next Report ID</span>
							<strong>{loadingOpenOracleGames ? <LoadingText>Loading...</LoadingText> : nextReportId === undefined ? 'Unavailable' : nextReportId.toString()}</strong>
						</div>
					</div>
				</EntityCard>

				{openOracleResult === undefined ? undefined : (
					<EntityCard title='Latest Oracle Action' badge={<span className='badge ok'>{getOpenOracleActionLabel(openOracleResult.action)}</span>}>
						<div className='workflow-metric-grid'>
							<div>
								<span className='metric-label'>Action</span>
								<strong>{getOpenOracleActionLabel(openOracleResult.action)}</strong>
							</div>
							{openOracleResult.action === 'createReportInstance' ? (
								<div>
									<span className='metric-label'>Report ID</span>
									<strong>{openOracleResult.reportId.toString()}</strong>
								</div>
							) : undefined}
							<div>
								<span className='metric-label'>Transaction</span>
								<strong>
									<TransactionHashLink hash={openOracleResult.hash} />
								</strong>
							</div>
						</div>
					</EntityCard>
				)}

				<EntityCard
					title='Existing Games'
					badge={<span className='badge muted'>{loadedGameCount} loaded</span>}
					actions={
						<button className='secondary' onClick={onLoadOpenOracleGames} disabled={loadingOpenOracleGames}>
							{loadingOpenOracleGames ? <LoadingText>Loading Games...</LoadingText> : 'Refresh Games'}
						</button>
					}
				>
					{loadingOpenOracleGames && openOracleGames.length === 0 ? (
						<p className='detail'>
							<LoadingText>Loading Open Oracle games...</LoadingText>
						</p>
					) : openOracleGames.length === 0 ? (
						<p className='detail'>No Open Oracle games have been created yet.</p>
					) : (
						<div className='entity-card-list'>{openOracleGames.map(game => renderOpenOracleGameCard(game, onLoadReportGame))}</div>
					)}
				</EntityCard>

				<EntityCard title='Report Game'>
					<p className='detail'>Load a game from the list to prefill the report id, exact token1 amount, and state hash.</p>
					<div className='form-grid'>
						<label className='field'>
							<span>Report ID</span>
							<input value={openOracleReportForm.reportId} onInput={event => onOpenOracleReportFormChange({ reportId: event.currentTarget.value })} placeholder='1' />
						</label>

						<div className='field-row'>
							<label className='field'>
								<span>Token1 Amount</span>
								<input value={openOracleReportForm.amount1} onInput={event => onOpenOracleReportFormChange({ amount1: event.currentTarget.value })} />
							</label>
							<label className='field'>
								<span>Token2 Amount</span>
								<input value={openOracleReportForm.amount2} onInput={event => onOpenOracleReportFormChange({ amount2: event.currentTarget.value })} />
							</label>
						</div>

						<label className='field'>
							<span>State Hash</span>
							<input value={openOracleReportForm.stateHash} onInput={event => onOpenOracleReportFormChange({ stateHash: event.currentTarget.value })} />
						</label>

						<div className='actions'>
							<button className='secondary' onClick={onApproveToken1} disabled={actionDisabled || selectedReportId === undefined}>
								Approve Token1
							</button>
							<button className='secondary' onClick={onApproveToken2} disabled={actionDisabled || selectedReportId === undefined}>
								Approve Token2
							</button>
						</div>

						<div className='actions'>
							<button onClick={onSubmitInitialReport} disabled={actionDisabled || selectedReportId === undefined}>
								Submit Initial Report
							</button>
							<button className='secondary' onClick={onSettleReport} disabled={actionDisabled || selectedReportId === undefined}>
								Settle Report
							</button>
						</div>
					</div>
				</EntityCard>

				<EntityCard title='Create Game'>
					<p className='detail'>This submits `createReportInstance` directly. The transaction value must exceed the settler reward.</p>
					<div className='form-grid'>
						<div className='entity-card-subsection'>
							<div className='field-row'>
								<label className='field'>
									<span>Token1 Address</span>
									<input value={openOracleCreateForm.token1Address} onInput={event => onOpenOracleCreateFormChange({ token1Address: event.currentTarget.value })} placeholder='0x...' />
								</label>
								<label className='field'>
									<span>Token2 Address</span>
									<input value={openOracleCreateForm.token2Address} onInput={event => onOpenOracleCreateFormChange({ token2Address: event.currentTarget.value })} placeholder='0x...' />
								</label>
							</div>

							<div className='field-row'>
								<label className='field'>
									<span>Exact Token1 Report</span>
									<input value={openOracleCreateForm.exactToken1Report} onInput={event => onOpenOracleCreateFormChange({ exactToken1Report: event.currentTarget.value })} />
								</label>
								<label className='field'>
									<span>Transaction Value</span>
									<input value={openOracleCreateForm.transactionValue} onInput={event => onOpenOracleCreateFormChange({ transactionValue: event.currentTarget.value })} />
								</label>
							</div>
						</div>

						<div className='entity-card-subsection'>
							<div className='field-row'>
								<label className='field'>
									<span>Settlement Time</span>
									<input value={openOracleCreateForm.settlementTime} onInput={event => onOpenOracleCreateFormChange({ settlementTime: event.currentTarget.value })} />
								</label>
								<label className='field'>
									<span>Dispute Delay</span>
									<input value={openOracleCreateForm.disputeDelay} onInput={event => onOpenOracleCreateFormChange({ disputeDelay: event.currentTarget.value })} />
								</label>
							</div>

							<div className='field-row'>
								<label className='field'>
									<span>Escalation Halt</span>
									<input value={openOracleCreateForm.escalationHalt} onInput={event => onOpenOracleCreateFormChange({ escalationHalt: event.currentTarget.value })} />
								</label>
								<label className='field'>
									<span>Multiplier</span>
									<input value={openOracleCreateForm.multiplier} onInput={event => onOpenOracleCreateFormChange({ multiplier: event.currentTarget.value })} />
								</label>
							</div>

							<div className='field-row'>
								<label className='field'>
									<span>Fee Percentage</span>
									<input value={openOracleCreateForm.feePercentage} onInput={event => onOpenOracleCreateFormChange({ feePercentage: event.currentTarget.value })} />
								</label>
								<label className='field'>
									<span>Protocol Fee</span>
									<input value={openOracleCreateForm.protocolFee} onInput={event => onOpenOracleCreateFormChange({ protocolFee: event.currentTarget.value })} />
								</label>
							</div>

							<div className='field-row'>
								<label className='field'>
									<span>Settler Reward</span>
									<input value={openOracleCreateForm.settlerReward} onInput={event => onOpenOracleCreateFormChange({ settlerReward: event.currentTarget.value })} />
								</label>
								<label className='field'>
									<span>Protocol Fee Recipient</span>
									<input value={openOracleCreateForm.protocolFeeRecipient} onInput={event => onOpenOracleCreateFormChange({ protocolFeeRecipient: event.currentTarget.value })} placeholder='0x...' />
								</label>
							</div>
						</div>

						<div className='entity-card-subsection'>
							<div className='field-row'>
								<label className='field'>
									<span>Callback Contract</span>
									<input value={openOracleCreateForm.callbackContract} onInput={event => onOpenOracleCreateFormChange({ callbackContract: event.currentTarget.value })} placeholder='0x...' />
								</label>
								<label className='field'>
									<span>Callback Gas Limit</span>
									<input value={openOracleCreateForm.callbackGasLimit} onInput={event => onOpenOracleCreateFormChange({ callbackGasLimit: event.currentTarget.value })} />
								</label>
							</div>

							<div className='field-row'>
								<label className='field'>
									<span>Callback Selector</span>
									<input value={openOracleCreateForm.callbackSelector} onInput={event => onOpenOracleCreateFormChange({ callbackSelector: event.currentTarget.value })} placeholder='0x12345678' />
								</label>
								{renderBooleanField('Time Type', openOracleCreateForm.timeType, TIME_TYPE_OPTIONS, timeType => onOpenOracleCreateFormChange({ timeType }))}
							</div>

							<div className='field-row'>
								{renderBooleanField('Track Disputes', openOracleCreateForm.trackDisputes, BOOLEAN_OPTIONS, trackDisputes => onOpenOracleCreateFormChange({ trackDisputes }))}
								{renderBooleanField('Keep Fee', openOracleCreateForm.keepFee, BOOLEAN_OPTIONS, keepFee => onOpenOracleCreateFormChange({ keepFee }))}
							</div>

							<div className='field-row'>
								{renderBooleanField('Fee Token', openOracleCreateForm.feeToken, BOOLEAN_OPTIONS, feeToken => onOpenOracleCreateFormChange({ feeToken }))}
								<div className='field'></div>
							</div>
						</div>

						<div className='actions'>
							<button onClick={onCreateOpenOracleGame} disabled={actionDisabled}>
								Create Game
							</button>
						</div>
					</div>
				</EntityCard>
			</div>

			{openOracleError === undefined ? undefined : <p className='notice error'>{openOracleError}</p>}
		</section>
	)
}
