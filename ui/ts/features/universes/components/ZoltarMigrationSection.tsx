import * as commonCopy from '../../../copy/common.js'
import * as zoltarCopy from '../../../copy/zoltar.js'
import * as transactionReviewCopy from '../../../copy/transactionReview.js'
import { useMemo } from 'preact/hooks'
import type { Address } from '@zoltar/shared/ethereum'
import { CurrencyValue } from '../../../components/CurrencyValue.js'
import { AddressValue } from '../../../components/AddressValue.js'
import { DataGrid } from '../../../components/DataGrid.js'
import { ErrorNotice } from '../../../components/ErrorNotice.js'
import { FormInput } from '../../../components/FormInput.js'
import { MetricField } from '../../../components/MetricField.js'
import { SectionBlock } from '../../../components/SectionBlock.js'
import { StateHint } from '../../../components/StateHint.js'
import { TokenApprovalControl } from '../../../components/TokenApprovalControl.js'
import { TransactionActionButton } from '../../../components/TransactionActionButton.js'
import { TransactionReview } from '../../../components/TransactionReview.js'
import { TransactionNetworkValue } from '../../../components/TransactionNetworkValue.js'
import { TransactionUniverseValue } from './TransactionUniverseValue.js'
import { UniverseLink } from './UniverseLink.js'
import { getMigrationOutcomeSplitLimit, MigrationOutcomeUniversesSection } from './MigrationOutcomeUniversesSection.js'
import type { LoadableValueState } from '../../../lib/loadState.js'
import { formatCurrencyBalance, formatCurrencyInputBalance } from '../../../lib/formatters.js'
import { tryParseBigIntListInput } from '../../../lib/inputs.js'
import { tryParseRepAmountInput as parseMigrationAmountInput } from '../../markets/lib/marketForm.js'
import { deriveTokenApprovalRequirement, type TokenApprovalState } from '../../../lib/tokenApproval.js'
import { getUniversePresentation } from '../../../lib/userCopy.js'
import { getMigrationGuardMessage } from '../lib/zoltarMigrationGuards.js'
import type { ZoltarMigrationFormState } from '../../../types/app.js'
import type { ZoltarUniverseSummary } from '../../../types/contracts.js'

type ZoltarMigrationSectionProps = {
	accountAddress: Address | undefined
	isMainnet: boolean
	loadingZoltarForkAccess: boolean
	loadingZoltarUniverse: boolean
	onMigrateInternalRep: () => void
	onPrepareRepForMigration: () => void
	onZoltarMigrationFormChange: (update: Partial<ZoltarMigrationFormState>) => void
	zoltarForkRepBalance: bigint | undefined
	zoltarForkApproval: TokenApprovalState
	zoltarForkActiveAction: 'approve' | 'fork' | undefined
	zoltarMigrationChildRepBalances: Record<string, bigint | undefined>
	zoltarMigrationActiveAction: 'prepare' | 'split' | undefined
	zoltarMigrationError: string | undefined
	zoltarMigrationForm: ZoltarMigrationFormState
	zoltarMigrationPending: boolean
	zoltarMigrationPreparedRepBalance: bigint | undefined
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

function getMigrationAmountSource(preparedRepBalance: bigint | undefined, repBalance: bigint | undefined) {
	return (preparedRepBalance ?? 0n) + (repBalance ?? 0n)
}

function getMissingPreparationAmount(targetAmount: bigint, preparedRepBalance: bigint | undefined) {
	const currentPreparedBalance = preparedRepBalance ?? 0n
	return targetAmount > currentPreparedBalance ? targetAmount - currentPreparedBalance : 0n
}

export function ZoltarMigrationSection({
	accountAddress,
	isMainnet,
	loadingZoltarForkAccess,
	loadingZoltarUniverse,
	onMigrateInternalRep,
	onPrepareRepForMigration,
	onZoltarMigrationFormChange,
	zoltarForkRepBalance,
	zoltarForkApproval,
	zoltarForkActiveAction,
	zoltarMigrationChildRepBalances,
	zoltarMigrationActiveAction,
	zoltarMigrationError,
	zoltarMigrationForm,
	zoltarMigrationPending,
	zoltarMigrationPreparedRepBalance,
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
	const migrationAmount = getMigrationAmount(zoltarMigrationForm.amount)
	const hasValidAmount = migrationAmount !== undefined && migrationAmount > 0n
	const isMigrationAmountInvalid = zoltarMigrationForm.amount.trim() !== '' && migrationAmount === undefined
	const missingPreparationAmount = hasValidAmount && migrationAmount !== undefined ? getMissingPreparationAmount(migrationAmount, zoltarMigrationPreparedRepBalance) : 0n
	const totalRepAvailable = (zoltarMigrationPreparedRepBalance ?? 0n) + (zoltarForkRepBalance ?? 0n)
	const amountExceedsAvailableRep = hasValidAmount && migrationAmount !== undefined && migrationAmount > totalRepAvailable
	const hasEnoughRep = hasValidAmount && zoltarForkRepBalance !== undefined && zoltarForkRepBalance >= missingPreparationAmount
	const hasPreparedBalance = hasValidAmount && zoltarMigrationPreparedRepBalance !== undefined && zoltarMigrationPreparedRepBalance >= migrationAmount
	const approvalRequirement = deriveTokenApprovalRequirement(missingPreparationAmount, zoltarForkApproval.value)
	const hasSufficientAllowance = approvalRequirement.hasSufficientApproval
	const hasValidOutcomeIndexes = selectedOutcomeIndexes.length > 0
	const needsAdditionalPreparation = missingPreparationAmount > 0n
	const splitLimit = useMemo(() => getMigrationOutcomeSplitLimit(rootUniverse?.childUniverses ?? [], zoltarMigrationChildRepBalances, zoltarMigrationPreparedRepBalance, selectedOutcomeIndexSet), [rootUniverse?.childUniverses, selectedOutcomeIndexSet, zoltarMigrationChildRepBalances, zoltarMigrationPreparedRepBalance])
	const hasSufficientSplitLimit = migrationAmount !== undefined && splitLimit !== undefined && migrationAmount <= splitLimit
	const canPrepare = accountAddress !== undefined && isMainnet && rootUniverse !== undefined && hasForked && !zoltarMigrationPending && hasValidAmount && needsAdditionalPreparation && hasEnoughRep && hasSufficientAllowance
	const canSplit = accountAddress !== undefined && isMainnet && rootUniverse !== undefined && hasForked && !zoltarMigrationPending && hasValidAmount && hasPreparedBalance && hasValidOutcomeIndexes && hasSufficientSplitLimit
	const migrationAmountSource = getMigrationAmountSource(zoltarMigrationPreparedRepBalance, zoltarForkRepBalance)
	const walletRepAfterPrepare = zoltarForkRepBalance === undefined || missingPreparationAmount > zoltarForkRepBalance ? undefined : zoltarForkRepBalance - missingPreparationAmount
	const custodyRepAfterPrepare = (zoltarMigrationPreparedRepBalance ?? 0n) + missingPreparationAmount
	const splitRepReceived = migrationAmount === undefined ? undefined : migrationAmount * BigInt(selectedChildUniverses.length)
	const workflowStage = (() => {
		if (!hasValidAmount || !hasValidOutcomeIndexes) return 'choose'
		if (needsAdditionalPreparation || zoltarForkActiveAction === 'approve' || zoltarMigrationActiveAction === 'prepare') return 'prepare'
		return 'split'
	})()
	const workflowSteps = [
		{ key: 'choose', label: zoltarCopy.chooseDestinationStep },
		{ key: 'prepare', label: zoltarCopy.prepareRepStep },
		{ key: 'split', label: zoltarCopy.splitRepStep },
	] as const
	const selectedDestinationsContent =
		selectedChildUniverses.length === 0
			? zoltarCopy.outcomeSelectionRequired
			: selectedChildUniverses.map((child, index) => (
					<span key={child.universeId.toString()}>
						{index === 0 ? undefined : ', '}
						{child.outcomeLabel} · <UniverseLink universeId={child.universeId} />
					</span>
				))
	const approvalGuardMessage = (() => {
		const guard = getMigrationGuardMessage(accountAddress, isMainnet, rootUniverse, loadingZoltarForkAccess, hasForked, loadingZoltarUniverse, zoltarCopy.preparationNotForkedReason)
		if (guard !== undefined) return guard
		if (!hasValidAmount || migrationAmount === undefined) return commonCopy.positiveAmountRequired
		return undefined
	})()
	const getAlreadyPreparedHint = () => {
		if (hasValidOutcomeIndexes && splitLimit === 0n) return zoltarCopy.migrationAmountAlreadySplitDetail
		return zoltarCopy.migrationBalanceReadyDetail
	}
	const prepareHintMessage = (() => {
		const guard = getMigrationGuardMessage(accountAddress, isMainnet, rootUniverse, loadingZoltarForkAccess, hasForked, loadingZoltarUniverse, zoltarCopy.preparationNotForkedReason)
		if (guard !== undefined) return guard
		if (!hasValidAmount || migrationAmount === undefined) return commonCopy.positiveAmountRequired
		if (missingPreparationAmount === 0n) return getAlreadyPreparedHint()
		if (zoltarForkRepBalance === undefined || zoltarForkRepBalance < missingPreparationAmount) return zoltarCopy.formatMigrationRepShortfall(formatCurrencyBalance(missingPreparationAmount))
		if (!hasSufficientAllowance) return zoltarCopy.migrationApprovalPendingDetail
		return zoltarCopy.formatAddMigrationRepDetail(formatCurrencyBalance(missingPreparationAmount))
	})()
	const splitHintMessage = (() => {
		const guard = getMigrationGuardMessage(accountAddress, isMainnet, rootUniverse, loadingZoltarForkAccess, hasForked, loadingZoltarUniverse, zoltarCopy.migrationNotForkedReason)
		if (guard !== undefined) return guard
		if (!hasValidAmount || migrationAmount === undefined) return commonCopy.positiveAmountRequired
		if (!hasPreparedBalance) return zoltarCopy.formatMigrationPreparationRequired(formatCurrencyBalance(missingPreparationAmount ?? 0n))
		if (!hasValidOutcomeIndexes) return zoltarCopy.outcomeSelectionRequired
		if (splitLimit === undefined) return zoltarCopy.outcomeBalancesLoading
		if (splitLimit === 0n) return zoltarCopy.migrationAmountAlreadySplitDetail
		if (!hasSufficientSplitLimit) return zoltarCopy.formatSplitCapacityDetail(formatCurrencyBalance(splitLimit))
		return undefined
	})()
	const migrationAmountHintMessage = (() => {
		const guard = getMigrationGuardMessage(accountAddress, isMainnet, rootUniverse, loadingZoltarForkAccess, hasForked, loadingZoltarUniverse, zoltarCopy.migrationNotForkedReason)
		if (guard !== undefined) return guard
		if (!hasValidAmount || migrationAmount === undefined) return undefined
		if (amountExceedsAvailableRep) return zoltarCopy.formatMigrationBalanceExceeded(formatCurrencyBalance(totalRepAvailable), formatCurrencyBalance(zoltarMigrationPreparedRepBalance ?? 0n), formatCurrencyBalance(zoltarForkRepBalance ?? 0n))
		if (missingPreparationAmount === 0n) return getAlreadyPreparedHint()
		return zoltarCopy.formatAddMigrationRepDetail(formatCurrencyBalance(missingPreparationAmount))
	})()
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
			<SectionBlock title={zoltarCopy.migrateRep}>
				<div className='workflow-summary-strip workflow-guide'>
					<div className='workflow-summary-strip-steps migration-workflow-steps'>
						{workflowSteps.map(step => (
							<span className={workflowStage === step.key ? 'current' : ''} key={step.key}>
								{step.label}
							</span>
						))}
					</div>
				</div>
				<DataGrid>
					<MetricField label={zoltarCopy.walletRepBalance}>
						<CurrencyValue loading={loadingZoltarForkAccess && zoltarForkRepBalance === undefined} value={zoltarForkRepBalance} suffix={commonCopy.rep} />
					</MetricField>
					<MetricField label={zoltarCopy.migrationRepBalance}>
						<CurrencyValue loading={loadingZoltarForkAccess && zoltarMigrationPreparedRepBalance === undefined} value={zoltarMigrationPreparedRepBalance} suffix={commonCopy.rep} />
					</MetricField>
					<MetricField label={commonCopy.universe}>
						{rootUniverse === undefined ? (
							<span className='loading-value' role='status' aria-label={zoltarCopy.universeDataLoading}>
								<span className='spinner' aria-hidden='true' />
							</span>
						) : (
							<UniverseLink universeId={rootUniverse.universeId} />
						)}
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
								disabled={zoltarMigrationPending || !hasForked}
							/>
							<button className='quiet field-inline-action' type='button' onClick={selectAllAmount} disabled={zoltarMigrationPending || !hasForked || migrationAmountSource <= 0n}>
								{commonCopy.max}
							</button>
						</div>
						{migrationAmountHintMessage === undefined ? undefined : <p className='detail'>{migrationAmountHintMessage}</p>}
					</div>

					<TokenApprovalControl
						actionLabel={zoltarCopy.preparingCurrentAmountLabel}
						allowanceError={zoltarForkApproval.error}
						allowanceLoading={zoltarForkApproval.loading}
						approvedAmount={zoltarForkApproval.value}
						disabled={!isMainnet}
						guardMessage={approvalGuardMessage}
						onApprove={amount => onApproveZoltarForkRep(amount)}
						pending={zoltarForkActiveAction === 'approve'}
						pendingLabel={commonCopy.approvingRep}
						requiredAmount={missingPreparationAmount}
						resetKey={`${rootUniverse?.reputationToken ?? ''}:${rootUniverse?.universeId.toString() ?? ''}:${missingPreparationAmount.toString()}`}
						tokenSymbol='REP'
						tokenUnits={18}
					/>

					{rootUniverse === undefined ? undefined : (
						<MigrationOutcomeUniversesSection
							childUniverseRepBalances={zoltarMigrationChildRepBalances}
							childUniverses={rootUniverse.childUniverses}
							disabled={zoltarMigrationPending}
							isScalarFork={rootUniverse.forkQuestionDetails?.marketType === 'scalar'}
							migrationBalance={zoltarMigrationPreparedRepBalance}
							onAddNextOutcome={addNextOutcome}
							onToggleOutcomeIndex={toggleOutcomeIndex}
							selectedOutcomeIndexSet={selectedOutcomeIndexSet}
						/>
					)}

					<TransactionReview
						context={[
							{ label: commonCopy.question, value: rootUniverse?.forkQuestionDetails?.title ?? commonCopy.unavailable },
							{ label: commonCopy.universe, value: <TransactionUniverseValue universeId={rootUniverse?.universeId} /> },
							{ label: zoltarCopy.selectedDestinations, value: selectedDestinationsContent },
						]}
						primary={[
							needsAdditionalPreparation ? { label: transactionReviewCopy.youPay, value: <CurrencyValue value={missingPreparationAmount} suffix={commonCopy.rep} /> } : { label: zoltarCopy.migrationAmount, value: <CurrencyValue value={migrationAmount} suffix={commonCopy.rep} /> },
							needsAdditionalPreparation ? { label: zoltarCopy.repMovedToMigrationCustody, value: <CurrencyValue value={missingPreparationAmount} suffix={commonCopy.rep} /> } : { label: zoltarCopy.childUniverseRepReceived, value: <CurrencyValue value={splitRepReceived} suffix={commonCopy.rep} /> },
						]}
						details={[
							{ label: zoltarCopy.selectedDestinations, value: selectedDestinationsContent },
							{ label: zoltarCopy.afterPrepareWalletBalance, value: <CurrencyValue value={walletRepAfterPrepare} suffix={commonCopy.rep} /> },
							{ label: zoltarCopy.afterPrepareCustodyBalance, value: <CurrencyValue value={custodyRepAfterPrepare} suffix={commonCopy.rep} /> },
							{ label: zoltarCopy.afterSplitCustodyBalanceUnchanged, value: <CurrencyValue value={zoltarMigrationPreparedRepBalance} suffix={commonCopy.rep} /> },
							...selectedChildUniverses.map(child => ({
								label: zoltarCopy.destinationRepAfterSplit(child.outcomeLabel),
								value: <CurrencyValue value={migrationAmount === undefined || zoltarMigrationChildRepBalances[child.universeId.toString()] === undefined ? undefined : (zoltarMigrationChildRepBalances[child.universeId.toString()] ?? 0n) + migrationAmount} suffix={commonCopy.rep} />,
							})),
						]}
						risks={[zoltarCopy.migrationDestinationRisk, zoltarCopy.migrationSplitRisk]}
						technicalDetails={[
							{ label: transactionReviewCopy.protocolFee, value: transactionReviewCopy.noProtocolFee },
							{ label: transactionReviewCopy.contract, value: rootUniverse?.zoltarAddress === undefined ? commonCopy.unavailable : <AddressValue address={rootUniverse.zoltarAddress} /> },
							{ label: transactionReviewCopy.network, value: <TransactionNetworkValue /> },
						]}
					/>

					<div className='actions'>
						<TransactionActionButton
							idleLabel={zoltarCopy.prepareRep}
							pendingLabel={zoltarCopy.preparingRepPending}
							onClick={onPrepareRepForMigration}
							pending={zoltarMigrationActiveAction === 'prepare'}
							tone='secondary'
							availability={{ disabled: !canPrepare, reason: isMainnet ? prepareHintMessage : commonCopy.mainnetRequiredReason }}
						/>
						<TransactionActionButton idleLabel={zoltarCopy.splitRep} pendingLabel={zoltarCopy.splittingRepPending} onClick={onMigrateInternalRep} pending={zoltarMigrationActiveAction === 'split'} availability={{ disabled: !canSplit, reason: isMainnet ? splitHintMessage : commonCopy.mainnetRequiredReason }} />
					</div>
				</div>
			</SectionBlock>

			<ErrorNotice message={zoltarMigrationError} />
		</>
	)
}
