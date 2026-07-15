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
import { formatCurrencyInputBalance } from '../lib/formatters.js'
import { tryParseBigIntListInput } from '../lib/inputs.js'
import { isMainnetChain } from '../lib/network.js'
import { getReportingOutcomeLabel, REPORTING_OUTCOME_DROPDOWN_OPTIONS } from '../lib/reporting.js'
import { deriveSecurityPoolLifecycleState, evaluateSecurityPoolState } from '../lib/securityPoolState.js'
import {
	UI_STRING_BOND_ALLOWANCE_IN_USE,
	UI_STRING_BURN_MATCHING_YES_NO_AND_INVALID_SHARES_TO_RECOVER_COLLATERAL_FROM_THE_CURRENT_POOL,
	UI_STRING_BURN_PARENT_POOL_SHARES_FOR_ONE_OUTCOME_AND_RECREATE_THEM_ACROSS_SELECTED_CHILD_UNIVERSES,
	UI_STRING_CONNECT_A_WALLET_BEFORE_MIGRATING_SHARES,
	UI_STRING_CONNECT_A_WALLET_BEFORE_MINTING_COMPLETE_SETS,
	UI_STRING_CONNECT_A_WALLET_BEFORE_REDEEMING_COMPLETE_SETS,
	UI_STRING_CONNECT_A_WALLET_BEFORE_REDEEMING_SHARES,
	UI_STRING_ETH,
	UI_STRING_HEX_VALUE_PLACEHOLDER,
	UI_STRING_INVALID,
	UI_STRING_LIMITED_BY_YOUR_SMALLEST_YES_NO_OR_INVALID_BALANCE,
	UI_STRING_LOAD_A_POOL_BEFORE_MIGRATING_SHARES,
	UI_STRING_LOAD_A_POOL_BEFORE_MINTING_COMPLETE_SETS,
	UI_STRING_LOAD_A_POOL_BEFORE_REDEEMING_COMPLETE_SETS,
	UI_STRING_LOAD_A_POOL_BEFORE_REDEEMING_SHARES,
	UI_STRING_LOADING_FORK_TARGET_UNIVERSES_TRADING_SECTION_LOADING_FORK_TARGET_UNIVERSES_REASON,
	UI_STRING_LOADING_MINT_CAPACITY,
	UI_STRING_LOADING_WALLET_SHARE_BALANCES,
	UI_STRING_LOCK_COLLATERAL_TO_MINT_A_FRESH_YES_NO_AND_INVALID_SHARE_SET_FOR_THIS_POOL,
	UI_STRING_MAX,
	UI_STRING_MIGRATE_FORKED_SHARES,
	UI_STRING_MIGRATE_FORKED_SHARES_TRADING_SECTION_MIGRATE_FORKED_SHARES_TITLE,
	UI_STRING_MIGRATE_SHARES,
	UI_STRING_MIGRATING_BURNS_THE_SELECTED_PARENT_POOL_SHARE_BALANCE_AND_RECREATES_IT_ACROSS_THE_CHOSEN_CHILD_UNIVERSES_REVIEW_THE_SOURCE_OUTCOME_AND_TARGET_UNIVERSES_CAREFULLY_BEFORE_SUBMITTING,
	UI_STRING_MIGRATING_SHARES,
	UI_STRING_MINT_COMPLETE_SETS,
	UI_STRING_MINT_COMPLETE_SETS_AMOUNT,
	UI_STRING_MINT_COMPLETE_SETS_TRADING_SECTION_MINT_COMPLETE_SETS_ACTION_LABEL,
	UI_STRING_MINTING_COMPLETE_SETS,
	UI_STRING_NO,
	UI_STRING_NO_MINT_CAPACITY_REMAINING,
	UI_STRING_REDEEM_COMPLETE_SETS,
	UI_STRING_REDEEM_COMPLETE_SETS_AMOUNT,
	UI_STRING_REDEEM_COMPLETE_SETS_TRADING_SECTION_REDEEM_COMPLETE_SETS_ACTION_LABEL,
	UI_STRING_REDEEM_FINAL_WINNING_SHARES_AFTER_THE_SELECTED_POOL_FULLY_RESOLVES,
	UI_STRING_REDEEM_FINALIZED_WINNING_SHARES_ONCE_THE_SELECTED_POOL_HAS_RESOLVED,
	UI_STRING_REDEEM_RESOLVED_SHARES,
	UI_STRING_REDEEM_RESOLVED_SHARES_TRADING_SECTION_REDEEM_SHARES_ACTION_LABEL,
	UI_STRING_REDEEM_SHARES,
	UI_STRING_REDEEMABLE_COMPLETE_SETS,
	UI_STRING_REDEEMING_COMPLETE_SETS,
	UI_STRING_REDEEMING_COMPLETE_SETS_REQUIRES_MATCHING_YES_NO_AND_INVALID_SHARES_USE_THE_REDEEMABLE_COMPLETE_SETS_AMOUNT_AS_THE_CEILING,
	UI_STRING_REDEEMING_SHARES,
	UI_STRING_REFRESH_THE_FORK_TARGET_UNIVERSES,
	UI_STRING_REP,
	UI_STRING_REP_BACKING,
	UI_STRING_REVIEW_AVAILABLE_CAPACITY_AND_CONFIRM_THE_COMPLETE_SET_MINT_AMOUNT_BEFORE_SUBMITTING,
	UI_STRING_SECURITY_POOL_ADDRESS,
	UI_STRING_SHARE_OUTCOME_TO_MIGRATE,
	UI_STRING_SHARES,
	UI_STRING_THIS_MARKET_HAS_ALREADY_FINALIZED,
	UI_STRING_TOTAL_ACROSS_OUTCOMES,
	UI_STRING_WAIT_FOR_THE_SELECTED_POOL_TO_RESOLVE_BEFORE_REDEEMING_SHARES,
	UI_STRING_WALLET_BALANCES_ARE_NOT_LOADED,
	UI_STRING_YES,
	UI_STRING_YOUR_HOLDINGS,
	UI_TEMPLATE_ACTION_UNAVAILABLE_REASON,
	UI_TEMPLATE_NO_SHARES_AVAILABLE_TO_MIGRATE_REASON,
} from '../lib/uiStrings.js'
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
	const walletOnWrongNetwork = accountState.address !== undefined && !isMainnet
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
		if (!hasSelectedPool) return UI_STRING_LOAD_A_POOL_BEFORE_MINTING_COMPLETE_SETS
		if (accountState.address === undefined) return UI_STRING_CONNECT_A_WALLET_BEFORE_MINTING_COMPLETE_SETS

		return (() => {
			if (!isMainnet) return undefined
			if (selectedPool?.questionOutcome !== 'none') return UI_STRING_THIS_MARKET_HAS_ALREADY_FINALIZED
			if (remainingMintCapacity === undefined) return UI_STRING_LOADING_MINT_CAPACITY
			if (hasUndefinedCompleteSetExchangeRate(selectedPool?.completeSetCollateralAmount, selectedPool?.shareTokenSupply) === true) return UNDEFINED_COMPLETE_SET_EXCHANGE_RATE_MESSAGE

			return (() => {
				if (remainingMintCapacity === 0n) {
					if (hasRepBackedPoolWithNoActiveAllowance(selectedPool?.totalRepDeposit, selectedPool?.totalSecurityBondAllowance)) return NO_MINT_CAPACITY_NO_ACTIVE_ALLOWANCE_MESSAGE

					return UI_STRING_NO_MINT_CAPACITY_REMAINING
				}

				return undefined
			})()
		})()
	})()
	const redeemCompleteSetsLauncherBlocker = (() => {
		if (!hasSelectedPool) return UI_STRING_LOAD_A_POOL_BEFORE_REDEEMING_COMPLETE_SETS
		if (accountState.address === undefined) return UI_STRING_CONNECT_A_WALLET_BEFORE_REDEEMING_COMPLETE_SETS

		return (() => {
			if (!isMainnet) return undefined
			if (loadingTradingDetails) return UI_STRING_LOADING_WALLET_SHARE_BALANCES

			return (() => {
				if (maxRedeemableCompleteSets === undefined) return UI_STRING_LOADING_WALLET_SHARE_BALANCES
				if (maxRedeemableCompleteSets === 0n) return NEED_MATCHING_COMPLETE_SET_SHARES_MESSAGE

				return undefined
			})()
		})()
	})()
	const migrateSharesLauncherBlocker = (() => {
		if (!hasSelectedPool) return UI_STRING_LOAD_A_POOL_BEFORE_MIGRATING_SHARES
		if (accountState.address === undefined) return UI_STRING_CONNECT_A_WALLET_BEFORE_MIGRATING_SHARES

		return (() => {
			if (!isMainnet) return undefined
			if (loadingTradingForkUniverse) return UI_STRING_LOADING_FORK_TARGET_UNIVERSES_TRADING_SECTION_LOADING_FORK_TARGET_UNIVERSES_REASON

			return (() => {
				if (tradingForkUniverse === undefined || !tradingForkUniverse.hasForked) return UI_STRING_REFRESH_THE_FORK_TARGET_UNIVERSES
				if (loadingTradingDetails) return UI_STRING_LOADING_WALLET_SHARE_BALANCES

				return (() => {
					if (selectedOutcomeBalance === undefined) return UI_STRING_LOADING_WALLET_SHARE_BALANCES
					if (selectedOutcomeBalance === 0n) return UI_TEMPLATE_NO_SHARES_AVAILABLE_TO_MIGRATE_REASON(getReportingOutcomeLabel(tradingForm.selectedShareOutcome))

					return undefined
				})()
			})()
		})()
	})()
	const redeemSharesLauncherBlocker = !hasSelectedPool
		? UI_STRING_LOAD_A_POOL_BEFORE_REDEEMING_SHARES
		: (() => {
				if (accountState.address === undefined) return UI_STRING_CONNECT_A_WALLET_BEFORE_REDEEMING_SHARES
				if (!isMainnet) return undefined
				if (selectedPool?.questionOutcome === 'none') return UI_STRING_WAIT_FOR_THE_SELECTED_POOL_TO_RESOLVE_BEFORE_REDEEMING_SHARES

				return undefined
			})()
	const effectiveMintLauncherBlocker = mintLauncherBlocker ?? (mintEnabled ? undefined : UI_TEMPLATE_ACTION_UNAVAILABLE_REASON(UI_STRING_MINT_COMPLETE_SETS_TRADING_SECTION_MINT_COMPLETE_SETS_ACTION_LABEL))
	const effectiveRedeemCompleteSetsLauncherBlocker = redeemCompleteSetsLauncherBlocker ?? (redeemCompleteSetsEnabled ? undefined : UI_TEMPLATE_ACTION_UNAVAILABLE_REASON(UI_STRING_REDEEM_COMPLETE_SETS_TRADING_SECTION_REDEEM_COMPLETE_SETS_ACTION_LABEL))
	const effectiveMigrateSharesLauncherBlocker = migrateSharesLauncherBlocker ?? (migrateSharesEnabled ? undefined : UI_TEMPLATE_ACTION_UNAVAILABLE_REASON(UI_STRING_MIGRATE_FORKED_SHARES))
	const effectiveRedeemSharesLauncherBlocker = redeemSharesLauncherBlocker ?? (redeemSharesEnabled ? undefined : UI_TEMPLATE_ACTION_UNAVAILABLE_REASON(UI_STRING_REDEEM_RESOLVED_SHARES_TRADING_SECTION_REDEEM_SHARES_ACTION_LABEL))
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
			actionLabel: UI_STRING_MINT_COMPLETE_SETS_TRADING_SECTION_MINT_COMPLETE_SETS_ACTION_LABEL,
			description: UI_STRING_LOCK_COLLATERAL_TO_MINT_A_FRESH_YES_NO_AND_INVALID_SHARE_SET_FOR_THIS_POOL,
			key: 'mint-complete-sets',
			readiness: !walletOnWrongNetwork && mintEnabled && effectiveMintLauncherBlocker === undefined ? 'ready' : 'blocked',
			title: UI_STRING_MINT_COMPLETE_SETS,
			...(!walletOnWrongNetwork && mintEnabled && effectiveMintLauncherBlocker === undefined ? { onAction: () => setActiveModal('mint') } : {}),
			...(effectiveMintLauncherBlocker === undefined ? {} : { blocker: effectiveMintLauncherBlocker }),
		},
		{
			actionLabel: UI_STRING_REDEEM_COMPLETE_SETS_TRADING_SECTION_REDEEM_COMPLETE_SETS_ACTION_LABEL,
			description: UI_STRING_BURN_MATCHING_YES_NO_AND_INVALID_SHARES_TO_RECOVER_COLLATERAL_FROM_THE_CURRENT_POOL,
			key: 'redeem-complete-sets',
			readiness: !walletOnWrongNetwork && redeemCompleteSetsEnabled && effectiveRedeemCompleteSetsLauncherBlocker === undefined ? 'ready' : 'blocked',
			title: UI_STRING_REDEEM_COMPLETE_SETS,
			...(!walletOnWrongNetwork && redeemCompleteSetsEnabled && effectiveRedeemCompleteSetsLauncherBlocker === undefined ? { onAction: () => setActiveModal('redeem-complete-sets') } : {}),
			...(effectiveRedeemCompleteSetsLauncherBlocker === undefined ? {} : { blocker: effectiveRedeemCompleteSetsLauncherBlocker }),
		},
		{
			actionLabel: UI_STRING_MIGRATE_FORKED_SHARES,
			description: UI_STRING_BURN_PARENT_POOL_SHARES_FOR_ONE_OUTCOME_AND_RECREATE_THEM_ACROSS_SELECTED_CHILD_UNIVERSES,
			key: 'migrate-shares',
			readiness: !walletOnWrongNetwork && migrateSharesEnabled && effectiveMigrateSharesLauncherBlocker === undefined ? 'ready' : 'blocked',
			title: UI_STRING_MIGRATE_FORKED_SHARES_TRADING_SECTION_MIGRATE_FORKED_SHARES_TITLE,
			...(!walletOnWrongNetwork && migrateSharesEnabled && effectiveMigrateSharesLauncherBlocker === undefined ? { onAction: () => setActiveModal('migrate-shares') } : {}),
			...(effectiveMigrateSharesLauncherBlocker === undefined ? {} : { blocker: effectiveMigrateSharesLauncherBlocker }),
		},
		{
			actionLabel: UI_STRING_REDEEM_RESOLVED_SHARES_TRADING_SECTION_REDEEM_SHARES_ACTION_LABEL,
			description: UI_STRING_REDEEM_FINAL_WINNING_SHARES_AFTER_THE_SELECTED_POOL_FULLY_RESOLVES,
			key: 'redeem-shares',
			readiness: !walletOnWrongNetwork && redeemSharesEnabled && effectiveRedeemSharesLauncherBlocker === undefined ? 'ready' : 'blocked',
			title: UI_STRING_REDEEM_RESOLVED_SHARES,
			...(!walletOnWrongNetwork && redeemSharesEnabled && effectiveRedeemSharesLauncherBlocker === undefined ? { onAction: () => setActiveModal('redeem-shares') } : {}),
			...(effectiveRedeemSharesLauncherBlocker === undefined ? {} : { blocker: effectiveRedeemSharesLauncherBlocker }),
		},
	]
	const sections = (
		<>
			{!showSecurityPoolAddressInput ? undefined : (
				<SectionBlock density='compact'>
					<label className='field'>
						<span>{UI_STRING_SECURITY_POOL_ADDRESS}</span>
						<FormInput value={tradingForm.securityPoolAddress} onInput={event => onTradingFormChange({ securityPoolAddress: event.currentTarget.value })} placeholder={UI_STRING_HEX_VALUE_PLACEHOLDER} />
					</label>
				</SectionBlock>
			)}

			{selectedPool === undefined ? undefined : (
				<SectionBlock title={UI_STRING_YOUR_HOLDINGS}>
					<div className='trading-holdings-stage'>
						<div className='trading-holdings-hero'>
							<span>{UI_STRING_REDEEMABLE_COMPLETE_SETS}</span>
							<strong>{renderShareMetricValue(displayMaxRedeemableCompleteSets)}</strong>
							<p className='detail'>{UI_STRING_LIMITED_BY_YOUR_SMALLEST_YES_NO_OR_INVALID_BALANCE}</p>
						</div>
						<div className='trading-holdings-layout'>
							<RankedBarList
								className='trading-share-distribution'
								emptyMessage={UI_STRING_WALLET_BALANCES_ARE_NOT_LOADED}
								items={[
									{
										key: 'yes',
										label: UI_STRING_YES,
										valueText: renderShareMetricValue(displayShareBalances?.yes),
										...(displayShareBalances?.yes === undefined ? {} : { value: displayShareBalances.yes }),
									},
									{
										key: 'no',
										label: UI_STRING_NO,
										valueText: renderShareMetricValue(displayShareBalances?.no),
										...(displayShareBalances?.no === undefined ? {} : { value: displayShareBalances.no }),
									},
									{
										key: 'invalid',
										label: UI_STRING_INVALID,
										valueText: renderShareMetricValue(displayShareBalances?.invalid),
										...(displayShareBalances?.invalid === undefined ? {} : { value: displayShareBalances.invalid }),
									},
								]}
							/>
							<div className='trading-share-callouts'>
								<div>
									<span>{UI_STRING_YES}</span>
									<strong>{renderShareMetricValue(displayShareBalances?.yes)}</strong>
								</div>
								<div>
									<span>{UI_STRING_NO}</span>
									<strong>{renderShareMetricValue(displayShareBalances?.no)}</strong>
								</div>
								<div>
									<span>{UI_STRING_INVALID}</span>
									<strong>{renderShareMetricValue(displayShareBalances?.invalid)}</strong>
								</div>
								<div className='trading-share-callouts-total'>
									<span>{UI_STRING_TOTAL_ACROSS_OUTCOMES}</span>
									<strong>{renderShareMetricValue(totalShareCount)}</strong>
								</div>
							</div>
						</div>
					</div>
				</SectionBlock>
			)}

			<SectionBlock title={UI_STRING_SHARES}>
				<div className='vault-action-launcher-grid'>
					{tradingLaunchers.map(action => (
						<ActionLauncherCard key={action.key} action={action} />
					))}
				</div>
			</SectionBlock>

			<ErrorNotice message={tradingError} />

			<OperationModal description={UI_STRING_REVIEW_AVAILABLE_CAPACITY_AND_CONFIRM_THE_COMPLETE_SET_MINT_AMOUNT_BEFORE_SUBMITTING} isOpen={activeModal === 'mint'} onClose={() => setActiveModal(undefined)} title={UI_STRING_MINT_COMPLETE_SETS}>
				{selectedPool === undefined ? undefined : (
					<MetricGrid>
						<MetricField label={UI_STRING_BOND_ALLOWANCE_IN_USE}>
							<CurrencyValue value={selectedPool.totalSecurityBondAllowance} suffix={UI_STRING_ETH} />
						</MetricField>
						<MetricField label={UI_STRING_REP_BACKING}>
							<CurrencyValue value={selectedPool.totalRepDeposit} suffix={UI_STRING_REP} />
						</MetricField>
					</MetricGrid>
				)}
				<label className='field'>
					<span>{UI_STRING_MINT_COMPLETE_SETS_AMOUNT}</span>
					<FormInput value={tradingForm.completeSetAmount} inputMode='decimal' onInput={event => onTradingFormChange({ completeSetAmount: event.currentTarget.value })} />
				</label>
				{mintGuardMessage === undefined ? undefined : <p className='detail'>{mintGuardMessage}</p>}
				<div className='actions'>
					<TransactionActionButton
						idleLabel={UI_STRING_MINT_COMPLETE_SETS}
						pendingLabel={UI_STRING_MINTING_COMPLETE_SETS}
						onClick={onCreateCompleteSet}
						pending={tradingActiveAction === 'createCompleteSet'}
						availability={{ disabled: !isMainnet || !mintEnabled || mintGuardMessage !== undefined, reason: mintEnabled ? mintGuardMessage : undefined }}
					/>
				</div>
			</OperationModal>

			<OperationModal description={UI_STRING_REDEEMING_COMPLETE_SETS_REQUIRES_MATCHING_YES_NO_AND_INVALID_SHARES_USE_THE_REDEEMABLE_COMPLETE_SETS_AMOUNT_AS_THE_CEILING} isOpen={activeModal === 'redeem-complete-sets'} onClose={() => setActiveModal(undefined)} title={UI_STRING_REDEEM_COMPLETE_SETS}>
				<label className='field'>
					<span>{UI_STRING_REDEEM_COMPLETE_SETS_AMOUNT}</span>
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
							{UI_STRING_MAX}
						</button>
					</div>
				</label>
				{redeemCompleteSetGuardMessage === undefined ? undefined : <p className='detail'>{redeemCompleteSetGuardMessage}</p>}
				<div className='actions'>
					<TransactionActionButton
						idleLabel={UI_STRING_REDEEM_COMPLETE_SETS}
						pendingLabel={UI_STRING_REDEEMING_COMPLETE_SETS}
						onClick={onRedeemCompleteSet}
						pending={tradingActiveAction === 'redeemCompleteSet'}
						tone='secondary'
						availability={{ disabled: !isMainnet || !redeemCompleteSetsEnabled || redeemCompleteSetGuardMessage !== undefined, reason: redeemCompleteSetsEnabled ? redeemCompleteSetGuardMessage : undefined }}
					/>
				</div>
			</OperationModal>

			<OperationModal
				description={UI_STRING_MIGRATING_BURNS_THE_SELECTED_PARENT_POOL_SHARE_BALANCE_AND_RECREATES_IT_ACROSS_THE_CHOSEN_CHILD_UNIVERSES_REVIEW_THE_SOURCE_OUTCOME_AND_TARGET_UNIVERSES_CAREFULLY_BEFORE_SUBMITTING}
				isOpen={activeModal === 'migrate-shares'}
				onClose={() => setActiveModal(undefined)}
				title={UI_STRING_MIGRATE_FORKED_SHARES_TRADING_SECTION_MIGRATE_FORKED_SHARES_TITLE}
			>
				<label className='field'>
					<span>{UI_STRING_SHARE_OUTCOME_TO_MIGRATE}</span>
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
						idleLabel={UI_STRING_MIGRATE_SHARES}
						pendingLabel={UI_STRING_MIGRATING_SHARES}
						onClick={onMigrateShares}
						pending={tradingActiveAction === 'migrateShares'}
						tone='secondary'
						availability={{ disabled: !isMainnet || !migrateSharesEnabled || migrateSharesGuardMessage !== undefined, reason: migrateSharesEnabled ? migrateSharesGuardMessage : undefined }}
					/>
				</div>
			</OperationModal>

			<OperationModal description={UI_STRING_REDEEM_FINALIZED_WINNING_SHARES_ONCE_THE_SELECTED_POOL_HAS_RESOLVED} isOpen={activeModal === 'redeem-shares'} onClose={() => setActiveModal(undefined)} title={UI_STRING_REDEEM_RESOLVED_SHARES}>
				{redeemSharesGuardMessage === undefined ? undefined : <p className='detail'>{redeemSharesGuardMessage}</p>}
				<div className='actions'>
					<TransactionActionButton
						idleLabel={UI_STRING_REDEEM_SHARES}
						pendingLabel={UI_STRING_REDEEMING_SHARES}
						onClick={onRedeemShares}
						pending={tradingActiveAction === 'redeemShares'}
						tone='secondary'
						availability={{ disabled: !isMainnet || !redeemSharesEnabled || redeemSharesGuardMessage !== undefined, reason: redeemSharesEnabled ? redeemSharesGuardMessage : undefined }}
					/>
				</div>
			</OperationModal>
		</>
	)
	if (embedInCard) return sections
	return (
		<RouteWorkflowPanel showHeader={showHeader} title={UI_STRING_SHARES}>
			{sections}
		</RouteWorkflowPanel>
	)
}
