import * as commonCopy from '../../../copy/common.js'
import * as tradingCopy from '../../../copy/trading.js'
import * as transactionReviewCopy from '../../../copy/transactionReview.js'
import { useEffect, useState } from 'preact/hooks'
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
import { TransactionUniverseValue } from '../../universes/components/TransactionUniverseValue.js'
import { formatCurrencyInputBalance } from '../../../lib/formatters.js'
import { tryParseBigIntListInput } from '../../../lib/inputs.js'
import { isMainnetChain } from '../../../lib/network.js'
import { getReportingOutcomeLabel, REPORTING_OUTCOME_DROPDOWN_OPTIONS } from '../../reporting/lib/reporting.js'
import { deriveSecurityPoolLifecycleState, evaluateSecurityPoolState } from '../../security-pools/lib/securityPoolState.js'
import {
	getDefaultShareMigrationTargetOutcomeIndexes,
	getRemainingMintCapacity,
	getSelectedOutcomeShareBalance,
	getTradingMigrateSharesGuardMessage,
	getTradingMintGuardMessage,
	getTradingRedeemCompleteSetGuardMessage,
	convertCollateralAmountToShareAmount,
	convertShareAmountToCollateralAmount,
	getTradingRedeemSharesGuardMessage,
	hasUndefinedCompleteSetExchangeRate,
	hasRepBackedPoolWithNoActiveAllowance,
	NEED_MATCHING_COMPLETE_SET_SHARES_MESSAGE,
	NO_MINT_CAPACITY_NO_ACTIVE_ALLOWANCE_MESSAGE,
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
	const mintAmount = tryParseTradingAmountInput(tradingForm.completeSetAmount)
	const mintedShareAmount = mintAmount === undefined ? undefined : convertCollateralAmountToShareAmount(mintAmount, selectedPool?.completeSetCollateralAmount, selectedPool?.shareTokenSupply)
	const resultingEthBalance = mintAmount === undefined || accountState.ethBalance === undefined || mintAmount > accountState.ethBalance ? undefined : accountState.ethBalance - mintAmount
	const redeemAmount = tryParseTradingAmountInput(tradingForm.redeemAmount)
	const redeemShareAmount = redeemAmount === undefined ? undefined : convertCollateralAmountToShareAmount(redeemAmount, selectedPool?.completeSetCollateralAmount, selectedPool?.shareTokenSupply)
	const resultingRedeemEthBalance = redeemAmount === undefined || accountState.ethBalance === undefined ? undefined : accountState.ethBalance + redeemAmount
	const resolvedWinningShareBalance = selectedPool === undefined || selectedPool.questionOutcome === 'none' ? undefined : getSelectedOutcomeShareBalance(shareBalances, selectedPool.questionOutcome)
	const resolvedWinningPayout = convertShareAmountToCollateralAmount(resolvedWinningShareBalance, selectedPool?.completeSetCollateralAmount, selectedPool?.shareTokenSupply)
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
			if (!isMainnet) return commonCopy.mainnetRequiredReason
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
			if (!isMainnet) return commonCopy.mainnetRequiredReason
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
			if (!isMainnet) return commonCopy.mainnetRequiredReason
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
				if (!isMainnet) return commonCopy.mainnetRequiredReason
				if (selectedPool?.questionOutcome === 'none') return tradingCopy.poolResolutionRequired

				return undefined
			})()
	const effectiveMintLauncherBlocker = mintLauncherBlocker ?? (mintEnabled ? undefined : tradingCopy.formatActionUnavailableReason(tradingCopy.mintCompleteSetsActionLabel))
	const effectiveRedeemCompleteSetsLauncherBlocker = redeemCompleteSetsLauncherBlocker ?? (redeemCompleteSetsEnabled ? undefined : tradingCopy.formatActionUnavailableReason(tradingCopy.redeemCompleteSetsActionLabel))
	const effectiveMigrateSharesLauncherBlocker = migrateSharesLauncherBlocker ?? (migrateSharesEnabled ? undefined : tradingCopy.formatActionUnavailableReason(tradingCopy.migrateForkedShares))
	const effectiveRedeemSharesLauncherBlocker = redeemSharesLauncherBlocker ?? (redeemSharesEnabled ? undefined : tradingCopy.formatActionUnavailableReason(tradingCopy.redeemSharesActionLabel))
	const getModalActionReason = (actionEnabled: boolean, guardMessage: string | undefined) => {
		if (!isMainnet) return commonCopy.mainnetRequiredReason
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
					{ label: commonCopy.securityPoolAddress, value: <AddressValue address={selectedPool.securityPoolAddress} /> },
					{ label: commonCopy.universe, value: <TransactionUniverseValue universeId={selectedPool.universeId} /> },
					{ label: commonCopy.outcome, value: outcome },
				]
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

			<OperationModal context={getTransactionContext('Complete set · Yes + No + Invalid')} description={tradingCopy.completeSetMintReviewDetail} isOpen={activeModal === 'mint'} onClose={() => setActiveModal(undefined)} title={tradingCopy.mintCompleteSets}>
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
				<TransactionReview
					primary={[
						{
							label: transactionReviewCopy.youPay,
							value: mintAmount === undefined ? transactionReviewCopy.amountUnavailable : <CurrencyValue value={mintAmount} suffix={commonCopy.eth} />,
						},
						{
							label: tradingCopy.estimatedSharesReceived,
							value:
								mintedShareAmount === undefined ? (
									transactionReviewCopy.amountUnavailable
								) : (
									<span>
										{commonCopy.yes}
										{' + '}
										<CurrencyValue value={mintedShareAmount} />
										{' · '}
										{commonCopy.no}
										{' + '}
										<CurrencyValue value={mintedShareAmount} />
										{' · '}
										{commonCopy.invalid}
										{' + '}
										<CurrencyValue value={mintedShareAmount} />
									</span>
								),
						},
					]}
					details={[
						{ label: tradingCopy.retentionFeeAtExecution, value: tradingCopy.retentionFeeEstimateDetail },
						{ label: transactionReviewCopy.resultingEthBalance, value: <CurrencyValue value={resultingEthBalance} suffix={commonCopy.eth} /> },
					]}
					risks={[tradingCopy.mintBalanceRisk]}
					technicalDetails={[
						{ label: transactionReviewCopy.contract, value: selectedPool === undefined ? commonCopy.unavailable : <AddressValue address={selectedPool.securityPoolAddress} /> },
						{ label: transactionReviewCopy.network, value: <TransactionNetworkValue /> },
					]}
				/>
				<div className='actions'>
					<TransactionActionButton
						idleLabel={tradingCopy.mintCompleteSets}
						pendingLabel={tradingCopy.mintingCompleteSets}
						onClick={onCreateCompleteSet}
						pending={tradingActiveAction === 'createCompleteSet'}
						availability={{ disabled: !isMainnet || !mintEnabled || mintGuardMessage !== undefined, reason: getModalActionReason(mintEnabled, mintGuardMessage) }}
					/>
				</div>
			</OperationModal>

			<OperationModal context={getTransactionContext('Complete set · Yes + No + Invalid')} description={tradingCopy.redeemCompleteSetsHelpText} isOpen={activeModal === 'redeem-complete-sets'} onClose={() => setActiveModal(undefined)} title={tradingCopy.redeemCompleteSets}>
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
								redeemShareAmount === undefined ? (
									transactionReviewCopy.amountUnavailable
								) : (
									<span>
										{tradingCopy.matchingOutcomeShares}: <CurrencyValue value={redeemShareAmount} />
									</span>
								),
						},
						{ label: tradingCopy.estimatedEthReceived, value: <CurrencyValue value={redeemAmount} suffix={commonCopy.eth} /> },
					]}
					details={[
						{ label: tradingCopy.retentionFeeAtExecution, value: tradingCopy.retentionFeeEstimateDetail },
						{ label: tradingCopy.estimatedResultingEthBalance, value: <CurrencyValue value={resultingRedeemEthBalance} suffix={commonCopy.eth} /> },
					]}
					risks={[tradingCopy.redeemCompleteSetRisk]}
					technicalDetails={[
						{ label: transactionReviewCopy.contract, value: selectedPool === undefined ? commonCopy.unavailable : <AddressValue address={selectedPool.securityPoolAddress} /> },
						{ label: transactionReviewCopy.network, value: <TransactionNetworkValue /> },
					]}
				/>
				<div className='actions'>
					<TransactionActionButton
						idleLabel={tradingCopy.redeemCompleteSets}
						pendingLabel={tradingCopy.redeemingCompleteSets}
						onClick={onRedeemCompleteSet}
						pending={tradingActiveAction === 'redeemCompleteSet'}
						tone='secondary'
						availability={{ disabled: !isMainnet || !redeemCompleteSetsEnabled || redeemCompleteSetGuardMessage !== undefined, reason: getModalActionReason(redeemCompleteSetsEnabled, redeemCompleteSetGuardMessage) }}
					/>
				</div>
			</OperationModal>

			<OperationModal context={getTransactionContext(getReportingOutcomeLabel(tradingForm.selectedShareOutcome))} description={tradingCopy.shareMigrationReviewDetail} isOpen={activeModal === 'migrate-shares'} onClose={() => setActiveModal(undefined)} title={tradingCopy.migrateForkedSharesTitle}>
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
					technicalDetails={[
						{ label: transactionReviewCopy.protocolFee, value: transactionReviewCopy.noProtocolFee },
						{ label: transactionReviewCopy.contract, value: selectedPool === undefined ? commonCopy.unavailable : <AddressValue address={selectedPool.securityPoolAddress} /> },
						{ label: transactionReviewCopy.network, value: <TransactionNetworkValue /> },
					]}
				/>
				<div className='actions'>
					<TransactionActionButton
						idleLabel={tradingCopy.migrateShares}
						pendingLabel={tradingCopy.migratingShares}
						onClick={onMigrateShares}
						pending={tradingActiveAction === 'migrateShares'}
						tone='secondary'
						availability={{ disabled: !isMainnet || !migrateSharesEnabled || migrateSharesGuardMessage !== undefined, reason: getModalActionReason(migrateSharesEnabled, migrateSharesGuardMessage) }}
					/>
				</div>
			</OperationModal>

			<OperationModal
				context={getTransactionContext(selectedPool?.questionOutcome === undefined || selectedPool.questionOutcome === 'none' ? commonCopy.unavailable : getReportingOutcomeLabel(selectedPool.questionOutcome))}
				description={tradingCopy.winningShareRedemptionDescription}
				isOpen={activeModal === 'redeem-shares'}
				onClose={() => setActiveModal(undefined)}
				title={tradingCopy.redeemResolvedShares}
			>
				<TransactionReview
					primary={[
						{ label: tradingCopy.winningShares, value: <CurrencyValue value={resolvedWinningShareBalance} /> },
						{ label: tradingCopy.estimatedEthReceived, value: <CurrencyValue value={resolvedWinningPayout} suffix={commonCopy.eth} /> },
					]}
					details={[
						{ label: tradingCopy.retentionFeeAtExecution, value: tradingCopy.retentionFeeEstimateDetail },
						{ label: tradingCopy.estimatedResultingEthBalance, value: <CurrencyValue value={resolvedWinningPayout === undefined || accountState.ethBalance === undefined ? undefined : accountState.ethBalance + resolvedWinningPayout} suffix={commonCopy.eth} /> },
					]}
					risks={[tradingCopy.resolvedShareRisk]}
					technicalDetails={[
						{ label: transactionReviewCopy.contract, value: selectedPool === undefined ? commonCopy.unavailable : <AddressValue address={selectedPool.securityPoolAddress} /> },
						{ label: transactionReviewCopy.network, value: <TransactionNetworkValue /> },
					]}
				/>
				<div className='actions'>
					<TransactionActionButton
						idleLabel={tradingCopy.redeemShares}
						pendingLabel={tradingCopy.redeemingShares}
						onClick={onRedeemShares}
						pending={tradingActiveAction === 'redeemShares'}
						tone='secondary'
						availability={{ disabled: !isMainnet || !redeemSharesEnabled || redeemSharesGuardMessage !== undefined, reason: getModalActionReason(redeemSharesEnabled, redeemSharesGuardMessage) }}
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
