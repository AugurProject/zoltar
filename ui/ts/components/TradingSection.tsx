import { EnumDropdown } from './EnumDropdown.js'
import { ErrorNotice } from './ErrorNotice.js'
import { LatestActionSection } from './LatestActionSection.js'
import { MetricField } from './MetricField.js'
import { SectionBlock } from './SectionBlock.js'
import { ShareMigrationTargetsSection } from './ShareMigrationTargetsSection.js'
import { TransactionActionButton } from './TransactionActionButton.js'
import { TransactionHashLink } from './TransactionHashLink.js'
import { UniverseLink } from './UniverseLink.js'
import { formatCurrencyBalance, formatCurrencyInputBalance } from '../lib/formatters.js'
import { isMainnetChain } from '../lib/network.js'
import { REPORTING_OUTCOME_DROPDOWN_OPTIONS } from '../lib/reporting.js'
import { getDefaultShareMigrationTargetOutcomeIndexes, getTradingMigrateSharesGuardMessage, getTradingMintGuardMessage, getTradingRedeemCompleteSetGuardMessage, getTradingRedeemSharesGuardMessage } from '../lib/trading.js'
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
	selectedPool,
	tradingActiveAction,
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
	const sections = (
		<>
			{!showSecurityPoolAddressInput ? undefined : (
				<SectionBlock density='compact'>
					<label className='field'>
						<span>Security Pool Address</span>
						<input value={tradingForm.securityPoolAddress} onInput={event => onTradingFormChange({ securityPoolAddress: event.currentTarget.value })} placeholder='0x...' />
					</label>
				</SectionBlock>
			)}

			{latestTradingAction}

			{selectedPool === undefined ? undefined : (
				<SectionBlock title='Your Shares'>
					<div className='workflow-metric-grid'>
						<MetricField label='Yes'>{renderShareMetricValue(shareBalances?.yes)}</MetricField>
						<MetricField label='No'>{renderShareMetricValue(shareBalances?.no)}</MetricField>
						<MetricField label='Invalid'>{renderShareMetricValue(shareBalances?.invalid)}</MetricField>
						<MetricField label='Total Complete Sets'>{renderShareMetricValue(maxRedeemableCompleteSets)}</MetricField>
					</div>
				</SectionBlock>
			)}

			<SectionBlock title='Mint Complete Sets'>
				<label className='field'>
					<span>Mint Complete Sets Amount</span>
					<input value={tradingForm.completeSetAmount} inputMode='decimal' onInput={event => onTradingFormChange({ completeSetAmount: event.currentTarget.value })} />
				</label>
				<div className='actions'>
					<TransactionActionButton idleLabel='Mint Complete Sets' pendingLabel='Minting complete sets...' onClick={onCreateCompleteSet} pending={tradingActiveAction === 'createCompleteSet'} availability={{ disabled: mintGuardMessage !== undefined, reason: mintGuardMessage }} />
				</div>
			</SectionBlock>

			<SectionBlock title='Redeem Complete Sets'>
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
					<TransactionActionButton
						idleLabel='Redeem Complete Sets'
						pendingLabel='Redeeming complete sets...'
						onClick={onRedeemCompleteSet}
						pending={tradingActiveAction === 'redeemCompleteSet'}
						tone='secondary'
						availability={{ disabled: redeemCompleteSetGuardMessage !== undefined, reason: redeemCompleteSetGuardMessage }}
					/>
				</div>
			</SectionBlock>

			<SectionBlock title='Migrate Forked Shares'>
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
					<TransactionActionButton idleLabel='Migrate Shares' pendingLabel='Migrating shares...' onClick={onMigrateShares} pending={tradingActiveAction === 'migrateShares'} tone='secondary' availability={{ disabled: migrateSharesGuardMessage !== undefined, reason: migrateSharesGuardMessage }} />
				</div>
			</SectionBlock>

			<SectionBlock title='Redeem Resolved Shares'>
				<div className='actions'>
					<TransactionActionButton idleLabel='Redeem Shares' pendingLabel='Redeeming shares...' onClick={onRedeemShares} pending={tradingActiveAction === 'redeemShares'} tone='secondary' availability={{ disabled: redeemSharesGuardMessage !== undefined, reason: redeemSharesGuardMessage }} />
				</div>
			</SectionBlock>

			<ErrorNotice message={tradingError} />
		</>
	)

	if (embedInCard) {
		return sections
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

			<div className='workflow-stack route-workflow-stack'>{sections}</div>
		</section>
	)
}
