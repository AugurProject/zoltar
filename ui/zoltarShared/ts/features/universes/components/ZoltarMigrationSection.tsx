import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js'
import * as marketCopy from '../../../copy/market.js'
import * as zoltarCopy from '../../../copy/zoltar.js'
import { useEffect, useId, useMemo, useState } from 'preact/hooks'
import type { Address } from '@zoltar/core-shared/evm/ethereum'
import { CurrencyValue } from '@zoltar/ui-core-shared/components/CurrencyValue.js'
import { DataGrid } from '@zoltar/ui-core-shared/components/DataGrid.js'
import { EmptyState } from '@zoltar/ui-core-shared/components/EmptyState.js'
import { ErrorNotice } from '@zoltar/ui-core-shared/components/ErrorNotice.js'
import { FormInput } from '@zoltar/ui-core-shared/components/FormInput.js'
import { MetricField } from '@zoltar/ui-core-shared/components/MetricField.js'
import { ReadOnlyDetailAccordion } from '@zoltar/ui-core-shared/components/ReadOnlyDetailAccordion.js'
import { SectionBlock } from '@zoltar/ui-core-shared/components/SectionBlock.js'
import { RetryableNotice } from '@zoltar/ui-core-shared/components/RetryableNotice.js'
import { StateHint } from '@zoltar/ui-core-shared/components/StateHint.js'
import { TokenApprovalControl } from '@zoltar/ui-core-shared/components/TokenApprovalControl.js'
import { TransactionActionButton } from '@zoltar/ui-core-shared/components/TransactionActionButton.js'
import { TransactionReview } from '@zoltar/ui-core-shared/components/TransactionReview.js'
import { WorkflowSubsection } from '@zoltar/ui-core-shared/components/WorkflowSubsection.js'
import { WalletAssetControl } from '@zoltar/ui-core-shared/components/WalletAssetControl.js'
import { MigrationOutcomeUniversesSection } from './MigrationOutcomeUniversesSection.js'
import { getMigrationStepTitle, MigrationWizardProgress } from './MigrationWizardProgress.js'
import { assertNever } from '@zoltar/ui-core-shared/lib/assert.js'
import type { LoadableValueState } from '@zoltar/ui-core-shared/lib/loadState.js'
import { formatCurrencyBalance, formatCurrencyInputBalance } from '@zoltar/ui-core-shared/lib/formatters.js'
import type { TokenApprovalState } from '@zoltar/ui-core-shared/transactions/tokenApproval.js'
import { getUniversePresentation } from '@zoltar/ui-core-shared/lib/userCopy.js'
import { getMigrationGuardMessage } from '../lib/zoltarMigrationGuards.js'
import { deriveMigrationWizard, formatOutcomeList, migrationWizardStepIds, resolveMigrationWizardStep, toggleMigrationOutcome, type MigrationWizardStepId } from '../lib/migrationWizard.js'
import type { ZoltarMigrationFormState } from '../../../types/app.js'
import type { ZoltarUniverseSummary } from '@zoltar/ui-core-shared/types/contracts.js'
import { getWrongNetworkReason } from '@zoltar/ui-core-shared/wallet/network.js'
import { withActiveAppChainWalletBlocker } from '@zoltar/ui-core-shared/transactions/actionGuards.js'

function getChildDeploymentAvailabilityReason({ accountAddress, exists, hasForked, isOnActiveAppChain }: { accountAddress: Address | undefined; exists: boolean; hasForked: boolean; isOnActiveAppChain: boolean }) {
	if (accountAddress === undefined) return marketCopy.childDeploymentWalletRequiredReason
	if (!isOnActiveAppChain) return getWrongNetworkReason()
	if (!hasForked) return marketCopy.childUniversesNotForkedReason
	if (exists) return marketCopy.childUniverseDeployedReason
	return undefined
}

type ZoltarMigrationSectionProps = {
	universeBrowserHref?: string | undefined
	onScalarOutcomesChange?: ((indexes: readonly bigint[]) => void) | undefined
	onDeployChildUniverse: (outcomeIndex: bigint) => void
	pendingChildUniverseOutcomeIndex: bigint | undefined
	accountAddress: Address | undefined
	isOnActiveAppChain: boolean
	loadingZoltarForkAccess: boolean
	loadingZoltarUniverse: boolean
	onRetryMigrationBalances: () => void
	onRetryUniverse: () => void
	zoltarUniverseError?: string | undefined
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

function formatRep(value: bigint) {
	return `${formatCurrencyBalance(value)} ${commonCopy.rep}`
}

/**
 * REP migration wizard: choose outcomes → amount → approve → review.
 *
 * One `prepareAndSplitMigrationRep` transaction burns any wallet REP the amount needs into the
 * migration balance, then mints the amount in every chosen outcome universe (creating universes
 * that do not exist yet).
 */
export function ZoltarMigrationSection({
	universeBrowserHref,
	onScalarOutcomesChange,
	onDeployChildUniverse,
	pendingChildUniverseOutcomeIndex,
	accountAddress,
	isOnActiveAppChain,
	loadingZoltarForkAccess,
	loadingZoltarUniverse,
	onRetryMigrationBalances,
	onRetryUniverse,
	zoltarUniverseError,
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
	const hasForked = rootUniverse?.hasForked === true
	const isPreview = rootUniverse !== undefined && !hasForked
	const requiresApproval = rootUniverse?.reputationTokenKind !== 'child'
	const tokenSymbol = rootUniverse?.reputationTokenSymbol ?? commonCopy.rep
	const wizard = useMemo(
		() =>
			deriveMigrationWizard({
				amountInput: zoltarMigrationForm.amount,
				approvalLoading: zoltarForkApproval.loading,
				approvedAttoRep: zoltarForkApproval.value,
				balancesLoading: loadingZoltarForkAccess,
				childHeldAttoRep: zoltarMigrationChildRepBalancesAttoRep,
				childMigratedAttoRep: zoltarMigrationChildSplitAmountsAttoRep,
				childUniverses: hasForked ? (rootUniverse?.childUniverses ?? []) : [],
				migrationBalanceAttoRep: zoltarMigrationPreparedRepBalanceAttoRep,
				requiresApproval,
				selectedOutcomeIndexes: zoltarMigrationForm.outcomeIndexes,
				walletRepAttoRep: zoltarForkRepBalanceAttoRep,
			}),
		[
			hasForked,
			loadingZoltarForkAccess,
			requiresApproval,
			rootUniverse?.childUniverses,
			zoltarForkApproval.loading,
			zoltarForkApproval.value,
			zoltarForkRepBalanceAttoRep,
			zoltarMigrationChildRepBalancesAttoRep,
			zoltarMigrationChildSplitAmountsAttoRep,
			zoltarMigrationForm.amount,
			zoltarMigrationForm.outcomeIndexes,
			zoltarMigrationPreparedRepBalanceAttoRep,
		],
	)
	const [requestedStepId, setRequestedStepId] = useState<MigrationWizardStepId>('outcomes')
	const currentStepId = isPreview ? 'outcomes' : resolveMigrationWizardStep(requestedStepId, wizard.reachableStepId)
	// When balances or input change so that the open step is no longer reachable, stay on the earlier
	// step instead of jumping forward again once it becomes reachable.
	useEffect(() => {
		if (currentStepId !== requestedStepId) setRequestedStepId(currentStepId)
	}, [currentStepId, requestedStepId])
	const navigationHintId = useId()
	const previewReasonId = useId()

	// A retained overview summary is useful context, but its omitted children are not an empty migration.
	if (rootUniverse?.relatedUniversesLoaded === false) {
		if (loadingZoltarUniverse || zoltarUniverseError === undefined) return <StateHint announcement='polite' presentation={{ key: 'loading', badgeLabel: commonCopy.loading, badgeTone: 'loading', detail: commonCopy.loadingUniverseDetails, detailIsLoading: true }} />
		return <RetryableNotice message={zoltarUniverseError} onRetry={onRetryUniverse} retryLabel={commonCopy.retry} />
	}

	if (zoltarUniverseState === 'missing') {
		const presentation = getUniversePresentation(zoltarUniverseState)
		return (
			<>
				{presentation === undefined ? undefined : <StateHint presentation={presentation} title={zoltarCopy.migrateRep} />}
				<ErrorNotice message={zoltarMigrationError} />
			</>
		)
	}

	const guardMessage = getMigrationGuardMessage(accountAddress, isOnActiveAppChain, rootUniverse, loadingZoltarForkAccess, hasForked, loadingZoltarUniverse, '')
	const currentStepIndex = migrationWizardStepIds.indexOf(currentStepId)
	const currentStep = wizard.steps[currentStepIndex]
	const currentStepSatisfied = currentStep?.status === 'complete' || currentStep?.status === 'notNeeded' || currentStep?.status === 'ready'
	const nextStepId = wizard.steps.slice(currentStepIndex + 1).find(step => step.status !== 'notNeeded')?.id
	const previousStepId = wizard.steps
		.slice(0, currentStepIndex)
		.filter(step => step.status !== 'notNeeded')
		.at(-1)?.id
	const hasUnreadBalance =
		wizard.outcomes.some(outcome => outcome.exists && (outcome.alreadyMigratedAttoRep === undefined || outcome.heldAttoRep === undefined)) ||
		zoltarMigrationPreparedRepBalanceAttoRep === undefined ||
		(wizard.walletRepToBurnAttoRep !== undefined && wizard.walletRepToBurnAttoRep > 0n && zoltarForkRepBalanceAttoRep === undefined)
	const showRetry = accountAddress !== undefined && hasForked && !loadingZoltarForkAccess && !loadingZoltarUniverse && hasUnreadBalance
	const selectedOutcomeNames = formatOutcomeList(wizard.selectedOutcomes)
	const amount = wizard.amountAttoRep
	const summaries: Partial<Record<MigrationWizardStepId, string>> = {
		outcomes: selectedOutcomeNames,
		...(amount === undefined ? {} : { amount: formatRep(amount) }),
	}
	const migrateReason = (() => {
		if (guardMessage !== undefined) return guardMessage
		if (!hasForked) return zoltarCopy.migrationForkRequired
		if (loadingZoltarUniverse || loadingZoltarForkAccess) return zoltarCopy.outcomeBalancesLoading
		return wizard.steps[3]?.reason
	})()
	const canMigrate = migrateReason === undefined && isOnActiveAppChain && wizard.steps[3]?.status === 'ready' && !zoltarMigrationPending && wizard.walletRepToBurnAttoRep !== undefined
	const migrateHint = isOnActiveAppChain ? migrateReason : getWrongNetworkReason()
	const migrateAvailability = withActiveAppChainWalletBlocker({ disabled: !canMigrate, reason: migrateHint }, { accountAddress, isOnActiveAppChain })
	// A wallet-blocked migration offers its connect or switch fix under the button instead of repeating the reason in the hint line.
	const migrateWalletBlocked = migrateAvailability.walletBlocker !== undefined
	// One reason line beside the forward action. The approval control states its own requirement, so the approve step does not repeat it.
	const navigationHint = (() => {
		// The preview panel states the fork requirement itself, so the hint line does not repeat it.
		if (isPreview) return undefined
		if (currentStepId === 'review') return migrateWalletBlocked ? undefined : migrateHint
		if (currentStepSatisfied || (currentStepId === 'approve' && currentStep?.status === 'incomplete')) return undefined
		return accountAddress === undefined && currentStep?.reason === zoltarCopy.migrationBalancesReadFailed ? zoltarCopy.migrationWalletBalancesReason : currentStep?.reason
	})()
	let continueDescriptionId: string | undefined
	if (isPreview) continueDescriptionId = previewReasonId
	else if (!currentStepSatisfied && navigationHint !== undefined) continueDescriptionId = navigationHintId
	const heldOutcomes = wizard.outcomes.filter(outcome => outcome.exists && (outcome.heldAttoRep ?? 0n) > 0n)
	const deploymentDisabledReason = (outcome: { exists: boolean }) => getChildDeploymentAvailabilityReason({ accountAddress, exists: outcome.exists, hasForked, isOnActiveAppChain })
	const retryButton = showRetry ? (
		<button className='quiet' type='button' onClick={onRetryMigrationBalances} disabled={zoltarMigrationPending || !isOnActiveAppChain}>
			{commonCopy.retry}
		</button>
	) : undefined

	const renderStepBody = () => {
		if (isPreview)
			return (
				<p className='detail' id={previewReasonId}>
					{zoltarCopy.migrationForkRequired}
				</p>
			)
		switch (currentStepId) {
			case 'outcomes':
				return (
					<>
						{zoltarUniverseError !== undefined && !loadingZoltarUniverse ? <RetryableNotice message={zoltarUniverseError} onRetry={onRetryUniverse} retryLabel={commonCopy.retry} /> : undefined}
						<p className='detail'>{zoltarCopy.selectOutcomesDetail}</p>
						<MigrationOutcomeUniversesSection
							universeBrowserHref={universeBrowserHref}
							key={rootUniverse?.universeId.toString()}
							selectedOutcomeIndexes={zoltarMigrationForm.outcomeIndexes}
							onScalarOutcomesChange={onScalarOutcomesChange}
							scalarQuestion={rootUniverse?.forkQuestionDetails?.marketType === 'scalar' ? rootUniverse.forkQuestionDetails : undefined}
							deploymentDisabledReason={deploymentDisabledReason}
							disabled={zoltarMigrationPending}
							loadingBalances={loadingZoltarForkAccess}
							onDeployChildUniverse={onDeployChildUniverse}
							onToggleOutcomeIndex={outcomeIndex => onZoltarMigrationFormChange({ outcomeIndexes: toggleMigrationOutcome(zoltarMigrationForm.outcomeIndexes, outcomeIndex) })}
							outcomes={wizard.outcomes}
							pendingOutcomeIndex={pendingChildUniverseOutcomeIndex}
						/>
					</>
				)
			case 'amount': {
				const maxAmount = wizard.maxAmountAttoRep
				const amountStep = wizard.steps[1]
				// The step reason is shown once, next to Continue; the input only points at it.
				const amountInvalid = amountStep?.status === 'blocked' || (amountStep?.reason === zoltarCopy.migrationAmountInvalid && zoltarMigrationForm.amount.trim() !== '')
				const showBreakdown = amountStep?.status === 'complete'
				return (
					<>
						<div className='field'>
							<label htmlFor='zoltar-migration-amount'>{zoltarCopy.migrationAmountLabel}</label>
							<div className='field-inline'>
								<FormInput
									aria-describedby={amountInvalid ? navigationHintId : undefined}
									id='zoltar-migration-amount'
									className='field-inline-input'
									invalid={amountInvalid}
									inputMode='decimal'
									onInput={event => onZoltarMigrationFormChange({ amount: event.currentTarget.value })}
									placeholder={commonCopy.zeroDecimalPlaceholder}
									value={zoltarMigrationForm.amount}
									disabled={zoltarMigrationPending}
								/>
								<button className='quiet field-inline-action' type='button' onClick={() => (maxAmount === undefined ? undefined : onZoltarMigrationFormChange({ amount: formatCurrencyInputBalance(maxAmount) }))} disabled={zoltarMigrationPending || maxAmount === undefined || maxAmount <= 0n}>
									{maxAmount === undefined ? commonCopy.max : zoltarCopy.formatUseAllRep(formatCurrencyBalance(maxAmount))}
								</button>
							</div>
							{zoltarMigrationPreparedRepBalanceAttoRep === undefined || zoltarMigrationPreparedRepBalanceAttoRep === 0n ? undefined : <p className='detail'>{zoltarCopy.migrationBalanceExplainer}</p>}
						</div>
						<DataGrid dense>
							<MetricField label={zoltarCopy.migrationFromBalance}>
								<CurrencyValue value={showBreakdown ? wizard.fromMigrationBalanceAttoRep : undefined} suffix={commonCopy.rep} />
							</MetricField>
							<MetricField label={zoltarCopy.migrationFromWallet}>
								<CurrencyValue value={showBreakdown ? wizard.walletRepToBurnAttoRep : undefined} suffix={commonCopy.rep} />
							</MetricField>
						</DataGrid>
					</>
				)
			}
			case 'approve': {
				const approveStep = wizard.steps[2]
				if (approveStep?.status === 'notNeeded') return <p className='detail'>{approveStep.reason}</p>
				return (
					<TokenApprovalControl
						actionLabel={zoltarCopy.migrationApprovalActionLabel}
						allowanceError={zoltarForkApproval.error}
						allowanceLoading={zoltarForkApproval.loading}
						approvedAmount={zoltarForkApproval.value}
						disabled={!isOnActiveAppChain || wizard.walletRepToBurnAttoRep === undefined}
						guardMessage={guardMessage}
						onApprove={approvalAmount => onApproveZoltarForkRep(approvalAmount)}
						pending={zoltarForkActiveAction === 'approve'}
						pendingLabel={commonCopy.approvingRep}
						requiredAmount={wizard.walletRepToBurnAttoRep}
						resetKey={`${rootUniverse?.reputationToken ?? ''}:${rootUniverse?.universeId.toString() ?? ''}:${(wizard.walletRepToBurnAttoRep ?? 0n).toString()}`}
						tokenSymbol={tokenSymbol}
						tokenUnits={18}
					/>
				)
			}
			case 'review':
				return (
					<>
						<p className='migration-review-summary'>{amount === undefined ? undefined : zoltarCopy.formatMigrationSummary(formatCurrencyBalance(amount), selectedOutcomeNames)}</p>
						<TransactionReview
							variant='inline'
							primary={[
								{ label: zoltarCopy.migrationFromBalance, value: <CurrencyValue value={wizard.fromMigrationBalanceAttoRep} suffix={commonCopy.rep} /> },
								{ label: zoltarCopy.migrationFromWallet, value: <CurrencyValue value={wizard.walletRepToBurnAttoRep} suffix={commonCopy.rep} /> },
							]}
							risks={[zoltarCopy.migrationIrreversible, zoltarCopy.migrationMintsPerOutcome]}
						/>
					</>
				)
			default:
				return assertNever(currentStepId)
		}
	}

	return (
		<>
			<SectionBlock variant='plain'>
				<p className='detail'>{zoltarCopy.migrationIntro}</p>
				<DataGrid>
					<MetricField label={zoltarCopy.walletRep}>
						<CurrencyValue loading={loadingZoltarForkAccess && zoltarForkRepBalanceAttoRep === undefined} value={zoltarForkRepBalanceAttoRep} suffix={commonCopy.rep} />
					</MetricField>
					<MetricField label={zoltarCopy.migrationBalance}>
						<CurrencyValue loading={loadingZoltarForkAccess && zoltarMigrationPreparedRepBalanceAttoRep === undefined} value={zoltarMigrationPreparedRepBalanceAttoRep} suffix={commonCopy.rep} />
					</MetricField>
				</DataGrid>
				{!isPreview && wizard.migrationComplete ? (
					<EmptyState detail={zoltarCopy.migrationCompleteDetail} title={zoltarCopy.migrationCompleteTitle} />
				) : (
					<div className='migration-wizard'>
						<MigrationWizardProgress
							currentStepId={currentStepId}
							disabled={isPreview || zoltarMigrationPending}
							onSelectStep={setRequestedStepId}
							reachableStepId={wizard.reachableStepId}
							steps={isPreview ? wizard.steps.map(step => ({ ...step, status: 'blocked' as const, reason: zoltarCopy.migrationForkRequired })) : wizard.steps}
							summaries={isPreview ? {} : summaries}
						/>
						<WorkflowSubsection className='migration-wizard-panel' title={getMigrationStepTitle(currentStepId)}>
							{renderStepBody()}
							<div className='migration-wizard-nav'>
								{previousStepId === undefined ? undefined : (
									<button className='quiet' type='button' onClick={() => setRequestedStepId(previousStepId)} disabled={zoltarMigrationPending}>
										{zoltarCopy.migrationBack}
									</button>
								)}
								{retryButton}
								<p aria-live='polite' className='detail migration-wizard-nav-hint' id={navigationHintId}>
									{navigationHint}
								</p>
								{nextStepId === undefined ? (
									<TransactionActionButton
										idleLabel={zoltarCopy.migrateRep}
										pendingLabel={zoltarCopy.migratingRepPending}
										onClick={() => onMigrateInternalRep(wizard.walletRepToBurnAttoRep ?? 0n)}
										pending={zoltarMigrationActiveAction === 'split'}
										availability={migrateAvailability}
										disabledReasonElementId={migrateWalletBlocked ? undefined : navigationHintId}
										showDisabledReason={migrateWalletBlocked}
									/>
								) : (
									<button aria-describedby={continueDescriptionId} className='primary' type='button' onClick={() => setRequestedStepId(nextStepId)} disabled={isPreview || zoltarMigrationPending || !currentStepSatisfied}>
										{zoltarCopy.migrationContinue}
									</button>
								)}
							</div>
						</WorkflowSubsection>
					</div>
				)}
				{heldOutcomes.length === 0 ? undefined : (
					<ReadOnlyDetailAccordion title={zoltarCopy.addChildRepToWalletTitle}>
						<DataGrid dense>
							{heldOutcomes.map(outcome => {
								const child = rootUniverse?.childUniverses.find(candidate => candidate.universeId === outcome.universeId)
								if (child === undefined) return undefined
								return (
									<MetricField key={outcome.universeId.toString()} label={outcome.label}>
										<WalletAssetControl accountAddress={accountAddress} address={child.reputationToken} isSupportedChain={isOnActiveAppChain} tokenLabel={`${outcome.label} ${child.reputationTokenSymbol ?? commonCopy.rep}`} />
									</MetricField>
								)
							})}
						</DataGrid>
					</ReadOnlyDetailAccordion>
				)}
			</SectionBlock>

			<ErrorNotice message={zoltarMigrationError} />
		</>
	)
}
