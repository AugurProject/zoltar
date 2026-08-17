import * as commonCopy from '../../../copy/common.js'
import * as tradingCopy from '../../../copy/trading.js'
import * as transactionReviewCopy from '../../../copy/transactionReview.js'
import { useState } from 'preact/hooks'
import { zeroAddress } from '@zoltar/shared/ethereum'
import { ActionLauncherCard } from '../../../components/ActionLauncherCard.js'
import { AddressValue } from '../../../components/AddressValue.js'
import { CurrencyValue } from '../../../components/CurrencyValue.js'
import { EnumDropdown } from '../../../components/EnumDropdown.js'
import { ErrorNotice } from '../../../components/ErrorNotice.js'
import { FormInput } from '../../../components/FormInput.js'
import { MetricGrid } from '../../../components/MetricGrid.js'
import { MetricField } from '../../../components/MetricField.js'
import { OperationModal } from '../../../components/OperationModal.js'
import { RankedBarList } from '../../../components/RankedBarList.js'
import { RouteWorkflowPanel } from '../../../components/RouteWorkflowPanel.js'
import { SectionBlock } from '../../../components/SectionBlock.js'
import { ShareMigrationTargetsSection } from '../../universes/components/ShareMigrationTargetsSection.js'
import { TransactionActionButton } from '../../../components/TransactionActionButton.js'
import { TransactionReview } from '../../../components/TransactionReview.js'
import { TransactionNetworkValue } from '../../../components/TransactionNetworkValue.js'
import { useChainTimestamp } from '../../../lib/chainTimestamp.js'
import { formatCurrencyInputBalance } from '../../../lib/formatters.js'
import { tryParseBigIntListInput } from '../../../lib/inputs.js'
import { getWrongNetworkMessage, isActiveAppChain } from '../../../lib/network.js'
import { getReportingOutcomeLabel, REPORTING_OUTCOME_DROPDOWN_OPTIONS } from '../../reporting/lib/reporting.js'
import { deriveSecurityPoolLifecycleState, evaluateSecurityPoolState } from '../../security-pools/lib/securityPoolState.js'
import {
	calculateMintingCapacityAttoEth,
	estimateMintCheckpoint,
	getDefaultShareMigrationTargetOutcomeIndexes,
	getRemainingMintCapacity,
	getMaximumMintAmount,
	getSelectedOutcomeShareBalance,
	getTradingMigrateSharesGuardMessage,
	getTradingMintGuardMessage,
	getTradingRedeemCompleteSetGuardMessage,
	convertAttoSharesToSettlementCollateralAttoEth,
	convertMintSettlementCollateralAttoEthToAttoShares,
	convertSettlementCollateralAttoEthToAttoShares,
	getTradingRedeemSharesGuardMessage,
	hasUndefinedCompleteSetExchangeRate,
	hasRepBackedPoolWithNoActiveCapacityOwnership,
	NEED_MATCHING_COMPLETE_SET_SHARES_MESSAGE,
	NO_MINT_CAPACITY_NO_ACTIVE_CAPACITY_OWNERSHIP_MESSAGE,
	UNDEFINED_COMPLETE_SET_EXCHANGE_RATE_MESSAGE,
} from '../lib/trading.js'
import { tryParseTradingAmountInput } from '../lib/marketForm.js'
import type { ReadinessAction } from '../../types.js'
import type { TradingSectionProps } from '../../types.js'
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
	const currentTimestamp = useChainTimestamp()
	const isOnActiveAppChain = isActiveAppChain(accountState.chainId)
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
	const maxRedeemableCompleteSetsAttoShares = tradingDetails?.maxRedeemableCompleteSetsAttoShares
	const displayMaxRedeemableCompleteSets = convertAttoSharesToSettlementCollateralAttoEth(maxRedeemableCompleteSetsAttoShares, selectedPool?.settlementCollateralAttoEth, selectedPool?.shareTokenSupplyAttoShares)
	const displayShareBalances =
		shareBalances === undefined
			? undefined
			: {
					invalid: convertAttoSharesToSettlementCollateralAttoEth(shareBalances.invalidAttoShares, selectedPool?.settlementCollateralAttoEth, selectedPool?.shareTokenSupplyAttoShares),
					no: convertAttoSharesToSettlementCollateralAttoEth(shareBalances.noAttoShares, selectedPool?.settlementCollateralAttoEth, selectedPool?.shareTokenSupplyAttoShares),
					yes: convertAttoSharesToSettlementCollateralAttoEth(shareBalances.yesAttoShares, selectedPool?.settlementCollateralAttoEth, selectedPool?.shareTokenSupplyAttoShares),
				}
	const selectedTargetOutcomeIndexes = tryParseBigIntListInput(tradingForm.targetOutcomeIndexes) ?? []
	const selectedTargetOutcomeIndexSet = new Set(selectedTargetOutcomeIndexes.map(value => value.toString()))
	const totalShareCount = displayShareBalances === undefined ? undefined : displayShareBalances.invalid + displayShareBalances.no + displayShareBalances.yes
	const walletOnWrongNetwork = accountState.address !== undefined && !isOnActiveAppChain
	const mintAmount = tryParseTradingAmountInput(tradingForm.completeSetAmount)
	const mintingCapacityAttoEth = calculateMintingCapacityAttoEth(selectedPool?.totalCapacityOwnershipAttoRep, selectedPool?.lastOraclePrice, selectedPool?.statoblastSecurityMultiplierBps)
	const mintCheckpoint = estimateMintCheckpoint({
		currentRetentionRate: selectedPool?.currentRetentionRate,
		currentTimestamp,
		feeEligibleCapacityOwnershipAttoRep: selectedPool?.feeEligibleCapacityOwnershipAttoRep,
		feeEndTimestamp: selectedPool?.marketDetails.endTime,
		feeIndexRemainder: selectedPool?.feeAccrualState?.feeIndexRemainder,
		lastUpdatedFeeAccumulator: selectedPool?.feeAccrualState?.lastUpdatedFeeAccumulator,
		settlementCollateralAttoEth: selectedPool?.settlementCollateralAttoEth,
		totalFeesOwedRemainder: selectedPool?.feeAccrualState?.totalFeesOwedRemainder,
	})
	const estimatedSettlementCollateralAttoEth = mintCheckpoint?.settlementCollateralAfterFeesAttoEth ?? selectedPool?.settlementCollateralAttoEth
	const remainingMintCapacity = getRemainingMintCapacity(mintingCapacityAttoEth, estimatedSettlementCollateralAttoEth, selectedPool?.shareTokenSupplyAttoShares)
	const maximumMintAmount = getMaximumMintAmount(accountState.ethBalanceAttoEth, remainingMintCapacity)
	const mintedAmountAttoShares = mintAmount === undefined ? undefined : convertMintSettlementCollateralAttoEthToAttoShares(mintAmount, estimatedSettlementCollateralAttoEth, selectedPool?.shareTokenSupplyAttoShares)
	const resultingEthBalance = mintAmount === undefined || accountState.ethBalanceAttoEth === undefined || mintAmount > accountState.ethBalanceAttoEth ? undefined : accountState.ethBalanceAttoEth - mintAmount
	const redeemAmount = tryParseTradingAmountInput(tradingForm.redeemAmount)
	const redeemAmountAttoShares = redeemAmount === undefined ? undefined : convertSettlementCollateralAttoEthToAttoShares(redeemAmount, selectedPool?.settlementCollateralAttoEth, selectedPool?.shareTokenSupplyAttoShares)
	const resultingRedeemEthBalance = redeemAmount === undefined || accountState.ethBalanceAttoEth === undefined ? undefined : accountState.ethBalanceAttoEth + redeemAmount
	const resolvedWinningShareBalance = selectedPool === undefined || selectedPool.questionOutcome === 'none' ? undefined : getSelectedOutcomeShareBalance(shareBalances, selectedPool.questionOutcome)
	const resolvedWinningPayout = convertAttoSharesToSettlementCollateralAttoEth(resolvedWinningShareBalance, selectedPool?.settlementCollateralAttoEth, selectedPool?.shareTokenSupplyAttoShares)
	const mintGuardMessage = getTradingMintGuardMessage({
		accountAddress: accountState.address,
		settlementCollateralAttoEth: estimatedSettlementCollateralAttoEth,
		ethBalanceAttoEth: accountState.ethBalanceAttoEth,
		mintingCapacityAttoEth,
		hasSelectedPool,
		isOnActiveAppChain,
		mintAmountInput: tradingForm.completeSetAmount,
		shareTokenSupplyAttoShares: selectedPool?.shareTokenSupplyAttoShares,
		totalPoolHeldAttoRep: selectedPool?.totalPoolHeldAttoRep,
	})
	const redeemCompleteSetGuardMessage = getTradingRedeemCompleteSetGuardMessage({
		accountAddress: accountState.address,
		settlementCollateralAttoEth: selectedPool?.settlementCollateralAttoEth,
		hasSelectedPool,
		isOnActiveAppChain,
		loadingTradingDetails,
		redeemAmountInput: tradingForm.redeemAmount,
		shareBalances,
		shareTokenSupplyAttoShares: selectedPool?.shareTokenSupplyAttoShares,
	})
	const migrateSharesGuardMessage = getTradingMigrateSharesGuardMessage({
		accountAddress: accountState.address,
		hasSelectedPool,
		isOnActiveAppChain,
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
		isOnActiveAppChain,
	})
	const selectedOutcomeBalance = getSelectedOutcomeShareBalance(shareBalances, tradingForm.selectedShareOutcome)
	const mintLauncherBlocker = (() => {
		if (!hasSelectedPool) return tradingCopy.completeSetMintPoolRequiredReason
		if (accountState.address === undefined) return tradingCopy.completeSetMintWalletRequiredReason

		return (() => {
			if (!isOnActiveAppChain) return getWrongNetworkMessage() ?? commonCopy.mainnetRequiredReason
			if (selectedPool?.questionOutcome !== 'none') return tradingCopy.marketFinalizedReason
			if (remainingMintCapacity === undefined) return tradingCopy.loadingMintCapacity
			if (hasUndefinedCompleteSetExchangeRate(selectedPool?.settlementCollateralAttoEth, selectedPool?.shareTokenSupplyAttoShares) === true) return UNDEFINED_COMPLETE_SET_EXCHANGE_RATE_MESSAGE

			return (() => {
				if (remainingMintCapacity === 0n) {
					if (hasRepBackedPoolWithNoActiveCapacityOwnership(selectedPool?.totalPoolHeldAttoRep, selectedPool?.feeEligibleCapacityOwnershipAttoRep)) return NO_MINT_CAPACITY_NO_ACTIVE_CAPACITY_OWNERSHIP_MESSAGE

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
			if (!isOnActiveAppChain) return getWrongNetworkMessage() ?? commonCopy.mainnetRequiredReason
			if (loadingTradingDetails) return tradingCopy.loadingWalletShareBalances

			return (() => {
				if (maxRedeemableCompleteSetsAttoShares === undefined) return tradingCopy.loadingWalletShareBalances
				if (maxRedeemableCompleteSetsAttoShares === 0n) return NEED_MATCHING_COMPLETE_SET_SHARES_MESSAGE

				return undefined
			})()
		})()
	})()
	const migrateSharesLauncherBlocker = (() => {
		if (!hasSelectedPool) return tradingCopy.shareMigrationPoolRequiredReason
		if (accountState.address === undefined) return tradingCopy.shareMigrationWalletRequiredReason

		return (() => {
			if (!isOnActiveAppChain) return getWrongNetworkMessage() ?? commonCopy.mainnetRequiredReason
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
				if (!isOnActiveAppChain) return getWrongNetworkMessage() ?? commonCopy.mainnetRequiredReason
				if (selectedPool?.questionOutcome === 'none') return tradingCopy.poolResolutionRequired

				return undefined
			})()
	const effectiveMintLauncherBlocker = mintLauncherBlocker ?? (mintEnabled ? undefined : tradingCopy.formatActionUnavailableReason(tradingCopy.mintCompleteSetsActionLabel))
	const effectiveRedeemCompleteSetsLauncherBlocker = redeemCompleteSetsLauncherBlocker ?? (redeemCompleteSetsEnabled ? undefined : tradingCopy.formatActionUnavailableReason(tradingCopy.redeemCompleteSetsActionLabel))
	const effectiveMigrateSharesLauncherBlocker = migrateSharesLauncherBlocker ?? (migrateSharesEnabled ? undefined : tradingCopy.formatActionUnavailableReason(tradingCopy.migrateForkedShares))
	const effectiveRedeemSharesLauncherBlocker = redeemSharesLauncherBlocker ?? (redeemSharesEnabled ? undefined : tradingCopy.formatActionUnavailableReason(tradingCopy.redeemSharesActionLabel))
	const getModalActionReason = (actionEnabled: boolean, guardMessage: string | undefined) => {
		if (!isOnActiveAppChain) return getWrongNetworkMessage() ?? commonCopy.mainnetRequiredReason
		if (!actionEnabled) return undefined
		return guardMessage
	}
	const shareMigrationSelectionDisabled = poolUniverseHasForked !== true
	const setAllTargetOutcomeIndexes = () => {
		onTradingFormChange({ targetOutcomeIndexes: getDefaultShareMigrationTargetOutcomeIndexes(tradingForkUniverse) })
	}
	const clearTargetOutcomeIndexes = () => {
		onTradingFormChange({ targetOutcomeIndexes: '' })
	}
	const getTransactionContext = (outcome: string) =>
		selectedPool === undefined
			? []
			: [
					{ label: commonCopy.question, value: selectedPool.marketDetails.title },
					{ identityKey: 'security-pool', label: commonCopy.securityPoolAddress, value: <AddressValue address={selectedPool.securityPoolAddress} /> },
					{ identityKey: 'outcome', label: commonCopy.outcome, value: outcome },
				]
	const retentionFeeDisclosure = [
		{
			rows: [{ label: tradingCopy.retentionFee, value: tradingCopy.retentionFeeEstimateDetail }],
			title: tradingCopy.estimateDetails,
		},
	]
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
			title: tradingCopy.redeemResolvedSharesTitle,
			...(!walletOnWrongNetwork && redeemSharesEnabled && effectiveRedeemSharesLauncherBlocker === undefined ? { onAction: () => setActiveModal('redeem-shares') } : {}),
			...(effectiveRedeemSharesLauncherBlocker === undefined ? {} : { blocker: effectiveRedeemSharesLauncherBlocker }),
		},
	]
	const sections = (
		<>
			{!showSecurityPoolAddressInput ? undefined : (
				<SectionBlock density='compact' variant='embedded'>
					<label className='field'>
						<span>{commonCopy.securityPoolAddress}</span>
						<FormInput value={tradingForm.securityPoolAddress} onInput={event => onTradingFormChange({ securityPoolAddress: event.currentTarget.value })} placeholder={commonCopy.hexValuePlaceholder} />
					</label>
				</SectionBlock>
			)}

			{selectedPool === undefined ? undefined : (
				<SectionBlock title={tradingCopy.yourHoldings} variant='embedded'>
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
								<div className='trading-share-callouts-total'>
									<span>{tradingCopy.totalAcrossOutcomes}</span>
									<strong>{renderShareMetricValue(totalShareCount)}</strong>
								</div>
							</div>
						</div>
					</div>
				</SectionBlock>
			)}

			<SectionBlock title={tradingCopy.shares} variant='embedded'>
				<div className='vault-action-launcher-grid'>
					{tradingLaunchers.map(action => (
						<ActionLauncherCard key={action.key} action={action} />
					))}
				</div>
			</SectionBlock>

			<ErrorNotice message={tradingError} />

			<OperationModal closeOnSuccessKey={tradingResult?.action === 'createCompleteSet' ? tradingResult.hash : undefined} context={getTransactionContext('Complete set · Yes + No + Invalid')} isOpen={activeModal === 'mint'} onClose={() => setActiveModal(undefined)} title={tradingCopy.mintCompleteSets}>
				<MetricGrid>
					<MetricField label={tradingCopy.walletEth}>
						<CurrencyValue value={accountState.ethBalanceAttoEth} suffix={commonCopy.eth} />
					</MetricField>
					<MetricField label={tradingCopy.availableToMint}>
						<CurrencyValue loading={loadingTradingDetails} value={maximumMintAmount} suffix={commonCopy.eth} />
					</MetricField>
				</MetricGrid>
				<label className='field'>
					<span>{tradingCopy.mintCompleteSetsAmount}</span>
					<div className='field-inline'>
						<FormInput className='field-inline-input' value={tradingForm.completeSetAmount} inputMode='decimal' onInput={event => onTradingFormChange({ completeSetAmount: event.currentTarget.value })} />
						<button
							className='quiet field-inline-action'
							type='button'
							onClick={() => {
								if (maximumMintAmount === undefined) return
								onTradingFormChange({ completeSetAmount: formatCurrencyInputBalance(maximumMintAmount) })
							}}
							disabled={maximumMintAmount === undefined || maximumMintAmount <= 0n}
						>
							{commonCopy.max}
						</button>
					</div>
				</label>
				<TransactionReview
					variant='inline'
					primary={[
						{
							label: transactionReviewCopy.youPay,
							value: mintAmount === undefined ? transactionReviewCopy.amountUnavailable : <CurrencyValue value={mintAmount} suffix={commonCopy.eth} />,
						},
						{
							label: tradingCopy.estimatedSharesReceived,
							value:
								mintedAmountAttoShares === undefined ? (
									transactionReviewCopy.amountUnavailable
								) : (
									<span className='trading-minted-outcomes'>
										<span className='trading-minted-outcome'>
											{commonCopy.yes}
											{' + '}
											<CurrencyValue value={mintedAmountAttoShares} />
										</span>
										<span className='trading-minted-outcome'>
											{commonCopy.no}
											{' + '}
											<CurrencyValue value={mintedAmountAttoShares} />
										</span>
										<span className='trading-minted-outcome'>
											{commonCopy.invalid}
											{' + '}
											<CurrencyValue value={mintedAmountAttoShares} />
										</span>
									</span>
								),
						},
					]}
					details={[
						{ label: tradingCopy.estimatedRetentionFee, value: <CurrencyValue value={mintCheckpoint?.estimatedRetentionFeeAttoEth} suffix={commonCopy.eth} /> },
						{ label: transactionReviewCopy.resultingEthBalance, value: <CurrencyValue value={resultingEthBalance} suffix={commonCopy.eth} /> },
					]}
					risks={[tradingCopy.mintBalanceRisk]}
				/>
				<p className='detail'>{tradingCopy.retentionFeeEstimateDetail}</p>
				<div className='actions'>
					<TransactionActionButton
						idleLabel={tradingCopy.mintCompleteSetsActionLabel}
						pendingLabel={tradingCopy.mintingCompleteSets}
						onClick={onCreateCompleteSet}
						pending={tradingActiveAction === 'createCompleteSet'}
						availability={{ disabled: !isOnActiveAppChain || !mintEnabled || mintGuardMessage !== undefined, reason: getModalActionReason(mintEnabled, mintGuardMessage) }}
					/>
				</div>
			</OperationModal>

			<OperationModal closeOnSuccessKey={tradingResult?.action === 'redeemCompleteSet' ? tradingResult.hash : undefined} context={getTransactionContext('Complete set · Yes + No + Invalid')} isOpen={activeModal === 'redeem-complete-sets'} onClose={() => setActiveModal(undefined)} title={tradingCopy.redeemCompleteSets}>
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
				<TransactionReview
					primary={[
						{
							label: transactionReviewCopy.youPay,
							value:
								redeemAmountAttoShares === undefined ? (
									transactionReviewCopy.amountUnavailable
								) : (
									<span>
										{tradingCopy.matchingOutcomeShares}: <CurrencyValue value={redeemAmountAttoShares} />
									</span>
								),
						},
						{ label: tradingCopy.estimatedEthReceived, value: <CurrencyValue value={redeemAmount} suffix={commonCopy.eth} /> },
					]}
					disclosures={retentionFeeDisclosure}
					details={[{ label: tradingCopy.estimatedResultingEthBalance, value: <CurrencyValue value={resultingRedeemEthBalance} suffix={commonCopy.eth} /> }]}
					risks={[tradingCopy.redeemCompleteSetRisk]}
				/>
				<div className='actions'>
					<TransactionActionButton
						idleLabel={tradingCopy.redeemCompleteSetsActionLabel}
						pendingLabel={tradingCopy.redeemingCompleteSets}
						onClick={onRedeemCompleteSet}
						pending={tradingActiveAction === 'redeemCompleteSet'}
						tone='secondary'
						availability={{ disabled: !isOnActiveAppChain || !redeemCompleteSetsEnabled || redeemCompleteSetGuardMessage !== undefined, reason: getModalActionReason(redeemCompleteSetsEnabled, redeemCompleteSetGuardMessage) }}
					/>
				</div>
			</OperationModal>

			<OperationModal
				closeOnSuccessKey={tradingResult?.action === 'migrateShares' ? tradingResult.hash : undefined}
				context={getTransactionContext(getReportingOutcomeLabel(tradingForm.selectedShareOutcome))}
				isOpen={activeModal === 'migrate-shares'}
				onClose={() => setActiveModal(undefined)}
				title={tradingCopy.migrateForkedSharesTitle}
			>
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
				<TransactionReview
					primary={[
						{ label: tradingCopy.sourceOutcomeShares, value: <CurrencyValue value={selectedOutcomeBalance} /> },
						{
							label: tradingCopy.recreatedChildShares,
							value:
								selectedTargetOutcomeIndexes.length === 0 ? (
									tradingCopy.targetChildUniversesEmpty
								) : (
									<span>
										<CurrencyValue value={selectedOutcomeBalance} /> × {selectedTargetOutcomeIndexes.length.toString()}
									</span>
								),
						},
					]}
					details={[{ label: tradingCopy.selectedChildUniversesLabel, value: selectedTargetOutcomeIndexes.length === 0 ? tradingCopy.notSelected : selectedTargetOutcomeIndexes.join(', ') }]}
					risks={[tradingCopy.shareMigrationRisk]}
				/>
				<div className='actions'>
					<TransactionActionButton
						idleLabel={tradingCopy.migrateShares}
						pendingLabel={tradingCopy.migratingShares}
						onClick={onMigrateShares}
						pending={tradingActiveAction === 'migrateShares'}
						tone='secondary'
						availability={{ disabled: !isOnActiveAppChain || !migrateSharesEnabled || migrateSharesGuardMessage !== undefined, reason: getModalActionReason(migrateSharesEnabled, migrateSharesGuardMessage) }}
					/>
				</div>
			</OperationModal>

			<OperationModal
				closeOnSuccessKey={tradingResult?.action === 'redeemShares' ? tradingResult.hash : undefined}
				context={getTransactionContext(selectedPool?.questionOutcome === undefined || selectedPool.questionOutcome === 'none' ? commonCopy.unavailable : getReportingOutcomeLabel(selectedPool.questionOutcome))}
				isOpen={activeModal === 'redeem-shares'}
				onClose={() => setActiveModal(undefined)}
				title={tradingCopy.redeemResolvedSharesTitle}
			>
				<TransactionReview
					primary={[
						{ label: tradingCopy.winningShares, value: <CurrencyValue value={resolvedWinningShareBalance} /> },
						{ label: tradingCopy.estimatedEthReceived, value: <CurrencyValue value={resolvedWinningPayout} suffix={commonCopy.eth} /> },
					]}
					disclosures={retentionFeeDisclosure}
					details={[{ label: tradingCopy.estimatedResultingEthBalance, value: <CurrencyValue value={resolvedWinningPayout === undefined || accountState.ethBalanceAttoEth === undefined ? undefined : accountState.ethBalanceAttoEth + resolvedWinningPayout} suffix={commonCopy.eth} /> }]}
					risks={[tradingCopy.resolvedShareRisk]}
				/>
				<div className='actions'>
					<TransactionActionButton
						idleLabel={tradingCopy.redeemShares}
						pendingLabel={tradingCopy.redeemingShares}
						onClick={onRedeemShares}
						pending={tradingActiveAction === 'redeemShares'}
						tone='secondary'
						availability={{ disabled: !isOnActiveAppChain || !redeemSharesEnabled || redeemSharesGuardMessage !== undefined, reason: getModalActionReason(redeemSharesEnabled, redeemSharesGuardMessage) }}
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
