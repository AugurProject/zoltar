import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js'
import * as marketCopy from '../../../copy/market.js'
import * as zoltarCopy from '../../../copy/zoltar.js'
import type { ComponentChildren } from 'preact'
import { useMemo } from 'preact/hooks'
import type { Address } from '@zoltar/core-shared/evm/ethereum'
import { CurrencyValue } from '@zoltar/ui-core-shared/components/CurrencyValue.js'
import { DataGrid } from '@zoltar/ui-core-shared/components/DataGrid.js'
import { ErrorNotice } from '@zoltar/ui-core-shared/components/ErrorNotice.js'
import { FormInput } from '@zoltar/ui-core-shared/components/FormInput.js'
import { MetricField } from '@zoltar/ui-core-shared/components/MetricField.js'
import { SectionBlock } from '@zoltar/ui-core-shared/components/SectionBlock.js'
import { StateHint } from '@zoltar/ui-core-shared/components/StateHint.js'
import { TokenApprovalControl } from '@zoltar/ui-core-shared/components/TokenApprovalControl.js'
import { TransactionActionButton, TransactionActionGroup } from '@zoltar/ui-core-shared/components/TransactionActionButton.js'
import { WorkflowSubsection } from '@zoltar/ui-core-shared/components/WorkflowSubsection.js'
import { WalletAssetControl } from '@zoltar/ui-core-shared/components/WalletAssetControl.js'
import { getMigrationOutcomeSplitLimit, MigrationOutcomeUniversesSection } from './MigrationOutcomeUniversesSection.js'
import type { LoadableValueState } from '@zoltar/ui-core-shared/lib/loadState.js'
import { formatCurrencyBalance, formatCurrencyInputBalance } from '@zoltar/ui-core-shared/lib/formatters.js'
import { tryParseBigIntListInput } from '@zoltar/ui-core-shared/forms/inputs.js'
import { tryParseRepAmountInput as parseMigrationAmountInput } from '@zoltar/ui-core-shared/forms/formInputs.js'
import { deriveTokenApprovalRequirement, type TokenApprovalState } from '@zoltar/ui-core-shared/transactions/tokenApproval.js'
import { getUniversePresentation } from '@zoltar/ui-core-shared/lib/userCopy.js'
import { getMigrationGuardMessage } from '../lib/zoltarMigrationGuards.js'
import type { ZoltarMigrationFormState } from '../../../types/app.js'
import type { ZoltarChildUniverseSummary, ZoltarUniverseSummary } from '@zoltar/ui-core-shared/types/contracts.js'
import { getWrongNetworkReason } from '@zoltar/ui-core-shared/wallet/network.js'

function getChildDeploymentAvailabilityReason({ accountAddress, exists, hasForked, isOnActiveAppChain }: { accountAddress: Address | undefined; exists?: boolean | undefined; hasForked: boolean; isOnActiveAppChain: boolean }) {
	if (accountAddress === undefined) return marketCopy.childDeploymentWalletRequiredReason
	if (!isOnActiveAppChain) return getWrongNetworkReason()
	if (!hasForked) return marketCopy.childUniversesNotForkedReason
	if (exists === true) return marketCopy.childUniverseDeployedReason
	return undefined
}

type ZoltarMigrationSectionProps = {
	onDeployChildUniverse: (outcomeIndex: bigint) => void
	pendingChildUniverseOutcomeIndex: bigint | undefined
	accountAddress: Address | undefined
	isOnActiveAppChain: boolean
	loadingZoltarForkAccess: boolean
	loadingZoltarUniverse: boolean
	onRetryMigrationBalances: () => void
	onMigrateInternalRep: (preparationAttoRep: bigint) => void
	onZoltarMigrationFormChange: (update: Partial<ZoltarMigrationFormState>) => void
	zoltarForkRepBalanceAttoRep: bigint | undefined
	zoltarForkApproval: TokenApprovalState
	zoltarForkActiveAction: 'approve' | 'fork' | undefined
	zoltarMigrationChildSplitAmountsAttoRep: Record<string, bigint | undefined>
	zoltarMigrationChildRepBalancesAttoRep: Record<string, bigint | undefined>
	zoltarMigrationActiveAction: 'split' | undefined
	zoltarMigrationError: string | undefined
	zoltarMigrationForm: ZoltarMigrationFormState
	zoltarMigrationPending: boolean
	zoltarMigrationPreparedRepBalanceAttoRep: bigint | undefined
	zoltarUniverse: ZoltarUniverseSummary | undefined
	zoltarUniverseState: LoadableValueState
	onApproveZoltarForkRep: (amount?: bigint) => void
}

function getMigrationAmount(value: string) {
	return parseMigrationAmountInput(value)
}

function getMigrationOutcomeIndexes(value: string) {
	return tryParseBigIntListInput(value) ?? []
}

function getMigrationAmountSource(preparedRepBalanceAttoRep: bigint | undefined, repBalanceAttoRep: bigint | undefined) {
	return (preparedRepBalanceAttoRep ?? 0n) + (repBalanceAttoRep ?? 0n)
}

function getMissingPreparationAmount(targetAmount: bigint, preparedRepBalanceAttoRep: bigint | undefined) {
	const currentPreparedBalance = preparedRepBalanceAttoRep ?? 0n
	return targetAmount > currentPreparedBalance ? targetAmount - currentPreparedBalance : 0n
}

export function ZoltarMigrationSection({
	onDeployChildUniverse,
	pendingChildUniverseOutcomeIndex,
	accountAddress,
	isOnActiveAppChain,
	loadingZoltarForkAccess,
	loadingZoltarUniverse,
	onRetryMigrationBalances,
	onMigrateInternalRep,
	onZoltarMigrationFormChange,
	zoltarForkRepBalanceAttoRep,
	zoltarForkApproval,
	zoltarForkActiveAction,
	zoltarMigrationChildSplitAmountsAttoRep,
	zoltarMigrationChildRepBalancesAttoRep,
	zoltarMigrationActiveAction,
	zoltarMigrationError,
	zoltarMigrationForm,
	zoltarMigrationPending,
	zoltarMigrationPreparedRepBalanceAttoRep,
	zoltarUniverse,
	zoltarUniverseState,
	onApproveZoltarForkRep,
}: ZoltarMigrationSectionProps) {
	const rootUniverse = zoltarUniverse
	const universeMissing = zoltarUniverseState === 'missing'
	const hasForked = rootUniverse?.hasForked === true
	const selectedOutcomeIndexes = useMemo(() => getMigrationOutcomeIndexes(zoltarMigrationForm.outcomeIndexes), [zoltarMigrationForm.outcomeIndexes])
	const selectedOutcomeIndexSet = useMemo(() => new Set(selectedOutcomeIndexes.map(index => index.toString())), [selectedOutcomeIndexes])
	const selectedChildUniverses = useMemo(() => rootUniverse?.childUniverses.filter(child => selectedOutcomeIndexSet.has(child.outcomeIndex.toString())) ?? [], [rootUniverse?.childUniverses, selectedOutcomeIndexSet])
	const heldChildUniverses = useMemo(() => rootUniverse?.childUniverses.filter(child => child.exists && (zoltarMigrationChildRepBalancesAttoRep[child.universeId.toString()] ?? 0n) > 0n) ?? [], [rootUniverse?.childUniverses, zoltarMigrationChildRepBalancesAttoRep])
	const migrationAmount = getMigrationAmount(zoltarMigrationForm.amount)
	const hasValidAmount = migrationAmount !== undefined && migrationAmount > 0n
	const isMigrationAmountInvalid = zoltarMigrationForm.amount.trim() !== '' && migrationAmount === undefined
	const splitLimit = useMemo(
		() => getMigrationOutcomeSplitLimit(rootUniverse?.childUniverses ?? [], zoltarMigrationChildSplitAmountsAttoRep, zoltarMigrationPreparedRepBalanceAttoRep, selectedOutcomeIndexSet),
		[rootUniverse?.childUniverses, selectedOutcomeIndexSet, zoltarMigrationChildSplitAmountsAttoRep, zoltarMigrationPreparedRepBalanceAttoRep],
	)
	const missingPreparationAmount = hasValidAmount && migrationAmount !== undefined ? getMissingPreparationAmount(migrationAmount, splitLimit) : 0n
	const totalAvailableAttoRep = (splitLimit ?? 0n) + (zoltarForkRepBalanceAttoRep ?? 0n)
	const amountExceedsAvailableRep = hasValidAmount && migrationAmount !== undefined && migrationAmount > totalAvailableAttoRep
	const hasEnoughRep = hasValidAmount && (missingPreparationAmount === 0n || (zoltarForkRepBalanceAttoRep !== undefined && zoltarForkRepBalanceAttoRep >= missingPreparationAmount))
	const approvalRequirement = deriveTokenApprovalRequirement(missingPreparationAmount, zoltarForkApproval.value)
	const requiresApproval = rootUniverse?.reputationTokenKind !== 'child'
	const hasSufficientAllowance = !requiresApproval || approvalRequirement.hasSufficientApproval
	const hasValidOutcomeIndexes = selectedOutcomeIndexes.length > 0
	const needsAdditionalPreparation = missingPreparationAmount > 0n
	const hasUnavailableRequiredBalance = splitLimit === undefined || (needsAdditionalPreparation && zoltarForkRepBalanceAttoRep === undefined)
	const hasUnavailableOutcomeBalance = rootUniverse?.childUniverses.some(child => child.exists && (zoltarMigrationChildRepBalancesAttoRep[child.universeId.toString()] === undefined || zoltarMigrationChildSplitAmountsAttoRep[child.universeId.toString()] === undefined)) === true
	const canSplit = accountAddress !== undefined && isOnActiveAppChain && rootUniverse !== undefined && hasForked && !loadingZoltarForkAccess && !loadingZoltarUniverse && !zoltarMigrationPending && hasValidAmount && hasEnoughRep && hasSufficientAllowance && hasValidOutcomeIndexes && splitLimit !== undefined
	const migrationAmountSource = getMigrationAmountSource(splitLimit, zoltarForkRepBalanceAttoRep)
	const splitRepReceivedAttoRep = migrationAmount === undefined ? undefined : migrationAmount * BigInt(selectedChildUniverses.length)
	const selectedDestinationsContent =
		selectedChildUniverses.length === 0
			? zoltarCopy.outcomeSelectionRequired
			: selectedChildUniverses.map((child, index) => (
					<span key={child.universeId.toString()}>
						{index === 0 ? undefined : ', '}
						{child.outcomeLabel}
					</span>
				))
	const approvalGuardMessage = (() => {
		const guard = getMigrationGuardMessage(accountAddress, isOnActiveAppChain, rootUniverse, loadingZoltarForkAccess, hasForked, loadingZoltarUniverse, '')
		if (guard !== undefined) return guard
		if (!hasValidAmount || migrationAmount === undefined) return commonCopy.positiveAmountRequired
		return undefined
	})()
	const getAlreadyPreparedHint = () => {
		if (hasValidOutcomeIndexes && splitLimit === 0n) return zoltarCopy.migrationAmountAlreadySplitDetail
		return zoltarCopy.migrationBalanceReadyDetail
	}
	const splitHintMessage = (() => {
		const guard = getMigrationGuardMessage(accountAddress, isOnActiveAppChain, rootUniverse, loadingZoltarForkAccess, hasForked, loadingZoltarUniverse, '')
		if (guard !== undefined) return guard
		if (!hasValidAmount || migrationAmount === undefined) return commonCopy.positiveAmountRequired
		if (!hasForked) return zoltarCopy.migrationForkRequired
		if (!hasValidOutcomeIndexes) return zoltarCopy.outcomeSelectionRequired
		if (hasUnavailableRequiredBalance) return loadingZoltarForkAccess ? zoltarCopy.outcomeBalancesLoading : zoltarCopy.migrationBalancesReadFailed
		if (!hasEnoughRep) return zoltarCopy.formatMigrationRepShortfall(formatCurrencyBalance(missingPreparationAmount))
		if (!hasSufficientAllowance) return zoltarCopy.migrationApprovalPendingDetail
		if (splitLimit + missingPreparationAmount === 0n) return zoltarCopy.migrationAmountAlreadySplitDetail
		return undefined
	})()
	const migrationAmountHintMessage = (() => {
		const guard = getMigrationGuardMessage(accountAddress, isOnActiveAppChain, rootUniverse, loadingZoltarForkAccess, hasForked, loadingZoltarUniverse, '')
		if (guard !== undefined) return guard
		if (!hasValidAmount || migrationAmount === undefined) return undefined
		if (hasUnavailableRequiredBalance) return undefined
		if (amountExceedsAvailableRep) return zoltarCopy.formatMigrationBalanceExceeded(formatCurrencyBalance(totalAvailableAttoRep), formatCurrencyBalance(splitLimit ?? 0n), formatCurrencyBalance(zoltarForkRepBalanceAttoRep ?? 0n))
		if (missingPreparationAmount === 0n) return getAlreadyPreparedHint()
		return zoltarCopy.formatAddMigrationRepDetail(formatCurrencyBalance(missingPreparationAmount))
	})()
	const renderMigrationActions = (approvalButton?: ComponentChildren, approvalNotice?: string, noticeId?: string) => (
		<TransactionActionGroup id={noticeId} message={approvalNotice ?? splitHintMessage}>
			{approvalButton}
			{accountAddress !== undefined && hasForked && !loadingZoltarForkAccess && !loadingZoltarUniverse && (hasUnavailableRequiredBalance || hasUnavailableOutcomeBalance) ? (
				<button className='quiet' type='button' onClick={onRetryMigrationBalances} disabled={zoltarMigrationPending || !isOnActiveAppChain}>
					{commonCopy.retry}
				</button>
			) : undefined}
			<TransactionActionButton
				idleLabel={zoltarCopy.splitRep}
				pendingLabel={zoltarCopy.splittingRepPending}
				onClick={() => onMigrateInternalRep(missingPreparationAmount)}
				pending={zoltarMigrationActiveAction === 'split'}
				availability={{ disabled: !canSplit, reason: isOnActiveAppChain ? splitHintMessage : getWrongNetworkReason() }}
			/>
		</TransactionActionGroup>
	)
	const selectAllAmount = () => {
		onZoltarMigrationFormChange({ amount: formatCurrencyInputBalance(migrationAmountSource) })
	}
	const addNextOutcome = () => {
		const nextOutcome = rootUniverse?.childUniverses.find(child => !selectedOutcomeIndexSet.has(child.outcomeIndex.toString()))
		if (nextOutcome === undefined) return
		toggleOutcomeIndex(nextOutcome.outcomeIndex)
	}
	const toggleOutcomeIndex = (outcomeIndex: bigint) => {
		if (selectedOutcomeIndexSet.has(outcomeIndex.toString())) {
			onZoltarMigrationFormChange({
				outcomeIndexes: selectedOutcomeIndexes
					.filter((index: bigint) => index !== outcomeIndex)
					.map((index: bigint) => index.toString())
					.join(', '),
			})
			return
		}
		onZoltarMigrationFormChange({ outcomeIndexes: [...selectedOutcomeIndexes, outcomeIndex].map((index: bigint) => index.toString()).join(', ') })
	}
	const deploymentDisabledReason = (child: ZoltarChildUniverseSummary) => getChildDeploymentAvailabilityReason({ accountAddress, exists: child.exists, hasForked, isOnActiveAppChain })
	if (universeMissing) {
		const presentation = getUniversePresentation(zoltarUniverseState)
		return (
			<>
				{presentation === undefined ? undefined : <StateHint presentation={presentation} title={zoltarCopy.migrateRep} />}
				<ErrorNotice message={zoltarMigrationError} />
			</>
		)
	}

	return (
		<>
			<SectionBlock variant='plain'>
				<DataGrid>
					<MetricField label={zoltarCopy.migrationAvailableRep}>
						<CurrencyValue value={loadingZoltarForkAccess ? undefined : migrationAmountSource} suffix={commonCopy.rep} />
					</MetricField>
					<MetricField label={zoltarCopy.walletRepBalance}>
						<CurrencyValue loading={loadingZoltarForkAccess && zoltarForkRepBalanceAttoRep === undefined} value={zoltarForkRepBalanceAttoRep} suffix={commonCopy.rep} />
					</MetricField>
					<MetricField label={zoltarCopy.migrationRepBalance}>
						<CurrencyValue loading={loadingZoltarForkAccess && zoltarMigrationPreparedRepBalanceAttoRep === undefined} value={zoltarMigrationPreparedRepBalanceAttoRep} suffix={commonCopy.rep} />
					</MetricField>
				</DataGrid>
				<div className='form-grid'>
					<div className='field'>
						<label htmlFor='zoltar-migration-amount'>{zoltarCopy.migrationAmount}</label>
						<div className='field-inline'>
							<FormInput
								id='zoltar-migration-amount'
								className='field-inline-input'
								invalid={isMigrationAmountInvalid}
								inputMode='decimal'
								onInput={event => onZoltarMigrationFormChange({ amount: event.currentTarget.value })}
								placeholder={commonCopy.zeroDecimalPlaceholder}
								value={zoltarMigrationForm.amount}
								disabled={zoltarMigrationPending}
							/>
							<button className='quiet field-inline-action' type='button' onClick={selectAllAmount} disabled={zoltarMigrationPending || migrationAmountSource <= 0n}>
								{commonCopy.max}
							</button>
						</div>
						<p className='detail'>{zoltarCopy.migrationMaxIncludesPrepared}</p>
						<p className='detail migration-amount-hint'>{migrationAmountHintMessage}</p>
					</div>

					{rootUniverse === undefined ? undefined : (
						<MigrationOutcomeUniversesSection
							onDeployChildUniverse={onDeployChildUniverse}
							pendingOutcomeIndex={pendingChildUniverseOutcomeIndex}
							deploymentDisabledReason={deploymentDisabledReason}
							childUniverseRepBalances={zoltarMigrationChildRepBalancesAttoRep}
							childUniverseSplitAmounts={zoltarMigrationChildSplitAmountsAttoRep}
							childUniverses={rootUniverse.childUniverses}
							loadingBalances={loadingZoltarForkAccess}
							disabled={zoltarMigrationPending}
							isScalarFork={rootUniverse.forkQuestionDetails?.marketType === 'scalar'}
							migrationBalance={zoltarMigrationPreparedRepBalanceAttoRep}
							onAddNextOutcome={addNextOutcome}
							onToggleOutcomeIndex={toggleOutcomeIndex}
							selectedOutcomeIndexSet={selectedOutcomeIndexSet}
						/>
					)}

					<DataGrid dense>
						<MetricField label={commonCopy.question}>{rootUniverse?.forkQuestionDetails?.title ?? commonCopy.unavailable}</MetricField>
						<MetricField label={zoltarCopy.selectedDestinations}>{selectedDestinationsContent}</MetricField>
						<MetricField label={zoltarCopy.migrationAmount}>
							<CurrencyValue value={migrationAmount} suffix={commonCopy.rep} />
						</MetricField>
						<MetricField label={zoltarCopy.walletRepUsed}>
							<CurrencyValue value={hasUnavailableRequiredBalance ? undefined : missingPreparationAmount} suffix={commonCopy.rep} />
						</MetricField>
						<MetricField label={zoltarCopy.childUniverseRepReceived}>
							<CurrencyValue value={splitRepReceivedAttoRep} suffix={commonCopy.rep} />
						</MetricField>
					</DataGrid>

					{requiresApproval ? (
						<TokenApprovalControl
							renderActions={({ button, notice, noticeId }) => renderMigrationActions(button, notice, noticeId)}
							actionLabel={zoltarCopy.preparingCurrentAmountLabel}
							allowanceError={zoltarForkApproval.error}
							allowanceLoading={zoltarForkApproval.loading}
							approvedAmount={zoltarForkApproval.value}
							disabled={!isOnActiveAppChain || hasUnavailableRequiredBalance}
							guardMessage={approvalGuardMessage}
							onApprove={amount => onApproveZoltarForkRep(amount)}
							pending={zoltarForkActiveAction === 'approve'}
							pendingLabel={commonCopy.approvingRep}
							requiredAmount={hasUnavailableRequiredBalance ? undefined : missingPreparationAmount}
							resetKey={`${rootUniverse?.reputationToken ?? ''}:${rootUniverse?.universeId.toString() ?? ''}:${missingPreparationAmount.toString()}`}
							tokenSymbol={rootUniverse?.reputationTokenSymbol ?? 'REP'}
							tokenUnits={18}
						/>
					) : (
						renderMigrationActions()
					)}

					{heldChildUniverses.length === 0 ? undefined : (
						<WorkflowSubsection title={zoltarCopy.walletRepTokens}>
							<DataGrid dense>
								{heldChildUniverses.map(child => (
									<MetricField key={child.universeId.toString()} label={child.outcomeLabel}>
										<WalletAssetControl accountAddress={accountAddress} address={child.reputationToken} isSupportedChain={isOnActiveAppChain} tokenLabel={`${child.outcomeLabel} ${child.reputationTokenSymbol ?? commonCopy.rep}`} />
									</MetricField>
								))}
							</DataGrid>
						</WorkflowSubsection>
					)}
				</div>
			</SectionBlock>

			<ErrorNotice message={zoltarMigrationError} />
		</>
	)
}
