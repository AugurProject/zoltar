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
import { UI_STRINGS } from '../lib/uiStrings.js'
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
		if (!hasSelectedPool) return UI_STRINGS.tradingSection.loadPoolToMintReason
		if (accountState.address === undefined) return UI_STRINGS.tradingSection.connectWalletToMintReason

		return (() => {
			if (!isMainnet) return UI_STRINGS.tradingSection.switchToMainnetToMintReason
			if (selectedPool?.questionOutcome !== 'none') return UI_STRINGS.tradingSection.marketAlreadyFinalizedReason
			if (remainingMintCapacity === undefined) return UI_STRINGS.tradingSection.loadingMintCapacityReason
			if (hasUndefinedCompleteSetExchangeRate(selectedPool?.completeSetCollateralAmount, selectedPool?.shareTokenSupply) === true) return UNDEFINED_COMPLETE_SET_EXCHANGE_RATE_MESSAGE

			return (() => {
				if (remainingMintCapacity === 0n) {
					if (hasRepBackedPoolWithNoActiveAllowance(selectedPool?.totalRepDeposit, selectedPool?.totalSecurityBondAllowance)) return NO_MINT_CAPACITY_NO_ACTIVE_ALLOWANCE_MESSAGE

					return UI_STRINGS.tradingSection.noMintCapacityRemainingReason
				}

				return undefined
			})()
		})()
	})()
	const redeemCompleteSetsLauncherBlocker = (() => {
		if (!hasSelectedPool) return UI_STRINGS.tradingSection.loadPoolToRedeemCompleteSetsReason
		if (accountState.address === undefined) return UI_STRINGS.tradingSection.connectWalletToRedeemCompleteSetsReason

		return (() => {
			if (!isMainnet) return UI_STRINGS.tradingSection.switchToMainnetToRedeemCompleteSetsReason
			if (loadingTradingDetails) return UI_STRINGS.tradingSection.loadWalletShareBalancesReason

			return (() => {
				if (maxRedeemableCompleteSets === undefined) return UI_STRINGS.tradingSection.loadWalletShareBalancesReason
				if (maxRedeemableCompleteSets === 0n) return NEED_MATCHING_COMPLETE_SET_SHARES_MESSAGE

				return undefined
			})()
		})()
	})()
	const migrateSharesLauncherBlocker = (() => {
		if (!hasSelectedPool) return UI_STRINGS.tradingSection.loadPoolToMigrateSharesReason
		if (accountState.address === undefined) return UI_STRINGS.tradingSection.connectWalletToMigrateSharesReason

		return (() => {
			if (!isMainnet) return UI_STRINGS.tradingSection.switchToMainnetToMigrateSharesReason
			if (loadingTradingForkUniverse) return UI_STRINGS.tradingSection.loadingForkTargetUniversesReason

			return (() => {
				if (tradingForkUniverse === undefined || !tradingForkUniverse.hasForked) return UI_STRINGS.tradingSection.refreshForkTargetUniversesReason
				if (loadingTradingDetails) return UI_STRINGS.tradingSection.loadWalletShareBalancesReason

				return (() => {
					if (selectedOutcomeBalance === undefined) return UI_STRINGS.tradingSection.loadWalletShareBalancesReason
					if (selectedOutcomeBalance === 0n) return UI_STRINGS.tradingSection.noSharesAvailableToMigrateReason(getReportingOutcomeLabel(tradingForm.selectedShareOutcome))

					return undefined
				})()
			})()
		})()
	})()
	const redeemSharesLauncherBlocker = !hasSelectedPool
		? UI_STRINGS.tradingSection.loadPoolToRedeemSharesReason
		: (() => {
				if (accountState.address === undefined) return UI_STRINGS.tradingSection.connectWalletToRedeemSharesReason
				if (!isMainnet) return UI_STRINGS.tradingSection.switchToMainnetToRedeemSharesReason
				if (selectedPool?.questionOutcome === 'none') return UI_STRINGS.tradingSection.waitForPoolToResolveReason

				return undefined
			})()
	const effectiveMintLauncherBlocker = mintLauncherBlocker ?? (mintEnabled ? undefined : UI_STRINGS.tradingSection.actionUnavailableReason(UI_STRINGS.tradingSection.mintCompleteSetsActionLabel))
	const effectiveRedeemCompleteSetsLauncherBlocker = redeemCompleteSetsLauncherBlocker ?? (redeemCompleteSetsEnabled ? undefined : UI_STRINGS.tradingSection.actionUnavailableReason(UI_STRINGS.tradingSection.redeemCompleteSetsActionLabel))
	const effectiveMigrateSharesLauncherBlocker = migrateSharesLauncherBlocker ?? (migrateSharesEnabled ? undefined : UI_STRINGS.tradingSection.actionUnavailableReason(UI_STRINGS.tradingSection.migrateForkedSharesActionLabel))
	const effectiveRedeemSharesLauncherBlocker = redeemSharesLauncherBlocker ?? (redeemSharesEnabled ? undefined : UI_STRINGS.tradingSection.actionUnavailableReason(UI_STRINGS.tradingSection.redeemSharesActionLabel))
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
			actionLabel: UI_STRINGS.tradingSection.mintCompleteSetsActionLabel,
			description: UI_STRINGS.tradingSection.mintCompleteSetsDescription,
			key: 'mint-complete-sets',
			readiness: mintEnabled && effectiveMintLauncherBlocker === undefined ? 'ready' : 'blocked',
			safetyId: getTradingActionSafetyId('createCompleteSet'),
			title: UI_STRINGS.tradingSection.mintCompleteSetsTitle,
			...(mintEnabled && effectiveMintLauncherBlocker === undefined ? { onAction: () => setActiveModal('mint') } : {}),
			...(effectiveMintLauncherBlocker === undefined ? {} : { blocker: effectiveMintLauncherBlocker }),
		},
		{
			actionLabel: UI_STRINGS.tradingSection.redeemCompleteSetsActionLabel,
			description: UI_STRINGS.tradingSection.redeemCompleteSetsDescription,
			key: 'redeem-complete-sets',
			readiness: redeemCompleteSetsEnabled && effectiveRedeemCompleteSetsLauncherBlocker === undefined ? 'ready' : 'blocked',
			safetyId: getTradingActionSafetyId('redeemCompleteSet'),
			title: UI_STRINGS.tradingSection.redeemCompleteSetsTitle,
			...(redeemCompleteSetsEnabled && effectiveRedeemCompleteSetsLauncherBlocker === undefined ? { onAction: () => setActiveModal('redeem-complete-sets') } : {}),
			...(effectiveRedeemCompleteSetsLauncherBlocker === undefined ? {} : { blocker: effectiveRedeemCompleteSetsLauncherBlocker }),
		},
		{
			actionLabel: UI_STRINGS.tradingSection.migrateForkedSharesActionLabel,
			description: UI_STRINGS.tradingSection.migrateForkedSharesDescription,
			key: 'migrate-shares',
			readiness: migrateSharesEnabled && effectiveMigrateSharesLauncherBlocker === undefined ? 'ready' : 'blocked',
			safetyId: getTradingActionSafetyId('migrateShares'),
			title: UI_STRINGS.tradingSection.migrateForkedSharesTitle,
			...(migrateSharesEnabled && effectiveMigrateSharesLauncherBlocker === undefined ? { onAction: () => setActiveModal('migrate-shares') } : {}),
			...(effectiveMigrateSharesLauncherBlocker === undefined ? {} : { blocker: effectiveMigrateSharesLauncherBlocker }),
		},
		{
			actionLabel: UI_STRINGS.tradingSection.redeemSharesActionLabel,
			description: UI_STRINGS.tradingSection.redeemSharesDescription,
			key: 'redeem-shares',
			readiness: redeemSharesEnabled && effectiveRedeemSharesLauncherBlocker === undefined ? 'ready' : 'blocked',
			safetyId: getTradingActionSafetyId('redeemShares'),
			title: UI_STRINGS.tradingSection.redeemSharesTitle,
			...(redeemSharesEnabled && effectiveRedeemSharesLauncherBlocker === undefined ? { onAction: () => setActiveModal('redeem-shares') } : {}),
			...(effectiveRedeemSharesLauncherBlocker === undefined ? {} : { blocker: effectiveRedeemSharesLauncherBlocker }),
		},
	]
	const sections = (
		<>
			{!showSecurityPoolAddressInput ? undefined : (
				<SectionBlock density='compact'>
					<label className='field'>
						<span>{UI_STRINGS.tradingSection.securityPoolAddressLabel}</span>
						<FormInput value={tradingForm.securityPoolAddress} onInput={event => onTradingFormChange({ securityPoolAddress: event.currentTarget.value })} placeholder={UI_STRINGS.common.hexValuePlaceholder} />
					</label>
				</SectionBlock>
			)}

			{selectedPool === undefined ? undefined : (
				<SectionBlock title={UI_STRINGS.tradingSection.yourHoldingsTitle}>
					<div className='trading-holdings-stage'>
						<div className='trading-holdings-hero'>
							<span>{UI_STRINGS.tradingSection.redeemableCompleteSetsLabel}</span>
							<strong>{renderShareMetricValue(displayMaxRedeemableCompleteSets)}</strong>
							<p className='detail'>{UI_STRINGS.tradingSection.redeemableCompleteSetsDetail}</p>
						</div>
						<div className='trading-holdings-layout'>
							<RankedBarList
								className='trading-share-distribution'
								emptyMessage={UI_STRINGS.tradingSection.shareBalancesNotLoadedMessage}
								items={[
									{
										key: 'yes',
										label: UI_STRINGS.tradingSection.shareOutcomeYesLabel,
										valueText: renderShareMetricValue(displayShareBalances?.yes),
										...(displayShareBalances?.yes === undefined ? {} : { value: displayShareBalances.yes }),
									},
									{
										key: 'no',
										label: UI_STRINGS.tradingSection.shareOutcomeNoLabel,
										valueText: renderShareMetricValue(displayShareBalances?.no),
										...(displayShareBalances?.no === undefined ? {} : { value: displayShareBalances.no }),
									},
									{
										key: 'invalid',
										label: UI_STRINGS.question.invalidOutcomeLabel,
										valueText: renderShareMetricValue(displayShareBalances?.invalid),
										...(displayShareBalances?.invalid === undefined ? {} : { value: displayShareBalances.invalid }),
									},
								]}
							/>
							<div className='trading-share-callouts'>
								<div>
									<span>{UI_STRINGS.tradingSection.shareOutcomeYesLabel}</span>
									<strong>{renderShareMetricValue(displayShareBalances?.yes)}</strong>
								</div>
								<div>
									<span>{UI_STRINGS.tradingSection.shareOutcomeNoLabel}</span>
									<strong>{renderShareMetricValue(displayShareBalances?.no)}</strong>
								</div>
								<div>
									<span>{UI_STRINGS.question.invalidOutcomeLabel}</span>
									<strong>{renderShareMetricValue(displayShareBalances?.invalid)}</strong>
								</div>
								<div className='trading-share-callouts-total'>
									<span>{UI_STRINGS.tradingSection.totalAcrossOutcomesLabel}</span>
									<strong>{renderShareMetricValue(totalShareCount)}</strong>
								</div>
							</div>
						</div>
					</div>
				</SectionBlock>
			)}

			<SectionBlock title={UI_STRINGS.tradingSection.sharesSectionTitle}>
				<div className='vault-action-launcher-grid'>
					{tradingLaunchers.map(action => (
						<ActionLauncherCard key={action.key} action={action} />
					))}
				</div>
			</SectionBlock>

			<ErrorNotice message={tradingError} />

			<OperationModal description={UI_STRINGS.tradingSection.mintCompleteSetsModalDescription} isOpen={activeModal === 'mint'} onClose={() => setActiveModal(undefined)} title={UI_STRINGS.tradingSection.mintCompleteSetsTitle}>
				{selectedPool === undefined ? undefined : (
					<MetricGrid>
						<MetricField label={UI_STRINGS.tradingSection.bondAllowanceInUseLabel}>
							<CurrencyValue value={selectedPool.totalSecurityBondAllowance} suffix={UI_STRINGS.common.ethSuffix} />
						</MetricField>
						<MetricField label={UI_STRINGS.tradingSection.repBackingLabel}>
							<CurrencyValue value={selectedPool.totalRepDeposit} suffix={UI_STRINGS.common.repLabel} />
						</MetricField>
					</MetricGrid>
				)}
				<label className='field'>
					<span>{UI_STRINGS.tradingSection.mintCompleteSetsAmountLabel}</span>
					<FormInput value={tradingForm.completeSetAmount} inputMode='decimal' onInput={event => onTradingFormChange({ completeSetAmount: event.currentTarget.value })} />
				</label>
				{mintGuardMessage === undefined ? undefined : <p className='detail'>{mintGuardMessage}</p>}
				<div className='actions'>
					<TransactionActionButton
						safetyId={getTradingActionSafetyId('createCompleteSet')}
						idleLabel={UI_STRINGS.tradingSection.mintCompleteSetsTitle}
						pendingLabel={UI_STRINGS.tradingSection.mintCompleteSetsPendingLabel}
						onClick={onCreateCompleteSet}
						pending={tradingActiveAction === 'createCompleteSet'}
						availability={{ disabled: !mintEnabled || mintGuardMessage !== undefined, reason: mintEnabled ? mintGuardMessage : undefined }}
					/>
				</div>
			</OperationModal>

			<OperationModal description={UI_STRINGS.tradingSection.redeemCompleteSetsModalDescription} isOpen={activeModal === 'redeem-complete-sets'} onClose={() => setActiveModal(undefined)} title={UI_STRINGS.tradingSection.redeemCompleteSetsTitle}>
				<label className='field'>
					<span>{UI_STRINGS.tradingSection.completeSetRedeemAmountLabel}</span>
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
							{UI_STRINGS.common.maxLabel}
						</button>
					</div>
				</label>
				{redeemCompleteSetGuardMessage === undefined ? undefined : <p className='detail'>{redeemCompleteSetGuardMessage}</p>}
				<div className='actions'>
					<TransactionActionButton
						safetyId={getTradingActionSafetyId('redeemCompleteSet')}
						idleLabel={UI_STRINGS.tradingSection.redeemCompleteSetsTitle}
						pendingLabel={UI_STRINGS.tradingSection.redeemCompleteSetsPendingLabel}
						onClick={onRedeemCompleteSet}
						pending={tradingActiveAction === 'redeemCompleteSet'}
						tone='secondary'
						availability={{ disabled: !redeemCompleteSetsEnabled || redeemCompleteSetGuardMessage !== undefined, reason: redeemCompleteSetsEnabled ? redeemCompleteSetGuardMessage : undefined }}
					/>
				</div>
			</OperationModal>

			<OperationModal description={UI_STRINGS.tradingSection.migrateForkedSharesModalDescription} isOpen={activeModal === 'migrate-shares'} onClose={() => setActiveModal(undefined)} title={UI_STRINGS.tradingSection.migrateForkedSharesTitle}>
				<label className='field'>
					<span>{UI_STRINGS.tradingSection.shareOutcomeToMigrateLabel}</span>
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
						idleLabel={UI_STRINGS.tradingSection.migrateSharesIdleLabel}
						pendingLabel={UI_STRINGS.tradingSection.migrateSharesPendingLabel}
						onClick={onMigrateShares}
						pending={tradingActiveAction === 'migrateShares'}
						tone='secondary'
						availability={{ disabled: !migrateSharesEnabled || migrateSharesGuardMessage !== undefined, reason: migrateSharesEnabled ? migrateSharesGuardMessage : undefined }}
					/>
				</div>
			</OperationModal>

			<OperationModal description={UI_STRINGS.tradingSection.redeemResolvedSharesModalDescription} isOpen={activeModal === 'redeem-shares'} onClose={() => setActiveModal(undefined)} title={UI_STRINGS.tradingSection.redeemSharesTitle}>
				{redeemSharesGuardMessage === undefined ? undefined : <p className='detail'>{redeemSharesGuardMessage}</p>}
				<div className='actions'>
					<TransactionActionButton
						safetyId={getTradingActionSafetyId('redeemShares')}
						idleLabel={UI_STRINGS.tradingSection.redeemSharesIdleLabel}
						pendingLabel={UI_STRINGS.tradingSection.redeemSharesPendingLabel}
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
		<RouteWorkflowPanel showHeader={showHeader} title={UI_STRINGS.tradingSection.sharesSectionTitle}>
			{sections}
		</RouteWorkflowPanel>
	)
}
