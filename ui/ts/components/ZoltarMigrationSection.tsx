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
import { UI_STRINGS, TSX_STRINGS } from '../lib/uiStrings.js'
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
		const guard = getMigrationGuardMessage(accountAddress, isMainnet, rootUniverse, loadingZoltarForkAccess, hasForked, loadingZoltarUniverse, UI_STRINGS.zoltarMigrationSection.repPreparationUnavailableReason)
		if (guard !== undefined) return guard
		if (!hasValidAmount || migrationAmount === undefined) return TSX_STRINGS.componentsZoltarMigrationSection.copy001
		return undefined
	})()
	const getAlreadyPreparedHint = () => {
		if (hasValidOutcomeIndexes && splitLimit === 0n) return TSX_STRINGS.componentsZoltarMigrationSection.copy002
		return TSX_STRINGS.componentsZoltarMigrationSection.copy003
	}
	const prepareHintMessage = (() => {
		const guard = getMigrationGuardMessage(accountAddress, isMainnet, rootUniverse, loadingZoltarForkAccess, hasForked, loadingZoltarUniverse, UI_STRINGS.zoltarMigrationSection.repPreparationUnavailableReason)
		if (guard !== undefined) return guard
		if (!hasValidAmount || migrationAmount === undefined) return TSX_STRINGS.componentsZoltarMigrationSection.copy004
		if (missingPreparationAmount === 0n) return getAlreadyPreparedHint()
		if (zoltarForkRepBalance === undefined || zoltarForkRepBalance < missingPreparationAmount) return TSX_STRINGS.componentsZoltarMigrationSection.copy005(formatCurrencyBalance(missingPreparationAmount))
		if (!hasSufficientAllowance) return TSX_STRINGS.componentsZoltarMigrationSection.copy006
		return TSX_STRINGS.componentsZoltarMigrationSection.copy007(formatCurrencyBalance(missingPreparationAmount))
	})()
	const splitHintMessage = (() => {
		const guard = getMigrationGuardMessage(accountAddress, isMainnet, rootUniverse, loadingZoltarForkAccess, hasForked, loadingZoltarUniverse, UI_STRINGS.zoltarMigrationSection.repMigrationUnavailableReason)
		if (guard !== undefined) return guard
		if (!hasValidAmount || migrationAmount === undefined) return TSX_STRINGS.componentsZoltarMigrationSection.copy008
		if (!hasPreparedBalance) return TSX_STRINGS.componentsZoltarMigrationSection.copy009(formatCurrencyBalance(missingPreparationAmount ?? 0n))
		if (!hasValidOutcomeIndexes) return TSX_STRINGS.componentsZoltarMigrationSection.copy010
		if (splitLimit === undefined) return TSX_STRINGS.componentsZoltarMigrationSection.copy011
		if (splitLimit === 0n) return TSX_STRINGS.componentsZoltarMigrationSection.copy012
		if (!hasSufficientSplitLimit) return TSX_STRINGS.componentsZoltarMigrationSection.copy013(formatCurrencyBalance(splitLimit))
		return TSX_STRINGS.componentsZoltarMigrationSection.copy014
	})()
	const migrationAmountHintMessage = (() => {
		const guard = getMigrationGuardMessage(accountAddress, isMainnet, rootUniverse, loadingZoltarForkAccess, hasForked, loadingZoltarUniverse, UI_STRINGS.zoltarMigrationSection.repMigrationUnavailableReason)
		if (guard !== undefined) return guard
		if (!hasValidAmount || migrationAmount === undefined) return undefined
		if (amountExceedsAvailableRep) return TSX_STRINGS.componentsZoltarMigrationSection.copy015(formatCurrencyBalance(totalRepAvailable), formatCurrencyBalance(zoltarMigrationPreparedRepBalance ?? 0n), formatCurrencyBalance(zoltarForkRepBalance ?? 0n))
		if (missingPreparationAmount === 0n) return getAlreadyPreparedHint()
		return TSX_STRINGS.componentsZoltarMigrationSection.copy016(formatCurrencyBalance(missingPreparationAmount))
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
				{presentation === undefined ? undefined : <StateHint presentation={presentation} title={TSX_STRINGS.componentsZoltarMigrationSection.copy017} />}
				<ErrorNotice message={zoltarMigrationError} />
			</>
		)
	}

	return (
		<>
			<SectionBlock title={TSX_STRINGS.componentsZoltarMigrationSection.copy018}>
				<DataGrid>
					<MetricField label={TSX_STRINGS.componentsZoltarMigrationSection.copy019}>
						<CurrencyValue loading={loadingZoltarForkAccess && zoltarMigrationPreparedRepBalance === undefined} value={zoltarMigrationPreparedRepBalance} suffix={TSX_STRINGS.componentsZoltarMigrationSection.copy020} />
					</MetricField>
					<MetricField label={TSX_STRINGS.componentsZoltarMigrationSection.copy021}>
						{rootUniverse === undefined ? (
							<span className='loading-value' role='status' aria-label={TSX_STRINGS.componentsZoltarMigrationSection.copy022}>
								<span className='spinner' aria-hidden='true' />
							</span>
						) : (
							<UniverseLink universeId={rootUniverse.universeId} />
						)}
					</MetricField>
				</DataGrid>
				<div className='form-grid'>
					<div className='field'>
						<span>{TSX_STRINGS.componentsZoltarMigrationSection.copy023}</span>
						<div className='field-inline'>
							<FormInput
								className='field-inline-input'
								invalid={isMigrationAmountInvalid}
								inputMode='decimal'
								onInput={event => onZoltarMigrationFormChange({ amount: event.currentTarget.value })}
								placeholder={TSX_STRINGS.componentsZoltarMigrationSection.copy024}
								value={zoltarMigrationForm.amount}
								disabled={zoltarMigrationPending || !hasForked}
							/>
							<button className='quiet field-inline-action' type='button' onClick={selectAllAmount} disabled={zoltarMigrationPending || !hasForked || migrationAmountSource <= 0n}>
								{TSX_STRINGS.componentsZoltarMigrationSection.copy025}
							</button>
						</div>
						{migrationAmountHintMessage === undefined ? undefined : <p className='detail'>{migrationAmountHintMessage}</p>}
					</div>

					<TokenApprovalControl
						actionLabel={TSX_STRINGS.componentsZoltarMigrationSection.copy026}
						allowanceError={zoltarForkApproval.error}
						allowanceLoading={zoltarForkApproval.loading}
						approvedAmount={zoltarForkApproval.value}
						disabled={!isMainnet}
						guardMessage={approvalGuardMessage}
						onApprove={amount => onApproveZoltarForkRep(amount)}
						pending={zoltarForkActiveAction === 'approve'}
						pendingLabel={TSX_STRINGS.componentsZoltarMigrationSection.copy027}
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
						<TransactionActionButton
							idleLabel={UI_STRINGS.zoltarMigrationSection.prepareRepIdleLabel}
							pendingLabel={UI_STRINGS.zoltarMigrationSection.preparingRepPendingLabel}
							onClick={onPrepareRepForMigration}
							pending={zoltarMigrationActiveAction === 'prepare'}
							tone='secondary'
							availability={{ disabled: !canPrepare, reason: isMainnet ? prepareHintMessage : undefined }}
						/>
						<TransactionActionButton
							idleLabel={UI_STRINGS.zoltarMigrationSection.splitRepIdleLabel}
							pendingLabel={UI_STRINGS.zoltarMigrationSection.splittingRepPendingLabel}
							onClick={onMigrateInternalRep}
							pending={zoltarMigrationActiveAction === 'split'}
							availability={{ disabled: !canSplit, reason: isMainnet ? splitHintMessage : undefined }}
						/>
					</div>
				</div>
			</SectionBlock>

			<ErrorNotice message={zoltarMigrationError} />
		</>
	)
}
