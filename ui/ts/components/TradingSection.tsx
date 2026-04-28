import { AddressValue } from './AddressValue.js'
import { EnumDropdown } from './EnumDropdown.js'
import { EntityCard } from './EntityCard.js'
import { ErrorNotice } from './ErrorNotice.js'
import { MetricField } from './MetricField.js'
import { OpenInterestCapacityMetrics } from './OpenInterestCapacityMetrics.js'
import { TransactionHashLink } from './TransactionHashLink.js'
import { UniverseLink } from './UniverseLink.js'
import { isMainnetChain } from '../lib/network.js'
import { REPORTING_OUTCOME_DROPDOWN_OPTIONS } from '../lib/reporting.js'
import { getRemainingMintCapacity, getTradingMintGuardMessage, hasRepBackedPoolWithNoActiveAllowance } from '../lib/trading.js'
import type { TradingSectionProps } from '../types/components.js'

export function TradingSection({ accountState, embedInCard = false, onCreateCompleteSet, onMigrateShares, onRedeemCompleteSet, onRedeemShares, onTradingFormChange, selectedPool, tradingError, tradingForm, tradingResult, showHeader = true, showSecurityPoolAddressInput = true }: TradingSectionProps) {
	const isMainnet = isMainnetChain(accountState.chainId)
	const currentTimestamp = BigInt(Math.floor(Date.now() / 1000))
	const remainingMintCapacity = getRemainingMintCapacity(selectedPool?.totalSecurityBondAllowance, selectedPool?.completeSetCollateralAmount)
	const hasRepWithoutActiveAllowance = hasRepBackedPoolWithNoActiveAllowance(selectedPool?.totalRepDeposit, selectedPool?.totalSecurityBondAllowance)
	const marketHasEnded = selectedPool?.marketDetails.endTime === undefined ? undefined : selectedPool.marketDetails.endTime <= currentTimestamp
	const mintGuardMessage = getTradingMintGuardMessage({
		accountAddress: accountState.address,
		completeSetCollateralAmount: selectedPool?.completeSetCollateralAmount,
		ethBalance: accountState.ethBalance,
		isMainnet,
		mintAmountInput: tradingForm.completeSetAmount,
		systemState: selectedPool?.systemState,
		totalRepDeposit: selectedPool?.totalRepDeposit,
		totalSecurityBondAllowance: selectedPool?.totalSecurityBondAllowance,
	})
	const redeemCompleteSetGuardMessage = (() => {
		if (accountState.address === undefined) return 'Connect a wallet before redeeming complete sets.'
		if (!isMainnet) return 'Switch to Ethereum mainnet before redeeming complete sets.'
		if (selectedPool !== undefined && selectedPool.systemState !== 'operational') return 'Redeeming complete sets is only available while the pool is operational.'

		const trimmedAmount = tradingForm.redeemAmount.trim()
		if (trimmedAmount === '') return 'Enter a redeem amount greater than zero.'

		try {
			if (BigInt(trimmedAmount) <= 0n) return 'Enter a redeem amount greater than zero.'
		} catch {
			return 'Enter a valid whole-number redeem amount.'
		}

		return undefined
	})()
	const migrateSharesGuardMessage = (() => {
		if (accountState.address === undefined) return 'Connect a wallet before migrating shares.'
		if (!isMainnet) return 'Switch to Ethereum mainnet before migrating shares.'

		const trimmedUniverseId = tradingForm.fromUniverseId.trim()
		if (trimmedUniverseId === '') return 'Enter a source universe ID to migrate shares from.'

		try {
			if (BigInt(trimmedUniverseId) < 0n) return 'Enter a valid non-negative universe ID.'
		} catch {
			return 'Enter a valid whole-number universe ID.'
		}

		return undefined
	})()
	const redeemSharesGuardMessage = (() => {
		if (accountState.address === undefined) return 'Connect a wallet before redeeming shares.'
		if (!isMainnet) return 'Switch to Ethereum mainnet before redeeming shares.'
		if (selectedPool !== undefined && selectedPool.systemState !== 'operational') return 'Redeeming shares is only available while the pool is operational.'
		if (marketHasEnded === false) return 'Wait until the market end time before redeeming resolved shares.'
		return undefined
	})()
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
					<p className='detail'>Load a pool to inspect live mint capacity and trading status.</p>
				) : (
					<div className='workflow-metric-grid'>
						<MetricField label='Pool'>
							<AddressValue address={selectedPool.securityPoolAddress} />
						</MetricField>
						<MetricField label='Universe'>
							<UniverseLink universeId={selectedPool.universeId} />
						</MetricField>
						<OpenInterestCapacityMetrics completeSetCollateralAmount={selectedPool.completeSetCollateralAmount} totalRepDeposit={selectedPool.totalRepDeposit} totalSecurityBondAllowance={selectedPool.totalSecurityBondAllowance} />
					</div>
				)}
			</div>
		)
	const mintSection = (
		<div className='entity-card-subsection'>
			<div className='entity-card-subsection-header'>
				<h4>Mint Complete Sets</h4>
				{remainingMintCapacity === undefined ? undefined : hasRepWithoutActiveAllowance ? <span className='badge muted'>No active allowances</span> : <span className={`badge ${remainingMintCapacity > 0n ? 'ok' : 'blocked'}`}>{remainingMintCapacity > 0n ? 'Capacity available' : 'Capacity full'}</span>}
			</div>
			<label className='field'>
				<span>Mint Complete Sets Amount</span>
				<input value={tradingForm.completeSetAmount} onInput={event => onTradingFormChange({ completeSetAmount: event.currentTarget.value })} />
			</label>
			<p className='detail'>Minting sends ETH directly to the pool. No token approval step is required.</p>
			<p className='detail'>{mintGuardMessage ?? 'This amount will mint complete sets against the pool&apos;s remaining bond-backed capacity.'}</p>
			<div className='actions'>
				<button className='primary' title={mintGuardMessage} onClick={onCreateCompleteSet} disabled={mintGuardMessage !== undefined}>
					Mint Complete Sets
				</button>
			</div>
		</div>
	)
	const redeemCompleteSetSection = (
		<div className='entity-card-subsection'>
			<div className='entity-card-subsection-header'>
				<h4>Redeem Complete Sets</h4>
			</div>
			<label className='field'>
				<span>Redeem Complete Sets Amount</span>
				<input value={tradingForm.redeemAmount} onInput={event => onTradingFormChange({ redeemAmount: event.currentTarget.value })} />
			</label>
			<p className='detail'>Burn complete sets from this universe to withdraw the matching ETH collateral.</p>
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
			<div className='field-row'>
				<label className='field'>
					<span>From Universe ID</span>
					<input value={tradingForm.fromUniverseId} onInput={event => onTradingFormChange({ fromUniverseId: event.currentTarget.value })} />
				</label>
				<label className='field'>
					<span>Outcome To Migrate</span>
					<EnumDropdown options={REPORTING_OUTCOME_DROPDOWN_OPTIONS} value={tradingForm.selectedOutcome} onChange={selectedOutcome => onTradingFormChange({ selectedOutcome })} />
				</label>
			</div>
			<p className='detail'>Use this after a fork to move shares from an older universe into the current pool universe.</p>
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
			<p className='detail'>Redeem the finalized winning shares you hold once the question has fully resolved.</p>
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
						<p className='detail'>Use a security pool address to create complete sets with collateral or redeem complete sets back out of the pool.</p>
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
