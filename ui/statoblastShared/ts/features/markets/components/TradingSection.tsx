import { questionContractAddress } from '../../../copy/questionPage.js'
import * as collateralCopy from '../../../copy/collateral.js'
import { TokenApprovalControl } from '@zoltar/ui-core-shared/components/TokenApprovalControl.js'
import { UserMessage } from '@zoltar/ui-core-shared/components/UserMessage.js'
import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js'
import * as tradingCopy from '../../../copy/trading.js'
import { continueInWallet } from '../../../copy/statoblastShell.js'
import { useEffect, useId, useRef, useState } from 'preact/hooks'
import { AddressValue } from '@zoltar/ui-core-shared/components/AddressValue.js'
import { CurrencyValue } from '@zoltar/ui-core-shared/components/CurrencyValue.js'
import { EnumDropdown } from '@zoltar/ui-core-shared/components/EnumDropdown.js'
import { EmptyState } from '@zoltar/ui-core-shared/components/EmptyState.js'
import { ErrorNotice } from '@zoltar/ui-core-shared/components/ErrorNotice.js'
import { AmountField } from '@zoltar/ui-core-shared/components/AmountField.js'
import { MetricGrid } from '@zoltar/ui-core-shared/components/MetricGrid.js'
import { MetricField } from '@zoltar/ui-core-shared/components/MetricField.js'
import { ShareMintAmountField } from './ShareMintAmountField.js'
import { ShareMintGlyph, ShareMintPreview } from './ShareMintPreview.js'
import { ShareActionForm, ShareActionTabs, ShareActionCards, type ShareAction } from './ShareActionForms.js'
import { RankedBarList } from '@zoltar/ui-core-shared/components/RankedBarList.js'
import { RouteWorkflowPanel } from '@zoltar/ui-core-shared/components/RouteWorkflowPanel.js'
import { SectionBlock } from '@zoltar/ui-core-shared/components/SectionBlock.js'
import { ShareMigrationTargetsSection } from '../../universes/components/ShareMigrationTargetsSection.js'
import { TransactionActionButton } from '@zoltar/ui-core-shared/components/TransactionActionButton.js'
import { useOldActionDataNotice } from '../../useStatoblastPageRefresh.js'
import { useChainTimestamp } from '@zoltar/ui-core-shared/wallet/chainTimestamp.js'
import { tryParseBigIntListInput } from '@zoltar/ui-core-shared/forms/inputs.js'
import { getWrongNetworkReason, isActiveAppChain } from '@zoltar/ui-core-shared/wallet/network.js'
import { getActiveAppChainWalletBlocker, withWalletBlocker } from '@zoltar/ui-core-shared/transactions/actionGuards.js'
import { getReportingOutcomeLabel, REPORTING_OUTCOME_DROPDOWN_OPTIONS } from '../../reporting/lib/reporting.js'
import { deriveQuestionLedgerLifecycleState, evaluateQuestionLedgerState } from '../../question-ledgers/lib/questionLedgerState.js'
import { isMintingPausedByEscalation } from '../../question-ledgers/lib/poolLifecycle.js'
import {
	estimateMintCheckpoint,
	getDefaultShareMigrationTargetOutcomeIndexes,
	getRemainingMintCapacity,
	getMaximumMintAmount,
	getSelectedOutcomeShareBalance,
	getShareSettlementBalances,
	getTradingMigrateSharesGuardMessage,
	getTradingMintGuardMessage,
	getTradingRedeemCompleteSetGuardMessage,
	getTradingRedeemSharesGuardMessage,
	convertAttoSharesToSettlementCollateralAttoEth,
	hasUndefinedCompleteSetExchangeRate,
	hasRepBackedPoolWithNoActiveCapacityOwnership,
	NEED_MATCHING_COMPLETE_SET_SHARES_MESSAGE,
	NO_MINT_CAPACITY_NO_ACTIVE_CAPACITY_OWNERSHIP_MESSAGE,
	UNDEFINED_COMPLETE_SET_EXCHANGE_RATE_MESSAGE,
	getPoolMintingCapacityAttoEth,
	getMintingQuestionEndReason,
	hasShares,
	MINTING_PAUSED_DURING_DISPUTE_MESSAGE,
	parseCompleteSetAmountInput,
} from '../lib/trading.js'
import { ETH_GAS_RESERVE_ATTO_ETH, getSpendableEthBalance } from '@zoltar/ui-core-shared/lib/ethGasReserve.js'
import { formatAmountDisplay, formatCurrencyBalanceWithUnit } from '@zoltar/ui-core-shared/lib/formatters.js'
import type { ReportingOutcomeKey } from '@zoltar/ui-core-shared/types/contracts.js'
import type { TradingSectionProps } from '../../types.js'
export function TradingSection({
	accountState,
	actionDataReadAt,
	embedInCard = false,
	loadingTradingForkUniverse,
	loadingTradingDetails,
	collateralFunding,
	mintLimits,
	onCreateCompleteSet,
	onMigrateShares,
	onRedeemCompleteSet,
	onRedeemShares,
	onTradingFormChange,
	poolState,
	tradingDetails,
	selectedPool,
	requestedSharesAction,
	savedHoldings,
	tradingActiveAction,
	tradingError,
	tradingForm,
	tradingForkUniverse,
	tradingResult,
}: TradingSectionProps) {
	const collateralDecimals = collateralFunding?.collateral?.decimals ?? 18
	const collateralSymbol = collateralFunding?.collateral?.symbol ?? collateralCopy.fallback
	const [activeModal, setActiveModal] = useState<ShareAction>()
	const id = useId()
	const inlineId = embedInCard ? id : undefined
	const oldActionData = useOldActionDataNotice(embedInCard || activeModal !== undefined ? actionDataReadAt : undefined)
	const handledSharesAction = useRef<string>()
	const currentTimestamp = useChainTimestamp()
	const isOnActiveAppChain = isActiveAppChain(accountState.chainId)
	const hasSelectedPool = selectedPool !== undefined
	const poolUniverseHasForked = selectedPool?.universeHasForked === true || tradingForkUniverse?.hasForked === true
	const resolvedPoolState =
		poolState ??
		evaluateQuestionLedgerState({
			lifecycleState: deriveQuestionLedgerLifecycleState({
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
	const loadingShareValues = loadingTradingDetails && tradingDetails === undefined
	const maxRedeemableCompleteSetsAttoShares = tradingDetails?.maxRedeemableCompleteSetsAttoShares
	const displayMaxRedeemableCompleteSets = convertAttoSharesToSettlementCollateralAttoEth(maxRedeemableCompleteSetsAttoShares, selectedPool?.settlementCollateralAttoEth, selectedPool?.shareTokenSupplyAttoShares)
	const recoveryRep = (shares: bigint | undefined) => {
		if (shares === undefined || selectedPool === undefined) return undefined
		return selectedPool.shareTokenSupplyAttoShares === 0n ? 0n : (shares * (selectedPool.settlementRecoveryAttoRep ?? 0n)) / selectedPool.shareTokenSupplyAttoShares
	}
	const displayShareBalances = getShareSettlementBalances(shareBalances, selectedPool?.settlementCollateralAttoEth, selectedPool?.shareTokenSupplyAttoShares)
	// Once balances load and every one is zero, a single line replaces the empty sets figure and three empty bars.
	const holdsNoShares = shareBalances !== undefined && !hasShares(shareBalances)
	const outcomeBacking = (outcome: 'yes' | 'no' | 'invalid') => {
		if (displayShareBalances === undefined) return undefined
		return selectedPool?.questionOutcome === 'none' || selectedPool?.questionOutcome === outcome ? displayShareBalances[outcome] : 0n
	}
	const selectedTargetOutcomeIndexes = tryParseBigIntListInput(tradingForm.targetOutcomeIndexes) ?? []
	const selectedTargetOutcomeIndexSet = new Set(selectedTargetOutcomeIndexes.map(value => value.toString()))
	const mintingCapacityAttoEth = selectedPool === undefined ? 0n : getPoolMintingCapacityAttoEth(selectedPool)
	const mintingPausedByEscalation = selectedPool !== undefined && isMintingPausedByEscalation(selectedPool, resolvedPoolState.lifecycleState)
	const mintCheckpoint = estimateMintCheckpoint({
		centralSettlement: selectedPool?.feeAccrualState?.centralSettlement,
		centralCheckpointTimestamp: selectedPool?.feeAccrualState?.centralCheckpointTimestamp,
		linearFee: selectedPool?.feeAccrualState?.linearFee,
		currentTimestamp,
		feeEndTimestamp: selectedPool?.feeAccrualState?.feeEndTimestamp,
		lastFeeCheckpointNativeTime: selectedPool?.feeAccrualState?.lastFeeCheckpointNativeTime,
		settlementCollateralAttoEth: selectedPool?.settlementCollateralAttoEth,
	})
	const estimatedSettlementCollateralAttoEth = mintCheckpoint?.settlementCollateralAfterFeesAttoEth ?? selectedPool?.settlementCollateralAttoEth
	const usesSharedBacking = selectedPool?.feeAccrualState?.linearFee !== undefined
	const remainingMintCapacity = getRemainingMintCapacity(mintingCapacityAttoEth, estimatedSettlementCollateralAttoEth, selectedPool?.shareTokenSupplyAttoShares)
	const maximumMintAmount = usesSharedBacking ? undefined : getMaximumMintAmount(accountState.ethBalanceAttoEth, remainingMintCapacity)
	const mintGuardMessage = getTradingMintGuardMessage({
		currentTimestamp,
		questionEndTime: selectedPool?.marketDetails.endTime,
		accountAddress: accountState.address,
		usesSharedBacking,
		collateral: collateralFunding?.collateral,
		escalationGameActive: mintingPausedByEscalation,
		settlementCollateralAttoEth: estimatedSettlementCollateralAttoEth,
		ethBalanceAttoEth: accountState.ethBalanceAttoEth,
		mintingCapacityAttoEth,
		hasSelectedPool,
		isOnActiveAppChain,
		mintAmountInput: tradingForm.completeSetAmount,
		shareTokenSupplyAttoShares: selectedPool?.shareTokenSupplyAttoShares,
		totalPoolHeldAttoRep: selectedPool?.totalPoolHeldAttoRep,
	})
	const redeemCollateralReason = collateralFunding !== undefined && collateralFunding.collateral === undefined ? (collateralFunding.error ?? tradingCopy.redeemCollateralLoading) : undefined
	const redeemCompleteSetGuardMessage = getTradingRedeemCompleteSetGuardMessage({
		accountAddress: accountState.address,
		hasSelectedPool,
		isOnActiveAppChain,
		loadingTradingDetails,
		redeemAmountInput: tradingForm.redeemAmount,
		shareDecimals: collateralDecimals,
		shareBalances,
	})
	const migrateSharesGuardMessage = getTradingMigrateSharesGuardMessage({
		accountAddress: accountState.address,
		hasSelectedPool,
		isOnActiveAppChain,
		loadingTradingForkUniverse,
		loadingTradingDetails,
		selectedShareOutcome: tradingForm.selectedShareOutcome,
		shareBalances,
		shareMigrationTargets: tradingDetails?.shareMigrationTargets,
		targetOutcomeIndexesInput: tradingForm.targetOutcomeIndexes,
		tradingForkUniverse,
	})
	const selectedOutcomeBalance = getSelectedOutcomeShareBalance(shareBalances, tradingForm.selectedShareOutcome)
	const shareOutcomeOptions = REPORTING_OUTCOME_DROPDOWN_OPTIONS.map(option => {
		const balance = getSelectedOutcomeShareBalance(shareBalances, option.value)
		return balance === undefined ? option : { ...option, label: tradingCopy.formatShareOutcomeOption(option.label, formatAmountDisplay(balance, { units: collateralDecimals })) }
	})
	const mintLauncherBlocker = (() => {
		if (!hasSelectedPool) return tradingCopy.completeSetMintPoolRequiredReason
		if (accountState.address === undefined) return tradingCopy.completeSetMintWalletRequiredReason
		if (!isOnActiveAppChain) return getWrongNetworkReason()
		const questionEndReason = getMintingQuestionEndReason(currentTimestamp, selectedPool?.marketDetails.endTime)
		if (questionEndReason !== undefined) return questionEndReason
		if (mintingPausedByEscalation) return MINTING_PAUSED_DURING_DISPUTE_MESSAGE
		// A pool stage that closes minting explains it before any capacity figure, which a stale escalation flag can zero.
		if (!mintEnabled) return tradingCopy.actionUnavailableReason
		if (usesSharedBacking) return undefined
		if (remainingMintCapacity === undefined) return tradingCopy.mintCapacityUnavailable
		if (hasUndefinedCompleteSetExchangeRate(selectedPool?.settlementCollateralAttoEth, selectedPool?.shareTokenSupplyAttoShares) === true) return UNDEFINED_COMPLETE_SET_EXCHANGE_RATE_MESSAGE
		if (remainingMintCapacity === 0n) {
			if (hasRepBackedPoolWithNoActiveCapacityOwnership(selectedPool?.totalPoolHeldAttoRep, selectedPool?.feeEligibleUnderwritingLimitAttoEth)) return NO_MINT_CAPACITY_NO_ACTIVE_CAPACITY_OWNERSHIP_MESSAGE
			return tradingCopy.mintCapacityEmpty
		}
		return undefined
	})()
	const redeemCompleteSetsLauncherBlocker = (() => {
		if (!hasSelectedPool) return tradingCopy.completeSetBurnPoolRequiredReason
		if (accountState.address === undefined) return tradingCopy.completeSetBurnWalletRequiredReason

		return (() => {
			if (!isOnActiveAppChain) return getWrongNetworkReason()
			if (loadingTradingDetails) return tradingCopy.loadingWalletShareBalances

			return (() => {
				if (maxRedeemableCompleteSetsAttoShares === undefined) return tradingCopy.shareBalancesUnavailable
				if (maxRedeemableCompleteSetsAttoShares === 0n) return NEED_MATCHING_COMPLETE_SET_SHARES_MESSAGE

				return undefined
			})()
		})()
	})()
	const migrateSharesLauncherBlocker = (() => {
		if (!hasSelectedPool) return tradingCopy.shareMigrationPoolRequiredReason
		if (accountState.address === undefined) return tradingCopy.shareMigrationWalletRequiredReason

		return (() => {
			if (!isOnActiveAppChain) return getWrongNetworkReason()
			if (loadingTradingForkUniverse) return tradingCopy.loadingForkTargetUniverses

			return (() => {
				if (tradingForkUniverse?.hasForked === false || (tradingForkUniverse === undefined && !poolUniverseHasForked)) return tradingCopy.shareMigrationRequiresFork
				if (tradingForkUniverse === undefined) return tradingCopy.forkTargetsRefreshRequired
				if (loadingTradingDetails) return tradingCopy.loadingWalletShareBalances

				return (() => {
					if (selectedOutcomeBalance === undefined) return tradingCopy.shareBalancesUnavailable
					if (selectedOutcomeBalance === 0n) return tradingCopy.formatNoSharesAvailableToMigrateReason(getReportingOutcomeLabel(tradingForm.selectedShareOutcome))

					return undefined
				})()
			})()
		})()
	})()
	const winningOutcome: ReportingOutcomeKey | undefined = selectedPool === undefined || selectedPool.questionOutcome === 'none' ? undefined : selectedPool.questionOutcome
	const winningOutcomeLabel = winningOutcome === undefined ? undefined : getReportingOutcomeLabel(winningOutcome)
	const winningAttoShares = winningOutcome === undefined ? undefined : getSelectedOutcomeShareBalance(shareBalances, winningOutcome)
	const expectedRedemptionPayoutAttoEth = convertAttoSharesToSettlementCollateralAttoEth(winningAttoShares, selectedPool?.settlementCollateralAttoEth, selectedPool?.shareTokenSupplyAttoShares)
	const redeemSharesLauncherBlocker = getTradingRedeemSharesGuardMessage({ accountAddress: accountState.address, hasSelectedPool, isOnActiveAppChain, questionOutcome: selectedPool?.questionOutcome, shareBalances: loadingTradingDetails ? undefined : shareBalances })

	const effectiveRedeemCompleteSetsLauncherBlocker = redeemCompleteSetsLauncherBlocker ?? (redeemCompleteSetsEnabled ? undefined : tradingCopy.actionUnavailableReason)
	const effectiveMigrateSharesLauncherBlocker = migrateSharesLauncherBlocker ?? (migrateSharesEnabled ? undefined : tradingCopy.actionUnavailableReason)
	const effectiveRedeemSharesLauncherBlocker = redeemSharesLauncherBlocker ?? (redeemSharesEnabled ? undefined : tradingCopy.actionUnavailableReason)
	const getModalActionReason = (actionEnabled: boolean, guardMessage: string | undefined) => {
		if (!isOnActiveAppChain) return getWrongNetworkReason()
		if (!actionEnabled) return tradingCopy.actionUnavailableReason
		return guardMessage
	}
	// For a selected pool the trading guards check the wallet first, so a blocking wallet is the reason whenever the pool action is enabled.
	const walletBlocker = getActiveAppChainWalletBlocker({ accountAddress: accountState.address, isOnActiveAppChain })
	const getModalActionAvailability = (actionEnabled: boolean, guardMessage: string | undefined, validAmount = true) =>
		withWalletBlocker({ disabled: !isOnActiveAppChain || !actionEnabled || !validAmount || guardMessage !== undefined, reason: getModalActionReason(actionEnabled, guardMessage) }, !isOnActiveAppChain || (actionEnabled && hasSelectedPool) ? walletBlocker : undefined)
	const closeActiveModal = () => setActiveModal(undefined)
	const shareMigrationSelectionDisabled = poolUniverseHasForked !== true
	const setAllTargetOutcomeIndexes = () => {
		onTradingFormChange({ targetOutcomeIndexes: getDefaultShareMigrationTargetOutcomeIndexes({ selectedShareOutcome: tradingForm.selectedShareOutcome, shareBalances, shareMigrationTargets: tradingDetails?.shareMigrationTargets, tradingForkUniverse }) })
	}
	const clearTargetOutcomeIndexes = () => {
		onTradingFormChange({ targetOutcomeIndexes: '' })
	}
	const getTransactionContext = (outcome: string) =>
		selectedPool === undefined
			? []
			: [
					{ label: commonCopy.question, value: selectedPool.marketDetails.title },
					{ identityKey: 'outcome', label: commonCopy.outcome, value: outcome },
					{ identityKey: 'security-pool', label: questionContractAddress, value: <AddressValue longAbbreviation address={selectedPool.questionLedgerAddress} /> },
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
	const renderShareMetricValue = (value: bigint | undefined, backing?: bigint) => (
		<>
			<CurrencyValue exactWhenRoundedToZero loading={loadingShareValues} value={value} units={collateralDecimals} />
			{backing === undefined ? undefined : (
				<>
					{' '}
					(<CurrencyValue exactWhenRoundedToZero decimals={4} value={backing} suffix={collateralSymbol} units={collateralDecimals} />)
				</>
			)}
		</>
	)
	// Both redemption dialogs show the shares being redeemed beside the collateral and recovery REP they pay out.
	const renderPayoutMetrics = ({ attoShares, collateralLabel, collateralPayout, repLabel, sharesLabel, sharesUnit }: { attoShares: bigint | undefined; collateralLabel: string; collateralPayout: bigint | undefined; repLabel: string; sharesLabel: string; sharesUnit: string }) => (
		<MetricGrid>
			<MetricField label={sharesLabel}>
				<CurrencyValue exactWhenRoundedToZero loading={loadingShareValues} value={attoShares} suffix={sharesUnit} units={collateralDecimals} />
			</MetricField>
			<MetricField label={collateralLabel}>
				<CurrencyValue exactWhenRoundedToZero loading={loadingShareValues} decimals={4} value={collateralPayout} suffix={collateralSymbol} units={collateralDecimals} />
			</MetricField>
			<MetricField label={repLabel}>
				<CurrencyValue exactWhenRoundedToZero loading={loadingShareValues} value={recoveryRep(attoShares)} suffix={commonCopy.rep} />
			</MetricField>
		</MetricGrid>
	)
	const shareActions = [
		{ value: 'mint', reason: mintLauncherBlocker },
		{ value: 'redeem-complete-sets', reason: effectiveRedeemCompleteSetsLauncherBlocker },
		{ value: 'migrate-shares', reason: effectiveMigrateSharesLauncherBlocker },
		{ value: 'redeem-shares', reason: effectiveRedeemSharesLauncherBlocker },
	] satisfies { value: ShareAction; reason: string | undefined }[]
	const selectedAction = activeModal ?? (embedInCard ? shareActions.find(action => action.reason === undefined)?.value : undefined)
	useEffect(() => {
		if (requestedSharesAction === undefined) {
			handledSharesAction.current = undefined
			return
		}
		if (!isOnActiveAppChain || accountState.address === undefined || tradingDetails === undefined || loadingTradingDetails || loadingTradingForkUniverse || selectedPool === undefined) return
		const key = `${selectedPool.questionLedgerAddress}:${requestedSharesAction}`
		if (handledSharesAction.current === key) return
		handledSharesAction.current = key
		if (requestedSharesAction === 'mint' && mintLauncherBlocker === undefined) setActiveModal('mint')
		if (requestedSharesAction === 'redeem' && effectiveRedeemSharesLauncherBlocker === undefined) setActiveModal('redeem-shares')
	}, [requestedSharesAction, accountState.address, isOnActiveAppChain, selectedPool?.questionLedgerAddress, tradingDetails, loadingTradingDetails, loadingTradingForkUniverse, mintLauncherBlocker, effectiveRedeemSharesLauncherBlocker])
	const forms = (
		<>
			<ShareActionForm
				closeOnSuccessKey={tradingResult?.action === 'createCompleteSet' ? tradingResult.hash : undefined}
				context={getTransactionContext('Complete set · Yes + No + Invalid')}
				description={oldActionData}
				finalActionLabel={continueInWallet}
				action='mint'
				inlineId={inlineId}
				isOpen={selectedAction === 'mint'}
				onClose={closeActiveModal}
				title={tradingCopy.mintCompleteSets}
			>
				{!embedInCard && (
					<MetricGrid>
						<MetricField label={collateralCopy.wallet}>
							<CurrencyValue exactWhenRoundedToZero value={collateralFunding?.collateral?.balance} suffix={collateralFunding?.collateral?.symbol ?? collateralCopy.fallback} units={collateralFunding?.collateral?.decimals ?? 0} />
						</MetricField>
						<MetricField label={tradingCopy.availableToMint}>{usesSharedBacking ? tradingCopy.sharedPoolCapacityAtReview : <CurrencyValue exactWhenRoundedToZero loading={loadingTradingDetails} value={maximumMintAmount} suffix={collateralSymbol} units={collateralDecimals} />}</MetricField>
					</MetricGrid>
				)}
				{embedInCard && <ShareMintGlyph funding={collateralFunding} />}
				<ShareMintAmountField
					funding={collateralFunding}
					sharedBacking={usesSharedBacking && embedInCard}
					hint={
						maximumMintAmount !== undefined && maximumMintAmount > 0n && accountState.ethBalanceAttoEth !== undefined && maximumMintAmount === getSpendableEthBalance(accountState.ethBalanceAttoEth)
							? tradingCopy.formatMaxKeepsGasReserveHint(formatCurrencyBalanceWithUnit(ETH_GAS_RESERVE_ATTO_ETH, commonCopy.eth))
							: undefined
					}
					maximumMintAmount={maximumMintAmount}
					onChange={completeSetAmount => onTradingFormChange({ completeSetAmount })}
					value={tradingForm.completeSetAmount}
				/>
				{embedInCard && <ShareMintPreview funding={collateralFunding} limits={mintLimits} balances={shareBalances} form={tradingForm} onChange={onTradingFormChange} />}
				{!embedInCard && usesSharedBacking && <UserMessage className='detail' detail={tradingCopy.sharedPoolPurchaseDetail} />}
				<TokenApprovalControl
					actionLabel={tradingCopy.mintCompleteSets}
					amountPrecision={embedInCard ? 'exact' : 'rounded'}
					allowanceError={collateralFunding?.error}
					allowanceLoading={collateralFunding?.loading ?? true}
					approvedAmount={collateralFunding?.collateral?.allowance}
					guardMessage={mintGuardMessage}
					disabled={tradingActiveAction !== undefined || collateralFunding?.approvalActive === true}
					onApprove={amount => {
						if (amount !== undefined) void collateralFunding?.approve(amount)
					}}
					pending={collateralFunding?.pending ?? false}
					pendingLabel={commonCopy.formatApprovingToken(collateralSymbol)}
					requiredAmount={collateralFunding?.requiredCollateral}
					resetKey={`${selectedPool?.questionLedgerAddress}:${collateralFunding?.requiredCollateral}`}
					tokenSymbol={collateralFunding?.collateral?.symbol ?? collateralCopy.fallback}
					tokenUnits={collateralFunding?.collateral?.decimals ?? 18}
				/>
				{collateralFunding?.recoveryApplicable && (
					<>
						<UserMessage detail={collateralCopy.recoveryContributionHint} />
						<MetricGrid>
							<MetricField label={collateralCopy.recoveryContribution}>
								<CurrencyValue exactWhenRoundedToZero value={collateralFunding?.recovery?.required} suffix={commonCopy.rep} />
							</MetricField>
							<MetricField label={collateralCopy.maximumRecoveryContribution}>
								<CurrencyValue precision='exact' value={collateralFunding?.recovery?.maximum} suffix={commonCopy.rep} />
							</MetricField>
						</MetricGrid>
						<TokenApprovalControl
							amountPrecision='exact'
							actionLabel={tradingCopy.mintCompleteSets}
							tokenSymbol={commonCopy.rep}
							tokenUnits={18}
							approvedAmount={collateralFunding?.recovery?.allowance}
							requiredAmount={collateralFunding?.recovery?.maximum}
							allowanceError={collateralFunding?.error}
							allowanceLoading={collateralFunding?.loading ?? true}
							guardMessage={mintGuardMessage}
							disabled={tradingActiveAction !== undefined || collateralFunding?.approvalActive === true || collateralFunding?.recovery === undefined || collateralFunding.error !== undefined}
							pending={collateralFunding?.pendingRecovery ?? false}
							pendingLabel={commonCopy.formatApprovingToken(commonCopy.rep)}
							resetKey={`${selectedPool?.questionLedgerAddress}:${collateralFunding?.recovery?.required}`}
							onApprove={amount => {
								if (amount !== undefined) void collateralFunding?.approveRecovery(amount)
							}}
						/>
					</>
				)}
				<div className='actions'>
					<TransactionActionButton
						idleLabel={tradingCopy.mintCompleteSets}
						pendingLabel={tradingCopy.mintingCompleteSets}
						onClick={onCreateCompleteSet}
						pending={tradingActiveAction === 'createCompleteSet'}
						availability={getModalActionAvailability(mintEnabled, mintGuardMessage ?? collateralFunding?.reason ?? mintLimits?.reason, (parseCompleteSetAmountInput(tradingForm.completeSetAmount, collateralDecimals) ?? 0n) > 0n)}
					/>
				</div>
			</ShareActionForm>

			<ShareActionForm
				closeOnSuccessKey={tradingResult?.action === 'redeemCompleteSet' ? tradingResult.hash : undefined}
				context={getTransactionContext('Complete set · Yes + No + Invalid')}
				description={oldActionData}
				finalActionLabel={continueInWallet}
				action='redeem-complete-sets'
				inlineId={inlineId}
				isOpen={selectedAction === 'redeem-complete-sets'}
				onClose={closeActiveModal}
				title={tradingCopy.redeemCompleteSets}
			>
				{renderPayoutMetrics({
					attoShares: maxRedeemableCompleteSetsAttoShares,
					collateralLabel: tradingCopy.availableToRedeem,
					collateralPayout: displayMaxRedeemableCompleteSets,
					repLabel: tradingCopy.availableRecoveryRep,
					sharesLabel: tradingCopy.redeemableCompleteSets,
					sharesUnit: tradingCopy.setsUnit,
				})}
				<AmountField fillMax={{ amount: maxRedeemableCompleteSetsAttoShares }} label={tradingCopy.redeemCompleteSetsAmount} onChange={redeemAmount => onTradingFormChange({ redeemAmount })} unit={tradingCopy.setsUnit} decimals={collateralDecimals} value={tradingForm.redeemAmount} />
				<UserMessage className='detail' detail={tradingCopy.redeemCompleteSetsFeeDetail} />
				<div className='actions'>
					<TransactionActionButton
						idleLabel={tradingCopy.redeemCompleteSets}
						pendingLabel={tradingCopy.redeemingCompleteSets}
						onClick={onRedeemCompleteSet}
						pending={tradingActiveAction === 'redeemCompleteSet'}
						availability={getModalActionAvailability(redeemCompleteSetsEnabled, redeemCollateralReason ?? redeemCompleteSetGuardMessage, (parseCompleteSetAmountInput(tradingForm.redeemAmount, collateralDecimals) ?? 0n) > 0n)}
					/>
				</div>
			</ShareActionForm>

			<ShareActionForm
				closeOnSuccessKey={tradingResult?.action === 'migrateShares' ? tradingResult.hash : undefined}
				context={getTransactionContext(getReportingOutcomeLabel(tradingForm.selectedShareOutcome))}
				finalActionLabel={continueInWallet}
				action='migrate-shares'
				inlineId={inlineId}
				isOpen={selectedAction === 'migrate-shares'}
				description={oldActionData}
				onClose={closeActiveModal}
				title={tradingCopy.migrateForkedShares}
			>
				<label className='field'>
					<span>{tradingCopy.shareOutcomeToMigrate}</span>
					<EnumDropdown options={shareOutcomeOptions} value={tradingForm.selectedShareOutcome} onChange={selectedShareOutcome => onTradingFormChange({ selectedShareOutcome })} disabled={shareMigrationSelectionDisabled} />
				</label>
				{selectedOutcomeBalance === undefined ? undefined : <UserMessage tone='warning' title={tradingCopy.formatMigratingShares(formatAmountDisplay(selectedOutcomeBalance, { units: collateralDecimals }), getReportingOutcomeLabel(tradingForm.selectedShareOutcome))} detail={tradingCopy.shareMigrationIrreversible} />}
				<ShareMigrationTargetsSection
					loading={loadingTradingForkUniverse}
					disabled={shareMigrationSelectionDisabled}
					forkUniverse={tradingForkUniverse}
					onClearOutcomeIndexes={clearTargetOutcomeIndexes}
					onSelectAllOutcomeIndexes={setAllTargetOutcomeIndexes}
					onToggleOutcomeIndex={toggleTargetOutcomeIndex}
					selectedOutcomeIndexes={selectedTargetOutcomeIndexes}
				/>
				<div className='actions'>
					<TransactionActionButton idleLabel={tradingCopy.migrateShares} pendingLabel={tradingCopy.migratingShares} onClick={onMigrateShares} pending={tradingActiveAction === 'migrateShares'} availability={getModalActionAvailability(migrateSharesEnabled, migrateSharesGuardMessage)} />
				</div>
			</ShareActionForm>

			<ShareActionForm
				closeOnSuccessKey={tradingResult?.action === 'redeemShares' ? tradingResult.hash : undefined}
				context={getTransactionContext(winningOutcomeLabel ?? '')}
				description={oldActionData}
				finalActionLabel={continueInWallet}
				action='redeem-shares'
				inlineId={inlineId}
				isOpen={selectedAction === 'redeem-shares'}
				onClose={closeActiveModal}
				title={tradingCopy.redeemResolvedShares}
			>
				{renderPayoutMetrics({
					attoShares: winningAttoShares,
					collateralLabel: tradingCopy.expectedCollateralPayout,
					collateralPayout: expectedRedemptionPayoutAttoEth,
					repLabel: tradingCopy.expectedRepPayout,
					sharesLabel: tradingCopy.formatWinningOutcomeShares(winningOutcomeLabel ?? ''),
					sharesUnit: tradingCopy.sharesUnit,
				})}
				<UserMessage className='detail' detail={tradingCopy.resolvedShareRedemptionFeeDetail} />
				<div className='actions'>
					<TransactionActionButton idleLabel={tradingCopy.redeemResolvedShares} pendingLabel={tradingCopy.redeemingShares} onClick={onRedeemShares} pending={tradingActiveAction === 'redeemShares'} availability={getModalActionAvailability(redeemSharesEnabled, redeemSharesLauncherBlocker)} />
				</div>
			</ShareActionForm>
		</>
	)
	const sections = (
		<>
			{/* Holdings first, then one row of share actions with their buttons aligned across the cards. */}
			<div className={selectedPool === undefined ? 'trading-workspace-layout is-single' : 'trading-workspace-layout'}>
				{selectedPool === undefined
					? undefined
					: (savedHoldings ?? (
							<SectionBlock title={tradingCopy.yourHoldings} variant='embedded'>
								{holdsNoShares ? (
									<EmptyState className='trading-holdings-empty' title={tradingCopy.noSharesHeld} />
								) : (
									<div className='trading-holdings-stage'>
										<div className='trading-holdings-hero'>
											<span className='trading-holdings-label'>{tradingCopy.redeemableCompleteSets}</span>
											<strong className='trading-holdings-value'>
												<CurrencyValue exactWhenRoundedToZero loading={loadingShareValues} value={maxRedeemableCompleteSetsAttoShares} suffix={tradingCopy.setsUnit} units={collateralDecimals} />
												{displayMaxRedeemableCompleteSets === undefined ? undefined : (
													<span className='trading-holdings-backing'>
														(<CurrencyValue exactWhenRoundedToZero decimals={4} value={displayMaxRedeemableCompleteSets} suffix={collateralSymbol} units={collateralDecimals} />)
													</span>
												)}
											</strong>
											<UserMessage className='detail' detail={tradingCopy.completeSetBalanceLimitDetail} />
										</div>
										<div className='trading-holdings-layout'>
											<RankedBarList
												className='trading-share-distribution'
												emptyMessage={tradingCopy.walletBalancesUnavailable}
												items={[
													{
														key: 'yes',
														label: commonCopy.yes,
														valueText: renderShareMetricValue(shareBalances?.yesAttoShares, outcomeBacking('yes')),
														...(shareBalances === undefined ? {} : { value: shareBalances.yesAttoShares }),
													},
													{
														key: 'no',
														label: commonCopy.no,
														valueText: renderShareMetricValue(shareBalances?.noAttoShares, outcomeBacking('no')),
														...(shareBalances === undefined ? {} : { value: shareBalances.noAttoShares }),
													},
													{
														key: 'invalid',
														label: commonCopy.invalid,
														valueText: renderShareMetricValue(shareBalances?.invalidAttoShares, outcomeBacking('invalid')),
														...(shareBalances === undefined ? {} : { value: shareBalances.invalidAttoShares }),
													},
												]}
											/>
											<UserMessage className='detail' detail={inlineId === undefined ? tradingCopy.shareBackingDetail : tradingCopy.onlyWinningOutcome} />
										</div>
									</div>
								)}
								{inlineId !== undefined && (
									<details>
										<summary>{tradingCopy.howSharesWork}</summary>
										<p>{tradingCopy.shareBasics}</p>
									</details>
								)}
							</SectionBlock>
						))}

				<SectionBlock title={inlineId === undefined ? tradingCopy.shares : tradingCopy.shareActions} variant='embedded'>
					{inlineId === undefined ? (
						<ShareActionCards actions={shareActions} onSelect={setActiveModal} walletBlocksFirst={hasSelectedPool ? { accountAddress: accountState.address, isOnActiveAppChain } : undefined} />
					) : (
						<>
							<ShareActionTabs id={inlineId} actions={shareActions} selected={selectedAction} onSelect={setActiveModal} />
							{forms}
						</>
					)}
				</SectionBlock>
			</div>

			<ErrorNotice message={tradingError} />

			{inlineId === undefined && forms}
		</>
	)
	if (embedInCard) return sections
	return <RouteWorkflowPanel title={tradingCopy.shares}>{sections}</RouteWorkflowPanel>
}
