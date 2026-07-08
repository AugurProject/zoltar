import { useEffect, useState } from 'preact/hooks'
import { zeroAddress } from '@zoltar/shared/ethereum'
import { ActionLauncherCard } from './ActionLauncherCard.js'
import { CurrencyValue } from './CurrencyValue.js'
import { EnumDropdown } from './EnumDropdown.js'
import { ErrorNotice } from './ErrorNotice.js'
import { FormInput } from './FormInput.js'
import { MetricGrid } from './MetricGrid.js'
import { MetricField } from './MetricField.js'
import { OperationModal } from './OperationModal.js'
import { RankedBarList } from './RankedBarList.js'
import { RouteWorkflowPanel } from './RouteWorkflowPanel.js'
import { SectionBlock } from './SectionBlock.js'
import { ShareMigrationTargetsSection } from './ShareMigrationTargetsSection.js'
import { TransactionActionButton } from './TransactionActionButton.js'
import { getTradingActionSafetyId } from '../lib/actionSafety/ids.js'
import { formatCurrencyInputBalance } from '../lib/formatters.js'
import { tryParseBigIntListInput } from '../lib/inputs.js'
import { isMainnetChain } from '../lib/network.js'
import { getReportingOutcomeLabel, REPORTING_OUTCOME_DROPDOWN_OPTIONS } from '../lib/reporting.js'
import { deriveSecurityPoolLifecycleState, evaluateSecurityPoolState } from '../lib/securityPoolState.js'
import {
	getDefaultShareMigrationTargetOutcomeIndexes,
	getRemainingMintCapacity,
	getSelectedOutcomeShareBalance,
	getTradingMigrateSharesGuardMessage,
	getTradingMintGuardMessage,
	getTradingRedeemCompleteSetGuardMessage,
	convertShareAmountToCollateralAmount,
	getTradingRedeemSharesGuardMessage,
	hasUndefinedCompleteSetExchangeRate,
	hasRepBackedPoolWithNoActiveAllowance,
	NEED_MATCHING_COMPLETE_SET_SHARES_MESSAGE,
	NO_MINT_CAPACITY_NO_ACTIVE_ALLOWANCE_MESSAGE,
	UNDEFINED_COMPLETE_SET_EXCHANGE_RATE_MESSAGE,
} from '../lib/trading.js'
import type { ReadinessAction } from '../types/components.js'
import type { TradingSectionProps } from '../types/components.js'
type TradingActionModal = 'mint' | 'redeem-complete-sets' | 'migrate-shares' | 'redeem-shares' | undefined
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
	poolState,
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
	const [activeModal, setActiveModal] = useState<TradingActionModal>(undefined)
	const isMainnet = isMainnetChain(accountState.chainId)
	const hasSelectedPool = selectedPool !== undefined
	const poolUniverseHasForked = selectedPool?.universeHasForked === true || tradingForkUniverse?.hasForked === true
	const resolvedPoolState =
		poolState ??
		evaluateSecurityPoolState({
			lifecycleState: deriveSecurityPoolLifecycleState({
				hasForkActivity: selectedPool?.hasForkActivity,
				isChildPool: selectedPool !== undefined && selectedPool.parent !== zeroAddress,
				questionOutcome: selectedPool?.questionOutcome,
				systemState: selectedPool?.systemState,
				universeHasForked: poolUniverseHasForked,
			}),
			universeHasForked: poolUniverseHasForked,
		})
	const mintEnabled = resolvedPoolState.actions.createCompleteSet.enabled
	const redeemCompleteSetsEnabled = resolvedPoolState.actions.redeemCompleteSet.enabled
	const migrateSharesEnabled = resolvedPoolState.actions.migrateShares.enabled
	const redeemSharesEnabled = resolvedPoolState.actions.redeemShares.enabled
	const shareBalances = tradingDetails?.shareBalances
	const maxRedeemableCompleteSets = tradingDetails?.maxRedeemableCompleteSets
	const displayMaxRedeemableCompleteSets = convertShareAmountToCollateralAmount(maxRedeemableCompleteSets, selectedPool?.completeSetCollateralAmount, selectedPool?.shareTokenSupply)
	const displayShareBalances =
		shareBalances === undefined
			? undefined
			: {
					invalid: convertShareAmountToCollateralAmount(shareBalances.invalid, selectedPool?.completeSetCollateralAmount, selectedPool?.shareTokenSupply),
					no: convertShareAmountToCollateralAmount(shareBalances.no, selectedPool?.completeSetCollateralAmount, selectedPool?.shareTokenSupply),
					yes: convertShareAmountToCollateralAmount(shareBalances.yes, selectedPool?.completeSetCollateralAmount, selectedPool?.shareTokenSupply),
				}
	const selectedTargetOutcomeIndexes = tryParseBigIntListInput(tradingForm.targetOutcomeIndexes) ?? []
	const selectedTargetOutcomeIndexSet = new Set(selectedTargetOutcomeIndexes.map(value => value.toString()))
	const totalShareCount = displayShareBalances === undefined ? undefined : displayShareBalances.invalid + displayShareBalances.no + displayShareBalances.yes
	const mintGuardMessage = getTradingMintGuardMessage({
		accountAddress: accountState.address,
		completeSetCollateralAmount: selectedPool?.completeSetCollateralAmount,
		ethBalance: accountState.ethBalance,
		hasSelectedPool,
		isMainnet,
		mintAmountInput: tradingForm.completeSetAmount,
		shareTokenSupply: selectedPool?.shareTokenSupply,
		totalRepDeposit: selectedPool?.totalRepDeposit,
		totalSecurityBondAllowance: selectedPool?.totalSecurityBondAllowance,
	})
	const redeemCompleteSetGuardMessage = getTradingRedeemCompleteSetGuardMessage({
		accountAddress: accountState.address,
		completeSetCollateralAmount: selectedPool?.completeSetCollateralAmount,
		hasSelectedPool,
		isMainnet,
		loadingTradingDetails,
		redeemAmountInput: tradingForm.redeemAmount,
		shareBalances,
		shareTokenSupply: selectedPool?.shareTokenSupply,
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
	})
	const redeemSharesGuardMessage = getTradingRedeemSharesGuardMessage({
		accountAddress: accountState.address,
		hasSelectedPool,
		isMainnet,
	})
	const remainingMintCapacity = getRemainingMintCapacity(selectedPool?.totalSecurityBondAllowance, selectedPool?.completeSetCollateralAmount, selectedPool?.shareTokenSupply)
	const selectedOutcomeBalance = getSelectedOutcomeShareBalance(shareBalances, tradingForm.selectedShareOutcome)
	const mintLauncherBlocker = (() => {
		if (!hasSelectedPool) return 'Load a pool before minting complete sets.'
		if (accountState.address === undefined) return 'Connect a wallet before minting complete sets.'

		return (() => {
			if (!isMainnet) return 'Switch to Ethereum mainnet before minting complete sets.'
			if (selectedPool?.questionOutcome !== 'none') return 'This market has already finalized.'
			if (remainingMintCapacity === undefined) return 'Loading mint capacity.'
			if (hasUndefinedCompleteSetExchangeRate(selectedPool?.completeSetCollateralAmount, selectedPool?.shareTokenSupply) === true) return UNDEFINED_COMPLETE_SET_EXCHANGE_RATE_MESSAGE

			return (() => {
				if (remainingMintCapacity === 0n) {
					if (hasRepBackedPoolWithNoActiveAllowance(selectedPool?.totalRepDeposit, selectedPool?.totalSecurityBondAllowance)) return NO_MINT_CAPACITY_NO_ACTIVE_ALLOWANCE_MESSAGE

					return 'No mint capacity remaining.'
				}

				return undefined
			})()
		})()
	})()
	const redeemCompleteSetsLauncherBlocker = (() => {
		if (!hasSelectedPool) return 'Load a pool before redeeming complete sets.'
		if (accountState.address === undefined) return 'Connect a wallet before redeeming complete sets.'

		return (() => {
			if (!isMainnet) return 'Switch to Ethereum mainnet before redeeming complete sets.'
			if (loadingTradingDetails) return 'Loading wallet share balances.'

			return (() => {
				if (maxRedeemableCompleteSets === undefined) return 'Loading wallet share balances.'
				if (maxRedeemableCompleteSets === 0n) return NEED_MATCHING_COMPLETE_SET_SHARES_MESSAGE

				return undefined
			})()
		})()
	})()
	const migrateSharesLauncherBlocker = (() => {
		if (!hasSelectedPool) return 'Load a pool before migrating shares.'
		if (accountState.address === undefined) return 'Connect a wallet before migrating shares.'

		return (() => {
			if (!isMainnet) return 'Switch to Ethereum mainnet before migrating shares.'
			if (loadingTradingForkUniverse) return 'Loading fork target universes.'

			return (() => {
				if (tradingForkUniverse === undefined || !tradingForkUniverse.hasForked) return 'Refresh the fork target universes.'
				if (loadingTradingDetails) return 'Loading wallet share balances.'

				return (() => {
					if (selectedOutcomeBalance === undefined) return 'Loading wallet share balances.'
					if (selectedOutcomeBalance === 0n) return `No ${getReportingOutcomeLabel(tradingForm.selectedShareOutcome)} shares available to migrate.`

					return undefined
				})()
			})()
		})()
	})()
	const redeemSharesLauncherBlocker = !hasSelectedPool
		? 'Load a pool before redeeming shares.'
		: (() => {
				if (accountState.address === undefined) return 'Connect a wallet before redeeming shares.'
				if (!isMainnet) return 'Switch to Ethereum mainnet before redeeming shares.'
				if (selectedPool?.questionOutcome === 'none') return 'Wait for the selected pool to resolve before redeeming shares.'

				return undefined
			})()
	const effectiveMintLauncherBlocker = mintLauncherBlocker ?? (mintEnabled ? undefined : 'Mint complete sets is not available right now.')
	const effectiveRedeemCompleteSetsLauncherBlocker = redeemCompleteSetsLauncherBlocker ?? (redeemCompleteSetsEnabled ? undefined : 'Redeem complete sets is not available right now.')
	const effectiveMigrateSharesLauncherBlocker = migrateSharesLauncherBlocker ?? (migrateSharesEnabled ? undefined : 'Migrate forked shares is not available right now.')
	const effectiveRedeemSharesLauncherBlocker = redeemSharesLauncherBlocker ?? (redeemSharesEnabled ? undefined : 'Redeem resolved shares is not available right now.')
	const shareMigrationSelectionDisabled = poolUniverseHasForked !== true
	const setAllTargetOutcomeIndexes = () => {
		onTradingFormChange({ targetOutcomeIndexes: getDefaultShareMigrationTargetOutcomeIndexes(tradingForkUniverse) })
	}
	const clearTargetOutcomeIndexes = () => {
		onTradingFormChange({ targetOutcomeIndexes: '' })
	}
	useEffect(() => {
		if (tradingResult === undefined) return
		setActiveModal(currentModal => {
			if (tradingResult.action === 'createCompleteSet' && currentModal === 'mint') return undefined
			if (tradingResult.action === 'redeemCompleteSet' && currentModal === 'redeem-complete-sets') return undefined
			if (tradingResult.action === 'migrateShares' && currentModal === 'migrate-shares') return undefined
			if (tradingResult.action === 'redeemShares' && currentModal === 'redeem-shares') return undefined
			return currentModal
		})
	}, [tradingResult])
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
	const renderShareMetricValue = (value: bigint | undefined) => <CurrencyValue loading={loadingTradingDetails} value={value} />
	const tradingLaunchers: ReadinessAction[] = [
		{
			actionLabel: 'Mint complete sets',
			description: 'Lock collateral to mint a fresh Yes, No, and Invalid share set for this pool.',
			key: 'mint-complete-sets',
			readiness: mintEnabled && effectiveMintLauncherBlocker === undefined ? 'ready' : 'blocked',
			safetyId: getTradingActionSafetyId('createCompleteSet'),
			title: 'Mint Complete Sets',
			...(mintEnabled && effectiveMintLauncherBlocker === undefined ? { onAction: () => setActiveModal('mint') } : {}),
			...(effectiveMintLauncherBlocker === undefined ? {} : { blocker: effectiveMintLauncherBlocker }),
		},
		{
			actionLabel: 'Redeem complete sets',
			description: 'Burn matching Yes, No, and Invalid shares to recover collateral from the current pool.',
			key: 'redeem-complete-sets',
			readiness: redeemCompleteSetsEnabled && effectiveRedeemCompleteSetsLauncherBlocker === undefined ? 'ready' : 'blocked',
			safetyId: getTradingActionSafetyId('redeemCompleteSet'),
			title: 'Redeem Complete Sets',
			...(redeemCompleteSetsEnabled && effectiveRedeemCompleteSetsLauncherBlocker === undefined ? { onAction: () => setActiveModal('redeem-complete-sets') } : {}),
			...(effectiveRedeemCompleteSetsLauncherBlocker === undefined ? {} : { blocker: effectiveRedeemCompleteSetsLauncherBlocker }),
		},
		{
			actionLabel: 'Migrate forked shares',
			description: 'Burn parent-pool shares for one outcome and recreate them across selected child universes.',
			key: 'migrate-shares',
			readiness: migrateSharesEnabled && effectiveMigrateSharesLauncherBlocker === undefined ? 'ready' : 'blocked',
			safetyId: getTradingActionSafetyId('migrateShares'),
			title: 'Migrate Forked Shares',
			...(migrateSharesEnabled && effectiveMigrateSharesLauncherBlocker === undefined ? { onAction: () => setActiveModal('migrate-shares') } : {}),
			...(effectiveMigrateSharesLauncherBlocker === undefined ? {} : { blocker: effectiveMigrateSharesLauncherBlocker }),
		},
		{
			actionLabel: 'Redeem resolved shares',
			description: 'Redeem final winning shares after the selected pool fully resolves.',
			key: 'redeem-shares',
			readiness: redeemSharesEnabled && effectiveRedeemSharesLauncherBlocker === undefined ? 'ready' : 'blocked',
			safetyId: getTradingActionSafetyId('redeemShares'),
			title: 'Redeem Resolved Shares',
			...(redeemSharesEnabled && effectiveRedeemSharesLauncherBlocker === undefined ? { onAction: () => setActiveModal('redeem-shares') } : {}),
			...(effectiveRedeemSharesLauncherBlocker === undefined ? {} : { blocker: effectiveRedeemSharesLauncherBlocker }),
		},
	]
	const sections = (
		<>
			{!showSecurityPoolAddressInput ? undefined : (
				<SectionBlock density='compact'>
					<label className='field'>
						<span>Security Pool Address</span>
						<FormInput value={tradingForm.securityPoolAddress} onInput={event => onTradingFormChange({ securityPoolAddress: event.currentTarget.value })} placeholder='0x...' />
					</label>
				</SectionBlock>
			)}

			{selectedPool === undefined ? undefined : (
				<SectionBlock title='Your Holdings'>
					<div className='trading-holdings-stage'>
						<div className='trading-holdings-hero'>
							<span>Redeemable Complete Sets</span>
							<strong>{renderShareMetricValue(displayMaxRedeemableCompleteSets)}</strong>
							<p className='detail'>Limited by your smallest Yes, No, or Invalid balance.</p>
						</div>
						<div className='trading-holdings-layout'>
							<RankedBarList
								className='trading-share-distribution'
								emptyMessage='Wallet balances are not loaded yet.'
								items={[
									{
										key: 'yes',
										label: 'Yes',
										valueText: renderShareMetricValue(displayShareBalances?.yes),
										...(displayShareBalances?.yes === undefined ? {} : { value: displayShareBalances.yes }),
									},
									{
										key: 'no',
										label: 'No',
										valueText: renderShareMetricValue(displayShareBalances?.no),
										...(displayShareBalances?.no === undefined ? {} : { value: displayShareBalances.no }),
									},
									{
										key: 'invalid',
										label: 'Invalid',
										valueText: renderShareMetricValue(displayShareBalances?.invalid),
										...(displayShareBalances?.invalid === undefined ? {} : { value: displayShareBalances.invalid }),
									},
								]}
							/>
							<div className='trading-share-callouts'>
								<div>
									<span>Yes</span>
									<strong>{renderShareMetricValue(displayShareBalances?.yes)}</strong>
								</div>
								<div>
									<span>No</span>
									<strong>{renderShareMetricValue(displayShareBalances?.no)}</strong>
								</div>
								<div>
									<span>Invalid</span>
									<strong>{renderShareMetricValue(displayShareBalances?.invalid)}</strong>
								</div>
								<div className='trading-share-callouts-total'>
									<span>Total Across Outcomes</span>
									<strong>{renderShareMetricValue(totalShareCount)}</strong>
								</div>
							</div>
						</div>
					</div>
				</SectionBlock>
			)}

			<SectionBlock title='Shares'>
				<div className='vault-action-launcher-grid'>
					{tradingLaunchers.map(action => (
						<ActionLauncherCard key={action.key} action={action} />
					))}
				</div>
			</SectionBlock>

			<ErrorNotice message={tradingError} />

			<OperationModal description='Review available capacity and confirm the complete-set mint amount before submitting.' isOpen={activeModal === 'mint'} onClose={() => setActiveModal(undefined)} title='Mint Complete Sets'>
				{selectedPool === undefined ? undefined : (
					<MetricGrid>
						<MetricField label='Bond Allowance In Use'>
							<CurrencyValue value={selectedPool.totalSecurityBondAllowance} suffix='ETH' />
						</MetricField>
						<MetricField label='REP Backing'>
							<CurrencyValue value={selectedPool.totalRepDeposit} suffix='REP' />
						</MetricField>
					</MetricGrid>
				)}
				<label className='field'>
					<span>Mint Complete Sets Amount</span>
					<FormInput value={tradingForm.completeSetAmount} inputMode='decimal' onInput={event => onTradingFormChange({ completeSetAmount: event.currentTarget.value })} />
				</label>
				{mintGuardMessage === undefined ? undefined : <p className='detail'>{mintGuardMessage}</p>}
				<div className='actions'>
					<TransactionActionButton
						safetyId={getTradingActionSafetyId('createCompleteSet')}
						idleLabel='Mint Complete Sets'
						pendingLabel='Minting complete sets...'
						onClick={onCreateCompleteSet}
						pending={tradingActiveAction === 'createCompleteSet'}
						availability={{ disabled: !mintEnabled || mintGuardMessage !== undefined, reason: mintEnabled ? mintGuardMessage : undefined }}
					/>
				</div>
			</OperationModal>

			<OperationModal description='Redeeming complete sets requires matching yes, no, and invalid shares. Use the redeemable complete sets amount as the ceiling.' isOpen={activeModal === 'redeem-complete-sets'} onClose={() => setActiveModal(undefined)} title='Redeem Complete Sets'>
				<label className='field'>
					<span>Redeem Complete Sets Amount</span>
					<div className='field-inline'>
						<FormInput className='field-inline-input' value={tradingForm.redeemAmount} inputMode='decimal' onInput={event => onTradingFormChange({ redeemAmount: event.currentTarget.value })} />
						<button
							className='quiet field-inline-action'
							type='button'
							onClick={() => {
								if (displayMaxRedeemableCompleteSets === undefined) return
								onTradingFormChange({ redeemAmount: formatCurrencyInputBalance(displayMaxRedeemableCompleteSets) })
							}}
							disabled={displayMaxRedeemableCompleteSets === undefined || displayMaxRedeemableCompleteSets <= 0n}
						>
							Max
						</button>
					</div>
				</label>
				{redeemCompleteSetGuardMessage === undefined ? undefined : <p className='detail'>{redeemCompleteSetGuardMessage}</p>}
				<div className='actions'>
					<TransactionActionButton
						safetyId={getTradingActionSafetyId('redeemCompleteSet')}
						idleLabel='Redeem Complete Sets'
						pendingLabel='Redeeming complete sets...'
						onClick={onRedeemCompleteSet}
						pending={tradingActiveAction === 'redeemCompleteSet'}
						tone='secondary'
						availability={{ disabled: !redeemCompleteSetsEnabled || redeemCompleteSetGuardMessage !== undefined, reason: redeemCompleteSetsEnabled ? redeemCompleteSetGuardMessage : undefined }}
					/>
				</div>
			</OperationModal>

			<OperationModal
				description='Migrating burns the selected parent-pool share balance and recreates it across the chosen child universes. Review the source outcome and target universes carefully before submitting.'
				isOpen={activeModal === 'migrate-shares'}
				onClose={() => setActiveModal(undefined)}
				title='Migrate Forked Shares'
			>
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
				{migrateSharesGuardMessage === undefined ? undefined : <p className='detail'>{migrateSharesGuardMessage}</p>}
				<div className='actions'>
					<TransactionActionButton
						safetyId={getTradingActionSafetyId('migrateShares')}
						idleLabel='Migrate Shares'
						pendingLabel='Migrating shares...'
						onClick={onMigrateShares}
						pending={tradingActiveAction === 'migrateShares'}
						tone='secondary'
						availability={{ disabled: !migrateSharesEnabled || migrateSharesGuardMessage !== undefined, reason: migrateSharesEnabled ? migrateSharesGuardMessage : undefined }}
					/>
				</div>
			</OperationModal>

			<OperationModal description='Redeem finalized winning shares once the selected pool has resolved.' isOpen={activeModal === 'redeem-shares'} onClose={() => setActiveModal(undefined)} title='Redeem Resolved Shares'>
				{redeemSharesGuardMessage === undefined ? undefined : <p className='detail'>{redeemSharesGuardMessage}</p>}
				<div className='actions'>
					<TransactionActionButton
						safetyId={getTradingActionSafetyId('redeemShares')}
						idleLabel='Redeem Shares'
						pendingLabel='Redeeming shares...'
						onClick={onRedeemShares}
						pending={tradingActiveAction === 'redeemShares'}
						tone='secondary'
						availability={{ disabled: !redeemSharesEnabled || redeemSharesGuardMessage !== undefined, reason: redeemSharesEnabled ? redeemSharesGuardMessage : undefined }}
					/>
				</div>
			</OperationModal>
		</>
	)
	if (embedInCard) return sections
	return (
		<RouteWorkflowPanel showHeader={showHeader} title='Shares'>
			{sections}
		</RouteWorkflowPanel>
	)
}
