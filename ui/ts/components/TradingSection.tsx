import { AddressValue } from './AddressValue.js'
import { EnumDropdown } from './EnumDropdown.js'
import { EntityCard } from './EntityCard.js'
import { ErrorNotice } from './ErrorNotice.js'
import { LatestActionSection } from './LatestActionSection.js'
import { MetricField } from './MetricField.js'
import { OpenInterestCapacityMetrics } from './OpenInterestCapacityMetrics.js'
import { ShareMigrationTargetsSection } from './ShareMigrationTargetsSection.js'
import { TransactionHashLink } from './TransactionHashLink.js'
import { UniverseLink } from './UniverseLink.js'
import { formatCurrencyBalance, formatCurrencyInputBalance } from '../lib/formatters.js'
import { isMainnetChain } from '../lib/network.js'
import { REPORTING_OUTCOME_DROPDOWN_OPTIONS } from '../lib/reporting.js'
import { getDefaultShareMigrationTargetOutcomeIndexes, getRemainingMintCapacity, getTradingGuardDisplayMessage, getTradingMigrateSharesGuardMessage, getTradingMintGuardMessage, getTradingRedeemCompleteSetGuardMessage, getTradingRedeemSharesGuardMessage } from '../lib/trading.js'
import type { TradingSectionProps } from '../types/components.js'

export function TradingSection({
	accountState,
	embedInCard = false,
	loadingTradingForkUniverse,
	loadingTradingDetails,
	onCreateCompleteSet,
	onMigrateShares,
	onRedeemCompleteSet,
	onRedeemShares,
	onTradingFormChange,
	tradingDetails,
	repEthPrice,
	repEthSource,
	repEthSourceUrl,
	selectedPool,
	tradingError,
	tradingForm,
	tradingForkUniverse,
	tradingResult,
	showHeader = true,
	showSecurityPoolAddressInput = true,
}: TradingSectionProps) {
	const isMainnet = isMainnetChain(accountState.chainId)
	const hasSelectedPool = selectedPool !== undefined
	const poolUniverseHasForked = selectedPool?.universeHasForked === true || tradingForkUniverse?.hasForked === true
	const remainingMintCapacity = getRemainingMintCapacity(selectedPool?.totalSecurityBondAllowance, selectedPool?.completeSetCollateralAmount)
	const shareBalances = tradingDetails?.shareBalances
	const maxRedeemableCompleteSets = tradingDetails?.maxRedeemableCompleteSets
	let selectedTargetOutcomeIndexes: bigint[] = []
	try {
		selectedTargetOutcomeIndexes = tradingForm.targetOutcomeIndexes
			.split(',')
			.map(value => value.trim())
			.filter(value => value !== '')
			.map(value => BigInt(value))
	} catch {
		selectedTargetOutcomeIndexes = []
	}
	const selectedTargetOutcomeIndexSet = new Set(selectedTargetOutcomeIndexes.map(value => value.toString()))
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
		universeHasForked: poolUniverseHasForked,
	})
	const redeemCompleteSetGuardMessage = getTradingRedeemCompleteSetGuardMessage({
		accountAddress: accountState.address,
		hasSelectedPool,
		isMainnet,
		loadingTradingDetails,
		redeemAmountInput: tradingForm.redeemAmount,
		shareBalances,
		systemState: selectedPool?.systemState,
		universeHasForked: poolUniverseHasForked,
	})
	const migrateSharesGuardMessage = getTradingMigrateSharesGuardMessage({
		accountAddress: accountState.address,
		hasSelectedPool,
		isMainnet,
		loadingTradingForkUniverse,
		loadingTradingDetails,
		selectedShareOutcome: tradingForm.selectedShareOutcome,
		shareBalances,
		targetOutcomeIndexesInput: tradingForm.targetOutcomeIndexes,
		tradingForkUniverse,
		universeHasForked: poolUniverseHasForked,
	})
	const redeemSharesGuardMessage = getTradingRedeemSharesGuardMessage({
		accountAddress: accountState.address,
		hasSelectedPool,
		isMainnet,
		questionOutcome: selectedPool?.questionOutcome,
		systemState: selectedPool?.systemState,
		universeHasForked: poolUniverseHasForked,
	})
	const mintGuardDisplayMessage = getTradingGuardDisplayMessage(mintGuardMessage)
	const redeemCompleteSetGuardDisplayMessage = getTradingGuardDisplayMessage(redeemCompleteSetGuardMessage)
	const migrateSharesGuardDisplayMessage = getTradingGuardDisplayMessage(migrateSharesGuardMessage)
	const redeemSharesGuardDisplayMessage = getTradingGuardDisplayMessage(redeemSharesGuardMessage)
	const shareMigrationSelectionDisabled = poolUniverseHasForked !== true
	const setAllTargetOutcomeIndexes = () => {
		onTradingFormChange({ targetOutcomeIndexes: getDefaultShareMigrationTargetOutcomeIndexes(tradingForkUniverse) })
	}
	const clearTargetOutcomeIndexes = () => {
		onTradingFormChange({ targetOutcomeIndexes: '' })
	}
	const toggleTargetOutcomeIndex = (outcomeIndex: bigint) => {
		if (selectedTargetOutcomeIndexSet.has(outcomeIndex.toString())) {
			onTradingFormChange({
				targetOutcomeIndexes: selectedTargetOutcomeIndexes
					.filter(index => index !== outcomeIndex)
					.map(index => index.toString())
					.join(', '),
			})
			return
		}
		onTradingFormChange({
			targetOutcomeIndexes: [...selectedTargetOutcomeIndexes, outcomeIndex].map(index => index.toString()).join(', '),
		})
	}
	const renderShareMetricValue = (value: bigint | undefined) => {
		if (loadingTradingDetails) return 'Loading...'
		if (value === undefined) return '—'
		return formatCurrencyBalance(value)
	}
	const latestTradingAction =
		tradingResult === undefined ? undefined : (
			<LatestActionSection
				title='Latest Trading Action'
				badge={<span className='badge ok'>{tradingResult.action}</span>}
				embedInCard={embedInCard}
				rows={[
					{ label: 'Action', value: tradingResult.action },
					...(tradingResult.action !== 'migrateShares' || tradingResult.shareOutcome === undefined ? [] : [{ label: 'Share Outcome', value: tradingResult.shareOutcome }]),
					...(tradingResult.action !== 'migrateShares' || tradingResult.targetOutcomeIndexes === undefined ? [] : [{ label: 'Target Outcome Indexes', value: tradingResult.targetOutcomeIndexes.join(', ') }]),
					{ label: 'Pool', value: tradingResult.securityPoolAddress },
					{ label: 'Universe', value: <UniverseLink universeId={tradingResult.universeId} /> },
					{ label: 'Transaction', value: <TransactionHashLink hash={tradingResult.hash} /> },
				]}
			/>
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
						<OpenInterestCapacityMetrics
							completeSetCollateralAmount={selectedPool.completeSetCollateralAmount}
							repEthPrice={repEthPrice}
							repEthSource={repEthSource}
							repEthSourceUrl={repEthSourceUrl}
							securityMultiplier={selectedPool.securityMultiplier}
							totalRepDeposit={selectedPool.totalRepDeposit}
							totalSecurityBondAllowance={selectedPool.totalSecurityBondAllowance}
						/>
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
					<MetricField label='Total Complete Sets'>{renderShareMetricValue(maxRedeemableCompleteSets)}</MetricField>
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
				<button className='primary' title={mintGuardDisplayMessage} onClick={onCreateCompleteSet} disabled={mintGuardMessage !== undefined}>
					Mint Complete Sets
				</button>
			</div>
			{mintGuardDisplayMessage === undefined ? undefined : <p className='detail'>{mintGuardDisplayMessage}</p>}
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
				<button className='secondary' title={redeemCompleteSetGuardDisplayMessage} onClick={onRedeemCompleteSet} disabled={redeemCompleteSetGuardMessage !== undefined}>
					Redeem Complete Sets
				</button>
			</div>
			{redeemCompleteSetGuardDisplayMessage === undefined ? undefined : <p className='detail'>{redeemCompleteSetGuardDisplayMessage}</p>}
		</div>
	)
	const migrateSharesSection = (
		<div className='entity-card-subsection'>
			<div className='entity-card-subsection-header'>
				<h4>Migrate Forked Shares</h4>
			</div>
			<label className='field'>
				<span>Share Outcome To Migrate</span>
				<EnumDropdown options={REPORTING_OUTCOME_DROPDOWN_OPTIONS} value={tradingForm.selectedShareOutcome} onChange={selectedShareOutcome => onTradingFormChange({ selectedShareOutcome })} disabled={shareMigrationSelectionDisabled} />
			</label>
			<ShareMigrationTargetsSection
				disabled={shareMigrationSelectionDisabled}
				forkUniverse={tradingForkUniverse}
				onClearOutcomeIndexes={clearTargetOutcomeIndexes}
				onSelectAllOutcomeIndexes={setAllTargetOutcomeIndexes}
				onToggleOutcomeIndex={toggleTargetOutcomeIndex}
				selectedOutcomeIndexes={selectedTargetOutcomeIndexes}
				selectedOutcomeIndexSet={selectedTargetOutcomeIndexSet}
			/>
			<div className='actions'>
				<button className='secondary' title={migrateSharesGuardDisplayMessage} onClick={onMigrateShares} disabled={migrateSharesGuardMessage !== undefined}>
					Migrate Shares
				</button>
			</div>
			{migrateSharesGuardDisplayMessage === undefined ? undefined : <p className='detail'>{migrateSharesGuardDisplayMessage}</p>}
		</div>
	)
	const redeemSharesSection = (
		<div className='entity-card-subsection'>
			<div className='entity-card-subsection-header'>
				<h4>Redeem Resolved Shares</h4>
			</div>
			<div className='actions'>
				<button className='secondary' title={redeemSharesGuardDisplayMessage} onClick={onRedeemShares} disabled={redeemSharesGuardMessage !== undefined}>
					Redeem Shares
				</button>
			</div>
			{redeemSharesGuardDisplayMessage === undefined ? undefined : <p className='detail'>{redeemSharesGuardDisplayMessage}</p>}
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
