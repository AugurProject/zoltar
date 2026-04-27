import { useMemo } from 'preact/hooks'
import type { Address } from 'viem'
import { CurrencyValue } from './CurrencyValue.js'
import { EntityCard } from './EntityCard.js'
import { ErrorNotice } from './ErrorNotice.js'
import { FormInput } from './FormInput.js'
import { LoadingText } from './LoadingText.js'
import { MetricField } from './MetricField.js'
import { StateHint } from './StateHint.js'
import { TokenApprovalControl } from './TokenApprovalControl.js'
import { TransactionHashLink } from './TransactionHashLink.js'
import { UniverseLink } from './UniverseLink.js'
import { getMigrationOutcomeSplitLimit, MigrationOutcomeUniversesSection } from './MigrationOutcomeUniversesSection.js'
import type { LoadableValueState } from '../lib/loadState.js'
import { formatCurrencyBalance, formatCurrencyInputBalance } from '../lib/formatters.js'
import { parseBigIntListInput } from '../lib/inputs.js'
import { parseRepAmountInput as parseMigrationAmountInput } from '../lib/marketForm.js'
import { deriveTokenApprovalRequirement, type TokenApprovalState } from '../lib/tokenApproval.js'
import { getUniversePresentation, getWalletPresentation } from '../lib/userCopy.js'
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
	zoltarMigrationResult: ZoltarMigrationActionResult | undefined
	zoltarUniverse: ZoltarUniverseSummary | undefined
	zoltarUniverseState: LoadableValueState
	onApproveZoltarForkRep: (amount?: bigint) => void
}

function getMigrationAmount(value: string) {
	return parseMigrationAmountInput(value, 'Migration amount')
}

function getMigrationOutcomeIndexes(value: string) {
	return parseBigIntListInput(value, 'Outcome indexes')
}

function getMigrationAmountSource(preparedRepBalance: bigint | undefined, repBalance: bigint | undefined) {
	return (preparedRepBalance ?? 0n) + (repBalance ?? 0n)
}

function getMigrationGuardMessage(accountAddress: Address | undefined, isMainnet: boolean, rootUniverse: ZoltarUniverseSummary | undefined, loadingZoltarForkAccess: boolean, hasForked: boolean, loadingZoltarUniverse: boolean, notForkedAction: string): string | undefined {
	const walletPresentation = getWalletPresentation({ accountAddress, isMainnet })
	if (walletPresentation !== undefined) return walletPresentation.detail
	if (rootUniverse === undefined) return loadingZoltarUniverse ? undefined : 'Refresh universe first.'
	if (loadingZoltarForkAccess) return undefined
	if (!hasForked) return notForkedAction
	return undefined
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
	zoltarMigrationResult,
	zoltarUniverse,
	zoltarUniverseState,
	onApproveZoltarForkRep,
}: ZoltarMigrationSectionProps) {
	const rootUniverse = zoltarUniverse
	const universeMissing = zoltarUniverseState === 'missing'
	const hasForked = rootUniverse?.hasForked === true
	const selectedOutcomeIndexes = useMemo(() => {
		try {
			return getMigrationOutcomeIndexes(zoltarMigrationForm.outcomeIndexes)
		} catch {
			return []
		}
	}, [zoltarMigrationForm.outcomeIndexes])
	const selectedOutcomeIndexSet = useMemo(() => new Set(selectedOutcomeIndexes.map(index => index.toString())), [selectedOutcomeIndexes])
	const migrationAmount = (() => {
		try {
			return getMigrationAmount(zoltarMigrationForm.amount)
		} catch {
			return undefined
		}
	})()
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
		const guard = getMigrationGuardMessage(accountAddress, isMainnet, rootUniverse, loadingZoltarForkAccess, hasForked, loadingZoltarUniverse, 'Fork Zoltar before preparing REP.')
		if (guard !== undefined) return guard
		if (!hasValidAmount || migrationAmount === undefined) return 'Enter an amount greater than zero.'
		return undefined
	})()
	const getAlreadyPreparedHint = () => {
		if (hasValidOutcomeIndexes && splitLimit === 0n) {
			return 'This amount is already fully split across the selected universes.'
		}
		return 'This amount is already in your migration balance. Split REP when ready.'
	}
	const prepareHintMessage = (() => {
		const guard = getMigrationGuardMessage(accountAddress, isMainnet, rootUniverse, loadingZoltarForkAccess, hasForked, loadingZoltarUniverse, 'Fork Zoltar before preparing REP.')
		if (guard !== undefined) return guard
		if (!hasValidAmount || migrationAmount === undefined) return 'Enter an amount greater than zero.'
		if (missingPreparationAmount === 0n) return getAlreadyPreparedHint()
		if (zoltarForkRepBalance === undefined || zoltarForkRepBalance < missingPreparationAmount) {
			return `Need ${formatCurrencyBalance(missingPreparationAmount)} more REP in this universe to prepare the selected amount.`
		}
		if (!hasSufficientAllowance) {
			return 'Waiting for approved REP amount before preparing the selected amount.'
		}
		return `Add ${formatCurrencyBalance(missingPreparationAmount)} REP to your migration balance from this universe, then split it across the selected universes.`
	})()
	const splitHintMessage = (() => {
		const guard = getMigrationGuardMessage(accountAddress, isMainnet, rootUniverse, loadingZoltarForkAccess, hasForked, loadingZoltarUniverse, 'Fork Zoltar before migrating REP.')
		if (guard !== undefined) return guard
		if (!hasValidAmount || migrationAmount === undefined) return 'Enter an amount greater than zero.'
		if (!hasPreparedBalance) {
			return `Add ${formatCurrencyBalance(missingPreparationAmount ?? 0n)} REP to your migration balance first, then split it across the selected universes.`
		}
		if (!hasValidOutcomeIndexes) return 'Select at least one outcome universe.'
		if (splitLimit === undefined) {
			return 'Loading outcome universe balances...'
		}
		if (splitLimit === 0n) {
			return 'This amount is already fully split across the selected universes.'
		}
		if (!hasSufficientSplitLimit) {
			return `The selected universes only have ${formatCurrencyBalance(splitLimit)} REP of room left for this amount. Reduce the amount or choose different universes.`
		}
		return 'Split the migration REP across the selected universes.'
	})()
	const migrationAmountHintMessage = (() => {
		const guard = getMigrationGuardMessage(accountAddress, isMainnet, rootUniverse, loadingZoltarForkAccess, hasForked, loadingZoltarUniverse, 'Fork Zoltar before migrating REP.')
		if (guard !== undefined) return guard
		if (!hasValidAmount || migrationAmount === undefined) return undefined
		if (amountExceedsAvailableRep) {
			return `You only have ${formatCurrencyBalance(totalRepAvailable)} REP available for migration in this universe (${formatCurrencyBalance(zoltarMigrationPreparedRepBalance ?? 0n)} in your migration balance and ${formatCurrencyBalance(zoltarForkRepBalance ?? 0n)} wallet REP).`
		}
		if (missingPreparationAmount === 0n) return getAlreadyPreparedHint()
		return `Add ${formatCurrencyBalance(missingPreparationAmount)} REP to your migration balance from this universe, then split it across the selected universes.`
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
				<EntityCard title='Migrate REP'>{presentation === undefined ? undefined : <StateHint presentation={presentation} />}</EntityCard>
				<ErrorNotice message={zoltarMigrationError} />
			</>
		)
	}

	return (
		<>
			<EntityCard title='Migrate REP'>
				<div className='workflow-metric-grid'>
					<MetricField label='Migration REP Balance'>
						<CurrencyValue loading={loadingZoltarForkAccess && zoltarMigrationPreparedRepBalance === undefined} value={zoltarMigrationPreparedRepBalance} suffix='REP' />
					</MetricField>
					<MetricField label='Universe'>
						{rootUniverse === undefined ? (
							<span className='loading-value' role='status' aria-label='Loading universe data'>
								<span className='spinner' aria-hidden='true' />
							</span>
						) : (
							<UniverseLink universeId={rootUniverse.universeId} />
						)}
					</MetricField>
				</div>
				<div className='form-grid'>
					<div className='field'>
						<span>Migration Amount</span>
						<div className='field-inline'>
							<FormInput className='field-inline-input' invalid={isMigrationAmountInvalid} inputMode='decimal' onInput={event => onZoltarMigrationFormChange({ amount: event.currentTarget.value })} placeholder='0.0' value={zoltarMigrationForm.amount} disabled={zoltarMigrationPending || !hasForked} />
							<button className='quiet field-inline-action' type='button' onClick={selectAllAmount} disabled={zoltarMigrationPending || !hasForked || migrationAmountSource <= 0n}>
								Max
							</button>
						</div>
						{migrationAmountHintMessage === undefined ? undefined : <p className='detail'>{migrationAmountHintMessage}</p>}
					</div>

					<TokenApprovalControl
						actionLabel='preparing the current amount'
						allowanceError={zoltarForkApproval.error}
						allowanceLoading={zoltarForkApproval.loading}
						approvedAmount={zoltarForkApproval.value}
						guardMessage={approvalGuardMessage}
						onApprove={amount => onApproveZoltarForkRep(amount)}
						pending={zoltarForkActiveAction === 'approve'}
						pendingLabel='Approving REP...'
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
						<button className='secondary' title={prepareHintMessage} onClick={onPrepareRepForMigration} disabled={!canPrepare}>
							{zoltarMigrationActiveAction === 'prepare' ? <LoadingText>Preparing REP...</LoadingText> : 'Prepare REP'}
						</button>
						<button className='primary' title={splitHintMessage} onClick={onMigrateInternalRep} disabled={!canSplit}>
							{zoltarMigrationActiveAction === 'split' ? <LoadingText>Splitting REP...</LoadingText> : 'Split REP'}
						</button>
					</div>
				</div>
			</EntityCard>

			{zoltarMigrationResult === undefined ? undefined : (
				<EntityCard title='Latest Migration Action' badge={<span className='badge muted'>{zoltarMigrationResult.action}</span>}>
					<div className='entity-metric-grid'>
						<MetricField className='entity-metric' label='Action'>
							{zoltarMigrationResult.action}
						</MetricField>
						<MetricField className='entity-metric' label='Amount'>
							<CurrencyValue value={zoltarMigrationResult.amount} suffix='REP' />
						</MetricField>
						<MetricField className='entity-metric' label='Outcome Indexes'>
							{zoltarMigrationResult.outcomeIndexes.length === 0 ? 'None' : zoltarMigrationResult.outcomeIndexes.join(', ')}
						</MetricField>
						<MetricField className='entity-metric' label='Transaction'>
							<TransactionHashLink hash={zoltarMigrationResult.hash} />
						</MetricField>
					</div>
				</EntityCard>
			)}

			<ErrorNotice message={zoltarMigrationError} />
		</>
	)
}
