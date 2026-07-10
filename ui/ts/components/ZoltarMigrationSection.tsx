import { useMemo } from 'preact/hooks'
import type { Address } from '@zoltar/shared/ethereum'
import { CurrencyValue } from './CurrencyValue.js'
import { DataGrid } from './DataGrid.js'
import { ErrorNotice } from './ErrorNotice.js'
import { FormInput } from './FormInput.js'
import { MetricField } from './MetricField.js'
import { SectionBlock } from './SectionBlock.js'
import { StateHint } from './StateHint.js'
import { TokenApprovalControl } from './TokenApprovalControl.js'
import { TransactionActionButton } from './TransactionActionButton.js'
import { UniverseLink } from './UniverseLink.js'
import { getMigrationOutcomeSplitLimit, MigrationOutcomeUniversesSection } from './MigrationOutcomeUniversesSection.js'
import type { LoadableValueState } from '../lib/loadState.js'
import { formatCurrencyBalance, formatCurrencyInputBalance } from '../lib/formatters.js'
import { tryParseBigIntListInput } from '../lib/inputs.js'
import { tryParseRepAmountInput as parseMigrationAmountInput } from '../lib/marketForm.js'
import { deriveTokenApprovalRequirement, type TokenApprovalState } from '../lib/tokenApproval.js'
import {
	UI_STRING_APPROVING_REP,
	UI_STRING_ENTER_AN_AMOUNT_GREATER_THAN_ZERO,
	UI_STRING_LOADING_OUTCOME_UNIVERSE_BALANCES_TRUNCATED,
	UI_STRING_LOADING_UNIVERSE_DATA,
	UI_STRING_MAX,
	UI_STRING_MIGRATE_REP,
	UI_STRING_MIGRATION_AMOUNT,
	UI_STRING_MIGRATION_REP_BALANCE,
	UI_STRING_PREPARE_REP,
	UI_STRING_PREPARING_THE_CURRENT_AMOUNT,
	UI_STRING_PREPARING_REP_PENDING,
	UI_STRING_REP,
	UI_STRING_REP_MIGRATION_UNAVAILABLE_BECAUSE_UNIVERSE_HAS_NOT_FORKED,
	UI_STRING_REP_PREPARATION_UNAVAILABLE_BECAUSE_UNIVERSE_HAS_NOT_FORKED,
	UI_STRING_SELECT_AT_LEAST_ONE_OUTCOME_UNIVERSE,
	UI_STRING_SPLIT_REP,
	UI_STRING_SPLITTING_REP_PENDING,
	UI_STRING_SPLIT_THE_MIGRATION_REP_ACROSS_THE_SELECTED_UNIVERSES,
	UI_STRING_MIGRATION_AMOUNT_ALREADY_SPLIT_DETAIL,
	UI_STRING_MIGRATION_BALANCE_READY_TO_SPLIT_DETAIL,
	UI_STRING_UNIVERSE,
	UI_STRING_WAITING_FOR_APPROVED_REP_AMOUNT_BEFORE_PREPARING_THE_SELECTED_AMOUNT,
	UI_STRING_ZERO_DECIMAL_PLACEHOLDER,
	UI_TEMPLATE_ADD_REP_TO_MIGRATION_BALANCE_DETAIL,
	UI_TEMPLATE_ADD_VALUE_REP_TO_YOUR_MIGRATION_BALANCE_FIRST_THEN_SPLIT_IT_ACROSS,
	UI_TEMPLATE_NEED_VALUE_MORE_REP_IN_THIS_UNIVERSE_TO_PREPARE_THE_SELECTED_AMOUNT,
	UI_TEMPLATE_MIGRATION_SPLIT_CAPACITY_DETAIL,
	UI_TEMPLATE_MIGRATION_AMOUNT_EXCEEDS_AVAILABLE_REP_DETAIL,
} from '../lib/uiStrings.js'
import { getUniversePresentation } from '../lib/userCopy.js'
import { getMigrationGuardMessage } from '../lib/zoltarMigrationGuards.js'
import type { ZoltarMigrationFormState } from '../types/app.js'
import type { ZoltarMigrationActionResult, ZoltarUniverseSummary } from '../types/contracts.js'

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
	zoltarMigrationResult?: ZoltarMigrationActionResult | undefined
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
	const approvalGuardMessage = (() => {
		const guard = getMigrationGuardMessage(accountAddress, isMainnet, rootUniverse, loadingZoltarForkAccess, hasForked, loadingZoltarUniverse, UI_STRING_REP_PREPARATION_UNAVAILABLE_BECAUSE_UNIVERSE_HAS_NOT_FORKED)
		if (guard !== undefined) return guard
		if (!hasValidAmount || migrationAmount === undefined) return UI_STRING_ENTER_AN_AMOUNT_GREATER_THAN_ZERO
		return undefined
	})()
	const getAlreadyPreparedHint = () => {
		if (hasValidOutcomeIndexes && splitLimit === 0n) return UI_STRING_MIGRATION_AMOUNT_ALREADY_SPLIT_DETAIL
		return UI_STRING_MIGRATION_BALANCE_READY_TO_SPLIT_DETAIL
	}
	const prepareHintMessage = (() => {
		const guard = getMigrationGuardMessage(accountAddress, isMainnet, rootUniverse, loadingZoltarForkAccess, hasForked, loadingZoltarUniverse, UI_STRING_REP_PREPARATION_UNAVAILABLE_BECAUSE_UNIVERSE_HAS_NOT_FORKED)
		if (guard !== undefined) return guard
		if (!hasValidAmount || migrationAmount === undefined) return UI_STRING_ENTER_AN_AMOUNT_GREATER_THAN_ZERO
		if (missingPreparationAmount === 0n) return getAlreadyPreparedHint()
		if (zoltarForkRepBalance === undefined || zoltarForkRepBalance < missingPreparationAmount) return UI_TEMPLATE_NEED_VALUE_MORE_REP_IN_THIS_UNIVERSE_TO_PREPARE_THE_SELECTED_AMOUNT(formatCurrencyBalance(missingPreparationAmount))
		if (!hasSufficientAllowance) return UI_STRING_WAITING_FOR_APPROVED_REP_AMOUNT_BEFORE_PREPARING_THE_SELECTED_AMOUNT
		return UI_TEMPLATE_ADD_REP_TO_MIGRATION_BALANCE_DETAIL(formatCurrencyBalance(missingPreparationAmount))
	})()
	const splitHintMessage = (() => {
		const guard = getMigrationGuardMessage(accountAddress, isMainnet, rootUniverse, loadingZoltarForkAccess, hasForked, loadingZoltarUniverse, UI_STRING_REP_MIGRATION_UNAVAILABLE_BECAUSE_UNIVERSE_HAS_NOT_FORKED)
		if (guard !== undefined) return guard
		if (!hasValidAmount || migrationAmount === undefined) return UI_STRING_ENTER_AN_AMOUNT_GREATER_THAN_ZERO
		if (!hasPreparedBalance) return UI_TEMPLATE_ADD_VALUE_REP_TO_YOUR_MIGRATION_BALANCE_FIRST_THEN_SPLIT_IT_ACROSS(formatCurrencyBalance(missingPreparationAmount ?? 0n))
		if (!hasValidOutcomeIndexes) return UI_STRING_SELECT_AT_LEAST_ONE_OUTCOME_UNIVERSE
		if (splitLimit === undefined) return UI_STRING_LOADING_OUTCOME_UNIVERSE_BALANCES_TRUNCATED
		if (splitLimit === 0n) return UI_STRING_MIGRATION_AMOUNT_ALREADY_SPLIT_DETAIL
		if (!hasSufficientSplitLimit) return UI_TEMPLATE_MIGRATION_SPLIT_CAPACITY_DETAIL(formatCurrencyBalance(splitLimit))
		return UI_STRING_SPLIT_THE_MIGRATION_REP_ACROSS_THE_SELECTED_UNIVERSES
	})()
	const migrationAmountHintMessage = (() => {
		const guard = getMigrationGuardMessage(accountAddress, isMainnet, rootUniverse, loadingZoltarForkAccess, hasForked, loadingZoltarUniverse, UI_STRING_REP_MIGRATION_UNAVAILABLE_BECAUSE_UNIVERSE_HAS_NOT_FORKED)
		if (guard !== undefined) return guard
		if (!hasValidAmount || migrationAmount === undefined) return undefined
		if (amountExceedsAvailableRep) return UI_TEMPLATE_MIGRATION_AMOUNT_EXCEEDS_AVAILABLE_REP_DETAIL(formatCurrencyBalance(totalRepAvailable), formatCurrencyBalance(zoltarMigrationPreparedRepBalance ?? 0n), formatCurrencyBalance(zoltarForkRepBalance ?? 0n))
		if (missingPreparationAmount === 0n) return getAlreadyPreparedHint()
		return UI_TEMPLATE_ADD_REP_TO_MIGRATION_BALANCE_DETAIL(formatCurrencyBalance(missingPreparationAmount))
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
				{presentation === undefined ? undefined : <StateHint presentation={presentation} title={UI_STRING_MIGRATE_REP} />}
				<ErrorNotice message={zoltarMigrationError} />
			</>
		)
	}

	return (
		<>
			<SectionBlock title={UI_STRING_MIGRATE_REP}>
				<DataGrid>
					<MetricField label={UI_STRING_MIGRATION_REP_BALANCE}>
						<CurrencyValue loading={loadingZoltarForkAccess && zoltarMigrationPreparedRepBalance === undefined} value={zoltarMigrationPreparedRepBalance} suffix={UI_STRING_REP} />
					</MetricField>
					<MetricField label={UI_STRING_UNIVERSE}>
						{rootUniverse === undefined ? (
							<span className='loading-value' role='status' aria-label={UI_STRING_LOADING_UNIVERSE_DATA}>
								<span className='spinner' aria-hidden='true' />
							</span>
						) : (
							<UniverseLink universeId={rootUniverse.universeId} />
						)}
					</MetricField>
				</DataGrid>
				<div className='form-grid'>
					<div className='field'>
						<span>{UI_STRING_MIGRATION_AMOUNT}</span>
						<div className='field-inline'>
							<FormInput
								className='field-inline-input'
								invalid={isMigrationAmountInvalid}
								inputMode='decimal'
								onInput={event => onZoltarMigrationFormChange({ amount: event.currentTarget.value })}
								placeholder={UI_STRING_ZERO_DECIMAL_PLACEHOLDER}
								value={zoltarMigrationForm.amount}
								disabled={zoltarMigrationPending || !hasForked}
							/>
							<button className='quiet field-inline-action' type='button' onClick={selectAllAmount} disabled={zoltarMigrationPending || !hasForked || migrationAmountSource <= 0n}>
								{UI_STRING_MAX}
							</button>
						</div>
						{migrationAmountHintMessage === undefined ? undefined : <p className='detail'>{migrationAmountHintMessage}</p>}
					</div>

					<TokenApprovalControl
						actionLabel={UI_STRING_PREPARING_THE_CURRENT_AMOUNT}
						allowanceError={zoltarForkApproval.error}
						allowanceLoading={zoltarForkApproval.loading}
						approvedAmount={zoltarForkApproval.value}
						disabled={!isMainnet}
						guardMessage={approvalGuardMessage}
						onApprove={amount => onApproveZoltarForkRep(amount)}
						pending={zoltarForkActiveAction === 'approve'}
						pendingLabel={UI_STRING_APPROVING_REP}
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

					<div className='actions'>
						<TransactionActionButton idleLabel={UI_STRING_PREPARE_REP} pendingLabel={UI_STRING_PREPARING_REP_PENDING} onClick={onPrepareRepForMigration} pending={zoltarMigrationActiveAction === 'prepare'} tone='secondary' availability={{ disabled: !canPrepare, reason: isMainnet ? prepareHintMessage : undefined }} />
						<TransactionActionButton idleLabel={UI_STRING_SPLIT_REP} pendingLabel={UI_STRING_SPLITTING_REP_PENDING} onClick={onMigrateInternalRep} pending={zoltarMigrationActiveAction === 'split'} availability={{ disabled: !canSplit, reason: isMainnet ? splitHintMessage : undefined }} />
					</div>
				</div>
			</SectionBlock>

			<ErrorNotice message={zoltarMigrationError} />
		</>
	)
}
