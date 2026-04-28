import { AddressValue } from './AddressValue.js'
import { EnumDropdown } from './EnumDropdown.js'
import { EntityCard } from './EntityCard.js'
import { ErrorNotice } from './ErrorNotice.js'
import { MetricField } from './MetricField.js'
import { OpenInterestCapacityMetrics } from './OpenInterestCapacityMetrics.js'
import { TransactionHashLink } from './TransactionHashLink.js'
import { UniverseLink } from './UniverseLink.js'
import { formatCurrencyBalance, formatCurrencyInputBalance } from '../lib/formatters.js'
import { isMainnetChain } from '../lib/network.js'
import { REPORTING_OUTCOME_DROPDOWN_OPTIONS } from '../lib/reporting.js'
import { getRemainingMintCapacity, getTradingMigrateSharesGuardMessage, getTradingMintGuardMessage, getTradingRedeemCompleteSetGuardMessage, getTradingRedeemSharesGuardMessage } from '../lib/trading.js'
import type { TradingSectionProps } from '../types/components.js'

export function TradingSection({
	accountState,
	embedInCard = false,
	loadingTradingDetails,
	onCreateCompleteSet,
	onMigrateShares,
	onRedeemCompleteSet,
	onRedeemShares,
	onTradingFormChange,
	selectedPool,
	tradingDetails,
	tradingError,
	tradingForm,
	tradingResult,
	showHeader = true,
	showSecurityPoolAddressInput = true,
}: TradingSectionProps) {
	const isMainnet = isMainnetChain(accountState.chainId)
	const hasSelectedPool = selectedPool !== undefined
	const remainingMintCapacity = getRemainingMintCapacity(selectedPool?.totalSecurityBondAllowance, selectedPool?.completeSetCollateralAmount)
	const shareBalances = tradingDetails?.shareBalances
	const maxRedeemableCompleteSets = tradingDetails?.maxRedeemableCompleteSets
	const mintGuardMessage = getTradingMintGuardMessage({
		accountAddress: accountState.address,
		completeSetCollateralAmount: selectedPool?.completeSetCollateralAmount,
		ethBalance: accountState.ethBalance,
		hasSelectedPool,
		isMainnet,
		mintAmountInput: tradingForm.completeSetAmount,
		systemState: selectedPool?.systemState,
		totalRepDeposit: selectedPool?.totalRepDeposit,
		totalSecurityBondAllowance: selectedPool?.totalSecurityBondAllowance,
		universeHasForked: selectedPool?.universeHasForked,
	})
	const redeemCompleteSetGuardMessage = getTradingRedeemCompleteSetGuardMessage({
		accountAddress: accountState.address,
		hasSelectedPool,
		isMainnet,
		loadingTradingDetails,
		redeemAmountInput: tradingForm.redeemAmount,
		shareBalances,
		systemState: selectedPool?.systemState,
		universeHasForked: selectedPool?.universeHasForked,
	})
	const migrateSharesGuardMessage = getTradingMigrateSharesGuardMessage({
		accountAddress: accountState.address,
		hasSelectedPool,
		isMainnet,
		loadingTradingDetails,
		selectedOutcome: tradingForm.selectedOutcome,
		shareBalances,
		universeHasForked: selectedPool?.universeHasForked,
	})
	const redeemSharesGuardMessage = getTradingRedeemSharesGuardMessage({
		accountAddress: accountState.address,
		hasSelectedPool,
		isMainnet,
		questionOutcome: selectedPool?.questionOutcome,
		systemState: selectedPool?.systemState,
		universeHasForked: selectedPool?.universeHasForked,
	})
	const renderShareMetricValue = (value: bigint | undefined) => {
		if (loadingTradingDetails) return 'Loading...'
		if (value === undefined) return '—'
		return formatCurrencyBalance(value)
	}
	const latestTradingAction =
		tradingResult === undefined ? undefined : embedInCard ? (
			<div className='entity-card-subsection'>
				<div className='entity-card-subsection-header'>
					<h4>Latest Trading Action</h4>
					<span className='badge ok'>{tradingResult.action}</span>
				</div>
				<p className='detail'>Action: {tradingResult.action}</p>
				<p className='detail'>Pool: {tradingResult.securityPoolAddress}</p>
				<p className='detail'>
					Universe: <UniverseLink universeId={tradingResult.universeId} />
				</p>
				<p className='detail'>
					Transaction: <TransactionHashLink hash={tradingResult.hash} />
				</p>
			</div>
		) : (
			<EntityCard title='Latest Trading Action' badge={<span className='badge ok'>{tradingResult.action}</span>}>
				<p className='detail'>Action: {tradingResult.action}</p>
				<p className='detail'>Pool: {tradingResult.securityPoolAddress}</p>
				<p className='detail'>
					Universe: <UniverseLink universeId={tradingResult.universeId} />
				</p>
				<p className='detail'>
					Transaction: <TransactionHashLink hash={tradingResult.hash} />
				</p>
			</EntityCard>
		)
	const poolSection =
		!showSecurityPoolAddressInput && selectedPool === undefined ? undefined : (
			<div className='entity-card-subsection'>
				<div className='entity-card-subsection-header'>
					<h4>Pool</h4>
					{selectedPool === undefined ? undefined : <span className={`badge ${selectedPool.systemState === 'operational' ? 'ok' : 'blocked'}`}>{selectedPool.systemState}</span>}
				</div>
				{showSecurityPoolAddressInput ? (
					<label className='field'>
						<span>Security Pool Address</span>
						<input value={tradingForm.securityPoolAddress} onInput={event => onTradingFormChange({ securityPoolAddress: event.currentTarget.value })} placeholder='0x...' />
					</label>
				) : undefined}
				{selectedPool === undefined ? (
					<p className='detail'>Load a pool to inspect live trading state.</p>
				) : (
					<div className='workflow-metric-grid'>
						<MetricField label='Pool'>
							<AddressValue address={selectedPool.securityPoolAddress} />
						</MetricField>
						<MetricField label='Universe'>
							<UniverseLink universeId={selectedPool.universeId} />
						</MetricField>
						<OpenInterestCapacityMetrics completeSetCollateralAmount={selectedPool.completeSetCollateralAmount} lastOraclePrice={selectedPool.lastOraclePrice} totalRepDeposit={selectedPool.totalRepDeposit} totalSecurityBondAllowance={selectedPool.totalSecurityBondAllowance} />
					</div>
				)}
			</div>
		)
	const shareBalancesSection =
		selectedPool === undefined ? undefined : (
			<div className='entity-card-subsection'>
				<div className='entity-card-subsection-header'>
					<h4>Your Shares</h4>
				</div>
				<div className='workflow-metric-grid'>
					<MetricField label='Yes'>{renderShareMetricValue(shareBalances?.yes)}</MetricField>
					<MetricField label='No'>{renderShareMetricValue(shareBalances?.no)}</MetricField>
					<MetricField label='Invalid'>{renderShareMetricValue(shareBalances?.invalid)}</MetricField>
					<MetricField label='Max Complete Sets'>{renderShareMetricValue(maxRedeemableCompleteSets)}</MetricField>
				</div>
			</div>
		)
	const mintSection = (
		<div className='entity-card-subsection'>
			<div className='entity-card-subsection-header'>
				<h4>Mint Complete Sets</h4>
				{remainingMintCapacity === undefined ? undefined : <span className={`badge ${remainingMintCapacity > 0n ? 'ok' : 'blocked'}`}>{remainingMintCapacity > 0n ? 'Capacity available' : 'Capacity full'}</span>}
			</div>
			<label className='field'>
				<span>Mint Complete Sets Amount</span>
				<input value={tradingForm.completeSetAmount} inputMode='decimal' onInput={event => onTradingFormChange({ completeSetAmount: event.currentTarget.value })} />
			</label>
			<div className='actions'>
				<button className='primary' title={mintGuardMessage} onClick={onCreateCompleteSet} disabled={mintGuardMessage !== undefined}>
					Mint Complete Sets
				</button>
			</div>
			{mintGuardMessage === undefined ? undefined : <p className='detail'>{mintGuardMessage}</p>}
		</div>
	)
	const redeemCompleteSetSection = (
		<div className='entity-card-subsection'>
			<div className='entity-card-subsection-header'>
				<h4>Redeem Complete Sets</h4>
			</div>
			<label className='field'>
				<span>Redeem Complete Sets Amount</span>
				<div className='field-inline'>
					<input className='field-inline-input' value={tradingForm.redeemAmount} inputMode='decimal' onInput={event => onTradingFormChange({ redeemAmount: event.currentTarget.value })} />
					<button
						className='quiet field-inline-action'
						type='button'
						onClick={() => {
							if (maxRedeemableCompleteSets === undefined) return
							onTradingFormChange({ redeemAmount: formatCurrencyInputBalance(maxRedeemableCompleteSets) })
						}}
						disabled={maxRedeemableCompleteSets === undefined || maxRedeemableCompleteSets <= 0n}
					>
						Max
					</button>
				</div>
			</label>
			<div className='actions'>
				<button className='secondary' title={redeemCompleteSetGuardMessage} onClick={onRedeemCompleteSet} disabled={redeemCompleteSetGuardMessage !== undefined}>
					Redeem Complete Sets
				</button>
			</div>
			{redeemCompleteSetGuardMessage === undefined ? undefined : <p className='detail'>{redeemCompleteSetGuardMessage}</p>}
		</div>
	)
	const migrateSharesSection = (
		<div className='entity-card-subsection'>
			<div className='entity-card-subsection-header'>
				<h4>Migrate Forked Shares</h4>
			</div>
			<label className='field'>
				<span>Outcome To Migrate</span>
				<EnumDropdown options={REPORTING_OUTCOME_DROPDOWN_OPTIONS} value={tradingForm.selectedOutcome} onChange={selectedOutcome => onTradingFormChange({ selectedOutcome })} />
			</label>
			<div className='actions'>
				<button className='secondary' title={migrateSharesGuardMessage} onClick={onMigrateShares} disabled={migrateSharesGuardMessage !== undefined}>
					Migrate Shares
				</button>
			</div>
			{migrateSharesGuardMessage === undefined ? undefined : <p className='detail'>{migrateSharesGuardMessage}</p>}
		</div>
	)
	const redeemSharesSection = (
		<div className='entity-card-subsection'>
			<div className='entity-card-subsection-header'>
				<h4>Redeem Resolved Shares</h4>
			</div>
			<div className='actions'>
				<button className='secondary' title={redeemSharesGuardMessage} onClick={onRedeemShares} disabled={redeemSharesGuardMessage !== undefined}>
					Redeem Shares
				</button>
			</div>
			{redeemSharesGuardMessage === undefined ? undefined : <p className='detail'>{redeemSharesGuardMessage}</p>}
		</div>
	)
	const tradingSections = (
		<>
			{poolSection}
			{latestTradingAction}
			{shareBalancesSection}
			{mintSection}
			{redeemCompleteSetSection}
			{migrateSharesSection}
			{redeemSharesSection}
		</>
	)

	if (embedInCard) {
		return (
			<>
				{tradingSections}
				<ErrorNotice message={tradingError} />
			</>
		)
	}

	return (
		<section className='panel market-panel'>
			{showHeader ? (
				<div className='market-header'>
					<div>
						<h2>Trading</h2>
					</div>
				</div>
			) : undefined}

			<div className='market-grid'>
				<div className='market-column'>
					<EntityCard title='Trading Actions' badge={<span className='badge muted'>manage</span>}>
						{tradingSections}
					</EntityCard>

					<ErrorNotice message={tradingError} />
				</div>
			</div>
		</section>
	)
}
