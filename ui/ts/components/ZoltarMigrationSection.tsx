import { useMemo } from 'preact/hooks'
import type { Address } from 'viem'
import { EntityCard } from './EntityCard.js'
import { LoadableValue } from './LoadableValue.js'
import { UniverseLink } from './UniverseLink.js'
import { MigrationOutcomeUniversesSection } from './MigrationOutcomeUniversesSection.js'
import { formatCurrencyBalance } from '../lib/formatters.js'
import { parseBigIntListInput } from '../lib/inputs.js'
import { parseRepAmountInput as parseMigrationAmountInput } from '../lib/marketForm.js'
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
	zoltarMigrationError: string | undefined
	zoltarMigrationForm: ZoltarMigrationFormState
	zoltarMigrationPending: boolean
	zoltarMigrationPreparedRepBalance: bigint | undefined
	zoltarMigrationResult: ZoltarMigrationActionResult | undefined
	zoltarUniverse: ZoltarUniverseSummary | undefined
	zoltarUniverseMissing: boolean
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

function getMissingPreparationAmount(targetAmount: bigint, preparedRepBalance: bigint | undefined) {
	const currentPreparedBalance = preparedRepBalance ?? 0n
	return targetAmount > currentPreparedBalance ? targetAmount - currentPreparedBalance : 0n
}

export function ZoltarMigrationSection({ accountAddress, isMainnet, loadingZoltarForkAccess, loadingZoltarUniverse, onMigrateInternalRep, onPrepareRepForMigration, onZoltarMigrationFormChange, zoltarForkRepBalance, zoltarMigrationError, zoltarMigrationForm, zoltarMigrationPending, zoltarMigrationPreparedRepBalance, zoltarMigrationResult, zoltarUniverse, zoltarUniverseMissing }: ZoltarMigrationSectionProps) {
	const rootUniverse = zoltarUniverse
	const universeMissing = rootUniverse === undefined && zoltarUniverseMissing && !loadingZoltarUniverse
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
	const missingPreparationAmount = hasValidAmount ? getMissingPreparationAmount(migrationAmount, zoltarMigrationPreparedRepBalance) : undefined
	const totalRepAvailable = (zoltarMigrationPreparedRepBalance ?? 0n) + (zoltarForkRepBalance ?? 0n)
	const amountExceedsAvailableRep = hasValidAmount && migrationAmount !== undefined && migrationAmount > totalRepAvailable
	const hasEnoughRep = hasValidAmount && missingPreparationAmount !== undefined && zoltarForkRepBalance !== undefined && zoltarForkRepBalance >= missingPreparationAmount
	const hasPreparedBalance = hasValidAmount && zoltarMigrationPreparedRepBalance !== undefined && zoltarMigrationPreparedRepBalance >= migrationAmount
	const hasValidOutcomeIndexes = selectedOutcomeIndexes.length > 0
	const needsAdditionalPreparation = missingPreparationAmount !== undefined && missingPreparationAmount > 0n
	const canPrepare = accountAddress !== undefined && isMainnet && rootUniverse !== undefined && hasForked && !zoltarMigrationPending && hasValidAmount && needsAdditionalPreparation && hasEnoughRep
	const canSplit = accountAddress !== undefined && isMainnet && rootUniverse !== undefined && hasForked && !zoltarMigrationPending && hasValidAmount && hasPreparedBalance && hasValidOutcomeIndexes
	const migrationAmountSource = getMigrationAmountSource(zoltarMigrationPreparedRepBalance, zoltarForkRepBalance)
	const prepareHintMessage = (() => {
		if (accountAddress === undefined) return 'Connect a wallet before using REP migration actions.'
		if (!isMainnet) return 'Switch your wallet to Ethereum mainnet.'
		if (rootUniverse === undefined) return loadingZoltarUniverse ? 'Loading universe...' : 'Load the universe first.'
		if (loadingZoltarForkAccess) return 'Loading REP balances...'
		if (!hasForked) return 'Fork Zoltar before preparing REP.'
		if (!hasValidAmount || migrationAmount === undefined) return 'Enter an amount greater than zero.'
		if (missingPreparationAmount === undefined) return 'Enter a valid amount.'
		if (missingPreparationAmount === 0n) return 'This amount is already prepared. Split REP when ready.'
		if (zoltarForkRepBalance === undefined || zoltarForkRepBalance < missingPreparationAmount) {
			return `Need ${ formatCurrencyBalance(missingPreparationAmount) } more REP in this universe to prepare the selected amount.`
		}
		return `Prepare ${ formatCurrencyBalance(missingPreparationAmount) } REP from this universe, then split it across the selected universes.`
	})()
	const prepareButtonMessage = (() => {
		if (!canPrepare && migrationAmount !== undefined && migrationAmount <= 0n) return undefined
		return prepareHintMessage
	})()
	const splitHintMessage = (() => {
		if (accountAddress === undefined) return 'Connect a wallet before using REP migration actions.'
		if (!isMainnet) return 'Switch your wallet to Ethereum mainnet.'
		if (rootUniverse === undefined) return loadingZoltarUniverse ? 'Loading universe...' : 'Load the universe first.'
		if (loadingZoltarForkAccess) return 'Loading REP balances...'
		if (!hasForked) return 'Fork Zoltar before migrating REP.'
		if (!hasValidAmount || migrationAmount === undefined) return 'Enter an amount greater than zero.'
		if (!hasPreparedBalance) {
			return `Prepare ${ formatCurrencyBalance(missingPreparationAmount ?? 0n) } REP first, then split it across the selected universes.`
		}
		if (!hasValidOutcomeIndexes) return 'Select at least one outcome universe.'
		return 'Split the prepared REP across the selected universes.'
	})()
	const splitButtonMessage = (() => {
		if (!canSplit && migrationAmount !== undefined && migrationAmount <= 0n) return undefined
		return splitHintMessage
	})()
	const migrationAmountHintMessage = (() => {
		if (accountAddress === undefined) return 'Connect a wallet before using REP migration actions.'
		if (!isMainnet) return 'Switch your wallet to Ethereum mainnet.'
		if (rootUniverse === undefined) return loadingZoltarUniverse ? 'Loading universe...' : 'Load the universe first.'
		if (loadingZoltarForkAccess) return 'Loading REP balances...'
		if (!hasForked) return 'Fork Zoltar before migrating REP.'
		if (!hasValidAmount || migrationAmount === undefined) return undefined
		if (amountExceedsAvailableRep) {
			return `You only have ${ formatCurrencyBalance(totalRepAvailable) } REP available in this universe (${ formatCurrencyBalance(zoltarMigrationPreparedRepBalance) } prepared and ${ formatCurrencyBalance(zoltarForkRepBalance) } wallet REP).`
		}
		if (missingPreparationAmount === undefined) return 'Enter a valid amount.'
		if (missingPreparationAmount === 0n) return 'This amount is already prepared. Split REP when ready.'
		return `Prepare ${ formatCurrencyBalance(missingPreparationAmount) } REP from this universe, then split it across the selected universes.`
	})()
	const selectAllAmount = () => {
		onZoltarMigrationFormChange({ amount: formatCurrencyBalance(migrationAmountSource) })
	}
	const addNextOutcome = () => {
		const nextOutcome = rootUniverse?.childUniverses.find(child => !selectedOutcomeIndexSet.has(child.outcomeIndex.toString()))
		if (nextOutcome === undefined) return
		toggleOutcomeIndex(nextOutcome.outcomeIndex)
	}
	const toggleOutcomeIndex = (outcomeIndex: bigint) => {
		const currentIndexes = (() => {
			try {
				return getMigrationOutcomeIndexes(zoltarMigrationForm.outcomeIndexes)
			} catch {
				return []
			}
		})()
		const currentIndexStrings = new Set(currentIndexes.map(index => index.toString()))
		if (currentIndexStrings.has(outcomeIndex.toString())) {
			onZoltarMigrationFormChange({
				outcomeIndexes: currentIndexes
					.filter(index => index !== outcomeIndex)
					.map(index => index.toString())
					.join(', '),
			})
			return
		}
		onZoltarMigrationFormChange({ outcomeIndexes: [...currentIndexes, outcomeIndex].map(index => index.toString()).join(', ') })
	}

	if (universeMissing) {
		return (
			<>
				<EntityCard title="Migrate REP" badge={<span className="badge blocked">Missing</span>}>
					<p className="notice error">The universe does not exist.</p>
				</EntityCard>
				{zoltarMigrationError === undefined ? undefined : <p className="notice error">{zoltarMigrationError}</p>}
			</>
		)
	}

	return (
		<>
			<EntityCard title="Migrate REP">
				<div className="workflow-metric-grid">
					<div>
						<span className="metric-label">Your REP Balance</span>
						<strong>
							<LoadableValue loading={loadingZoltarForkAccess} placeholder="Loading...">
								{zoltarForkRepBalance === undefined ? 'Loading...' : `${ formatCurrencyBalance(zoltarForkRepBalance) } REP`}
							</LoadableValue>
						</strong>
					</div>
					<div>
						<span className="metric-label">Prepared REP Balance</span>
						<strong>
							<LoadableValue loading={loadingZoltarForkAccess} placeholder="Loading...">
								{zoltarMigrationPreparedRepBalance === undefined ? 'Loading...' : `${ formatCurrencyBalance(zoltarMigrationPreparedRepBalance) } REP`}
							</LoadableValue>
						</strong>
					</div>
					<div>
						<span className="metric-label">Universe</span>
						<strong>{rootUniverse === undefined ? 'Loading...' : <UniverseLink universeId={rootUniverse.universeId} />}</strong>
					</div>
				</div>

				<div className="form-grid">
					<div className="field">
						<div className="field-header">
							<span>Migration Amount</span>
							<button className="quiet" type="button" onClick={selectAllAmount} disabled={zoltarMigrationPending || !hasForked || migrationAmountSource <= 0n}>
								All
							</button>
						</div>
						<input inputMode="decimal" value={zoltarMigrationForm.amount} onInput={event => onZoltarMigrationFormChange({ amount: event.currentTarget.value })} placeholder="0.0" disabled={zoltarMigrationPending || !hasForked} />
						{migrationAmountHintMessage === undefined ? undefined : <p className="detail">{migrationAmountHintMessage}</p>}
					</div>

					{rootUniverse === undefined ? undefined : <MigrationOutcomeUniversesSection childUniverses={rootUniverse.childUniverses} disabled={zoltarMigrationPending} isScalarFork={rootUniverse.forkQuestionDetails?.marketType === 'scalar'} onAddNextOutcome={addNextOutcome} onToggleOutcomeIndex={toggleOutcomeIndex} selectedOutcomeIndexSet={selectedOutcomeIndexSet} />}

					<div className="actions">
						<button className="secondary" title={prepareButtonMessage} onClick={onPrepareRepForMigration} disabled={!canPrepare}>
							{zoltarMigrationPending ? 'Waiting...' : prepareButtonMessage === undefined ? 'Prepare REP' : `Prepare REP${ canPrepare ? '' : `: ${ prepareButtonMessage }` }`}
						</button>
						<button title={splitButtonMessage} onClick={onMigrateInternalRep} disabled={!canSplit}>
							{zoltarMigrationPending ? 'Waiting...' : splitButtonMessage === undefined ? 'Split REP' : `Split REP${ canSplit ? '' : `: ${ splitButtonMessage }` }`}
						</button>
					</div>

					<p className="detail">{prepareHintMessage}</p>

					{rootUniverse === undefined ? undefined : hasForked ? <p className="detail">Prepare REP first, then split it across the selected universes.</p> : <p className="detail">Fork Zoltar before migrating REP.</p>}
				</div>
			</EntityCard>

			{zoltarMigrationResult === undefined ? undefined : (
				<EntityCard title="Latest Migration Action" badge={<span className="badge muted">{zoltarMigrationResult.action}</span>}>
					<div className="entity-metric-grid">
						<div className="entity-metric">
							<span className="metric-label">Action</span>
							<strong>{zoltarMigrationResult.action}</strong>
						</div>
						<div className="entity-metric">
							<span className="metric-label">Amount</span>
							<strong>{formatCurrencyBalance(zoltarMigrationResult.amount)}</strong>
						</div>
						<div className="entity-metric">
							<span className="metric-label">Outcome Indexes</span>
							<strong>{zoltarMigrationResult.outcomeIndexes.length === 0 ? 'None' : zoltarMigrationResult.outcomeIndexes.join(', ')}</strong>
						</div>
						<div className="entity-metric">
							<span className="metric-label">Transaction</span>
							<strong>{zoltarMigrationResult.hash}</strong>
						</div>
					</div>
				</EntityCard>
			)}

			{zoltarMigrationError === undefined ? undefined : <p className="notice error">{zoltarMigrationError}</p>}
		</>
	)
}
