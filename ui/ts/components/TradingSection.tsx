import * as commonCopy from '../copy/common.js'
import * as tradingCopy from '../copy/trading.js'
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
		if (!hasSelectedPool) return tradingCopy.completeSetMintPoolRequiredReason
		if (accountState.address === undefined) return tradingCopy.completeSetMintWalletRequiredReason

		return (() => {
			if (!isMainnet) return undefined
			if (selectedPool?.questionOutcome !== 'none') return tradingCopy.marketFinalizedReason
			if (remainingMintCapacity === undefined) return tradingCopy.loadingMintCapacity
			if (hasUndefinedCompleteSetExchangeRate(selectedPool?.completeSetCollateralAmount, selectedPool?.shareTokenSupply) === true) return UNDEFINED_COMPLETE_SET_EXCHANGE_RATE_MESSAGE

			return (() => {
				if (remainingMintCapacity === 0n) {
					if (hasRepBackedPoolWithNoActiveAllowance(selectedPool?.totalRepDeposit, selectedPool?.totalSecurityBondAllowance)) return NO_MINT_CAPACITY_NO_ACTIVE_ALLOWANCE_MESSAGE

					return tradingCopy.mintCapacityEmpty
				}

				return undefined
			})()
		})()
	})()
	const redeemCompleteSetsLauncherBlocker = (() => {
		if (!hasSelectedPool) return tradingCopy.completeSetBurnPoolRequiredReason
		if (accountState.address === undefined) return tradingCopy.completeSetBurnWalletRequiredReason

		return (() => {
			if (!isMainnet) return undefined
			if (loadingTradingDetails) return tradingCopy.loadingWalletShareBalances

			return (() => {
				if (maxRedeemableCompleteSets === undefined) return tradingCopy.loadingWalletShareBalances
				if (maxRedeemableCompleteSets === 0n) return NEED_MATCHING_COMPLETE_SET_SHARES_MESSAGE

				return undefined
			})()
		})()
	})()
	const migrateSharesLauncherBlocker = (() => {
		if (!hasSelectedPool) return tradingCopy.shareMigrationPoolRequiredReason
		if (accountState.address === undefined) return tradingCopy.shareMigrationWalletRequiredReason

		return (() => {
			if (!isMainnet) return undefined
			if (loadingTradingForkUniverse) return tradingCopy.loadingForkTargetUniversesReason

			return (() => {
				if (tradingForkUniverse === undefined || !tradingForkUniverse.hasForked) return tradingCopy.forkTargetsRefreshRequired
				if (loadingTradingDetails) return tradingCopy.loadingWalletShareBalances

				return (() => {
					if (selectedOutcomeBalance === undefined) return tradingCopy.loadingWalletShareBalances
					if (selectedOutcomeBalance === 0n) return tradingCopy.formatNoSharesAvailableToMigrateReason(getReportingOutcomeLabel(tradingForm.selectedShareOutcome))

					return undefined
				})()
			})()
		})()
	})()
	const redeemSharesLauncherBlocker = !hasSelectedPool
		? tradingCopy.shareRedemptionPoolRequiredReason
		: (() => {
				if (accountState.address === undefined) return tradingCopy.shareRedemptionWalletRequiredReason
				if (!isMainnet) return undefined
				if (selectedPool?.questionOutcome === 'none') return tradingCopy.poolResolutionRequired

				return undefined
			})()
	const effectiveMintLauncherBlocker = mintLauncherBlocker ?? (mintEnabled ? undefined : tradingCopy.formatActionUnavailableReason(tradingCopy.mintCompleteSetsActionLabel))
	const effectiveRedeemCompleteSetsLauncherBlocker = redeemCompleteSetsLauncherBlocker ?? (redeemCompleteSetsEnabled ? undefined : tradingCopy.formatActionUnavailableReason(tradingCopy.redeemCompleteSetsActionLabel))
	const effectiveMigrateSharesLauncherBlocker = migrateSharesLauncherBlocker ?? (migrateSharesEnabled ? undefined : tradingCopy.formatActionUnavailableReason(tradingCopy.migrateForkedShares))
	const effectiveRedeemSharesLauncherBlocker = redeemSharesLauncherBlocker ?? (redeemSharesEnabled ? undefined : tradingCopy.formatActionUnavailableReason(tradingCopy.redeemSharesActionLabel))
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
			actionLabel: tradingCopy.mintCompleteSetsActionLabel,
			description: tradingCopy.completeSetMintDescription,
			key: 'mint-complete-sets',
			readiness: !walletOnWrongNetwork && mintEnabled && effectiveMintLauncherBlocker === undefined ? 'ready' : 'blocked',
			title: tradingCopy.mintCompleteSets,
			...(!walletOnWrongNetwork && mintEnabled && effectiveMintLauncherBlocker === undefined ? { onAction: () => setActiveModal('mint') } : {}),
			...(effectiveMintLauncherBlocker === undefined ? {} : { blocker: effectiveMintLauncherBlocker }),
		},
		{
			actionLabel: tradingCopy.redeemCompleteSetsActionLabel,
			description: tradingCopy.completeSetBurnDescription,
			key: 'redeem-complete-sets',
			readiness: !walletOnWrongNetwork && redeemCompleteSetsEnabled && effectiveRedeemCompleteSetsLauncherBlocker === undefined ? 'ready' : 'blocked',
			title: tradingCopy.redeemCompleteSets,
			...(!walletOnWrongNetwork && redeemCompleteSetsEnabled && effectiveRedeemCompleteSetsLauncherBlocker === undefined ? { onAction: () => setActiveModal('redeem-complete-sets') } : {}),
			...(effectiveRedeemCompleteSetsLauncherBlocker === undefined ? {} : { blocker: effectiveRedeemCompleteSetsLauncherBlocker }),
		},
		{
			actionLabel: tradingCopy.migrateForkedShares,
			description: tradingCopy.shareMigrationDescription,
			key: 'migrate-shares',
			readiness: !walletOnWrongNetwork && migrateSharesEnabled && effectiveMigrateSharesLauncherBlocker === undefined ? 'ready' : 'blocked',
			title: tradingCopy.migrateForkedSharesTitle,
			...(!walletOnWrongNetwork && migrateSharesEnabled && effectiveMigrateSharesLauncherBlocker === undefined ? { onAction: () => setActiveModal('migrate-shares') } : {}),
			...(effectiveMigrateSharesLauncherBlocker === undefined ? {} : { blocker: effectiveMigrateSharesLauncherBlocker }),
		},
		{
			actionLabel: tradingCopy.redeemSharesActionLabel,
			description: tradingCopy.resolvedShareRedemptionDescription,
			key: 'redeem-shares',
			readiness: !walletOnWrongNetwork && redeemSharesEnabled && effectiveRedeemSharesLauncherBlocker === undefined ? 'ready' : 'blocked',
			title: tradingCopy.redeemResolvedShares,
			...(!walletOnWrongNetwork && redeemSharesEnabled && effectiveRedeemSharesLauncherBlocker === undefined ? { onAction: () => setActiveModal('redeem-shares') } : {}),
			...(effectiveRedeemSharesLauncherBlocker === undefined ? {} : { blocker: effectiveRedeemSharesLauncherBlocker }),
		},
	]
	const sections = (
		<>
			{!showSecurityPoolAddressInput ? undefined : (
				<SectionBlock density='compact'>
					<label className='field'>
						<span>{commonCopy.securityPoolAddress}</span>
						<FormInput value={tradingForm.securityPoolAddress} onInput={event => onTradingFormChange({ securityPoolAddress: event.currentTarget.value })} placeholder={commonCopy.hexValuePlaceholder} />
					</label>
				</SectionBlock>
			)}

			{selectedPool === undefined ? undefined : (
				<SectionBlock title={tradingCopy.yourHoldings}>
					<div className='trading-holdings-stage'>
						<div className='trading-holdings-hero'>
							<span>{tradingCopy.redeemableCompleteSets}</span>
							<strong>{renderShareMetricValue(displayMaxRedeemableCompleteSets)}</strong>
							<p className='detail'>{tradingCopy.completeSetBalanceLimitDetail}</p>
						</div>
						<div className='trading-holdings-layout'>
							<RankedBarList
								className='trading-share-distribution'
								emptyMessage={tradingCopy.walletBalancesUnavailable}
								items={[
									{
										key: 'yes',
										label: commonCopy.yes,
										valueText: renderShareMetricValue(displayShareBalances?.yes),
										...(displayShareBalances?.yes === undefined ? {} : { value: displayShareBalances.yes }),
									},
									{
										key: 'no',
										label: commonCopy.no,
										valueText: renderShareMetricValue(displayShareBalances?.no),
										...(displayShareBalances?.no === undefined ? {} : { value: displayShareBalances.no }),
									},
									{
										key: 'invalid',
										label: commonCopy.invalid,
										valueText: renderShareMetricValue(displayShareBalances?.invalid),
										...(displayShareBalances?.invalid === undefined ? {} : { value: displayShareBalances.invalid }),
									},
								]}
							/>
							<div className='trading-share-callouts'>
								<div>
									<span>{commonCopy.yes}</span>
									<strong>{renderShareMetricValue(displayShareBalances?.yes)}</strong>
								</div>
								<div>
									<span>{commonCopy.no}</span>
									<strong>{renderShareMetricValue(displayShareBalances?.no)}</strong>
								</div>
								<div>
									<span>{commonCopy.invalid}</span>
									<strong>{renderShareMetricValue(displayShareBalances?.invalid)}</strong>
								</div>
								<div className='trading-share-callouts-total'>
									<span>{tradingCopy.totalAcrossOutcomes}</span>
									<strong>{renderShareMetricValue(totalShareCount)}</strong>
								</div>
							</div>
						</div>
					</div>
				</SectionBlock>
			)}

			<SectionBlock title={tradingCopy.shares}>
				<div className='vault-action-launcher-grid'>
					{tradingLaunchers.map(action => (
						<ActionLauncherCard key={action.key} action={action} />
					))}
				</div>
			</SectionBlock>

			<ErrorNotice message={tradingError} />

			<OperationModal description={tradingCopy.completeSetMintReviewDetail} isOpen={activeModal === 'mint'} onClose={() => setActiveModal(undefined)} title={tradingCopy.mintCompleteSets}>
				{selectedPool === undefined ? undefined : (
					<MetricGrid>
						<MetricField label={tradingCopy.bondAllowanceInUse}>
							<CurrencyValue value={selectedPool.totalSecurityBondAllowance} suffix={commonCopy.eth} />
						</MetricField>
						<MetricField label={tradingCopy.repBacking}>
							<CurrencyValue value={selectedPool.totalRepDeposit} suffix={commonCopy.rep} />
						</MetricField>
					</MetricGrid>
				)}
				<label className='field'>
					<span>{tradingCopy.mintCompleteSetsAmount}</span>
					<FormInput value={tradingForm.completeSetAmount} inputMode='decimal' onInput={event => onTradingFormChange({ completeSetAmount: event.currentTarget.value })} />
				</label>
				{mintGuardMessage === undefined ? undefined : <p className='detail'>{mintGuardMessage}</p>}
				<div className='actions'>
					<TransactionActionButton
						idleLabel={tradingCopy.mintCompleteSets}
						pendingLabel={tradingCopy.mintingCompleteSets}
						onClick={onCreateCompleteSet}
						pending={tradingActiveAction === 'createCompleteSet'}
						availability={{ disabled: !isMainnet || !mintEnabled || mintGuardMessage !== undefined, reason: mintEnabled ? mintGuardMessage : undefined }}
					/>
				</div>
			</OperationModal>

			<OperationModal description={tradingCopy.redeemCompleteSetsHelpText} isOpen={activeModal === 'redeem-complete-sets'} onClose={() => setActiveModal(undefined)} title={tradingCopy.redeemCompleteSets}>
				<label className='field'>
					<span>{tradingCopy.redeemCompleteSetsAmount}</span>
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
							{commonCopy.max}
						</button>
					</div>
				</label>
				{redeemCompleteSetGuardMessage === undefined ? undefined : <p className='detail'>{redeemCompleteSetGuardMessage}</p>}
				<div className='actions'>
					<TransactionActionButton
						idleLabel={tradingCopy.redeemCompleteSets}
						pendingLabel={tradingCopy.redeemingCompleteSets}
						onClick={onRedeemCompleteSet}
						pending={tradingActiveAction === 'redeemCompleteSet'}
						tone='secondary'
						availability={{ disabled: !isMainnet || !redeemCompleteSetsEnabled || redeemCompleteSetGuardMessage !== undefined, reason: redeemCompleteSetsEnabled ? redeemCompleteSetGuardMessage : undefined }}
					/>
				</div>
			</OperationModal>

			<OperationModal description={tradingCopy.shareMigrationReviewDetail} isOpen={activeModal === 'migrate-shares'} onClose={() => setActiveModal(undefined)} title={tradingCopy.migrateForkedSharesTitle}>
				<label className='field'>
					<span>{tradingCopy.shareOutcomeToMigrate}</span>
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
						idleLabel={tradingCopy.migrateShares}
						pendingLabel={tradingCopy.migratingShares}
						onClick={onMigrateShares}
						pending={tradingActiveAction === 'migrateShares'}
						tone='secondary'
						availability={{ disabled: !isMainnet || !migrateSharesEnabled || migrateSharesGuardMessage !== undefined, reason: migrateSharesEnabled ? migrateSharesGuardMessage : undefined }}
					/>
				</div>
			</OperationModal>

			<OperationModal description={tradingCopy.winningShareRedemptionDescription} isOpen={activeModal === 'redeem-shares'} onClose={() => setActiveModal(undefined)} title={tradingCopy.redeemResolvedShares}>
				{redeemSharesGuardMessage === undefined ? undefined : <p className='detail'>{redeemSharesGuardMessage}</p>}
				<div className='actions'>
					<TransactionActionButton
						idleLabel={tradingCopy.redeemShares}
						pendingLabel={tradingCopy.redeemingShares}
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
		<RouteWorkflowPanel showHeader={showHeader} title={tradingCopy.shares}>
			{sections}
		</RouteWorkflowPanel>
	)
}
