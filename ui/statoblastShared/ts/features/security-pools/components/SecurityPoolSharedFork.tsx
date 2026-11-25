import { getBrowserStorage } from '@zoltar/ui-core-shared/lib/browserStorage.js'
import { sameAddress } from '@zoltar/ui-core-shared/lib/address.js'
import { formatScalarOutcomeLabel, getScalarOutcomeIndex, getScalarOutcomeIndexDescriptor } from '@zoltar/ui-core-shared/lib/scalarOutcome.js'
import { ScalarOutcomePicker } from '@zoltar/ui-core-shared/components/ScalarOutcomePicker.js'
import type { ComponentChildren } from 'preact'
import type { MarketDetails, ZoltarChildUniverseSummary } from '@zoltar/ui-core-shared/types/contracts.js'
import * as pageCopy from '../../../copy/forkRecovery.js'
import { addToCalendar, deadlineChecking } from '../../../copy/questionPage.js'
import { buildStatoblastCalendarEvent, downloadStatoblastCalendarEvent, LAST_CALENDAR_START } from '../../reporting/lib/escalationReminder.js'
import { useOldActionDataNotice, useStatoblastRefreshError, type RegisterStatoblastPageRefresh } from '../../useStatoblastPageRefresh.js'
import { tryAgain } from '../../../copy/securityPoolPage.js'
import { useEffect, useRef, useState } from 'preact/hooks'
import { SectionBlock } from '@zoltar/ui-core-shared/components/SectionBlock.js'
import { MetricGrid } from '@zoltar/ui-core-shared/components/MetricGrid.js'
import { MetricField } from '@zoltar/ui-core-shared/components/MetricField.js'
import { UserMessage } from '@zoltar/ui-core-shared/components/UserMessage.js'
import { RetryableNotice } from '@zoltar/ui-core-shared/components/RetryableNotice.js'
import { ActionLauncherButton } from '@zoltar/ui-core-shared/components/ActionLauncherButton.js'
import { formatDuration, formatTimestamp } from '@zoltar/ui-core-shared/lib/formatters.js'
import { formatQuestionIdHex } from '@zoltar/ui-core-shared/lib/questionId.js'
import { formatUniverseIdHex } from '@zoltar/ui-core-shared/lib/universeLabels.js'
import { IdentifierValue } from '@zoltar/ui-core-shared/components/IdentifierValue.js'
import { OnChainText } from '@zoltar/ui-core-shared/components/OnChainText.js'
import { OutcomeIdentity } from '@zoltar/ui-core-shared/components/OutcomeIdentity.js'
import { SecurityPoolButton, SecurityPoolInput } from './SecurityPoolControls.js'
import { useSecurityPoolSharedFork, type SecurityPoolSharedForkParameters } from '../hooks/useSecurityPoolSharedFork.js'
import { useSecurityPoolDeadline } from '../hooks/useSecurityPoolDeadline.js'
import { SecurityPoolShareRecovery } from './SecurityPoolShareRecovery.js'
import { SecurityPoolForkDiagram } from './SecurityPoolForkDiagram.js'
import { SecurityPoolPriceReport } from './SecurityPoolPriceReport.js'
import { branchPriceTarget } from '../hooks/useSecurityPoolPrice.js'
import { SecurityPoolRepairAuction } from './SecurityPoolRepairAuction.js'
import * as copy from '../../../copy/securityPoolSharedFork.js'
import { connect } from '../../../copy/securityPool.js'
import * as common from '@zoltar/ui-core-shared/copy/common.js'

export type ForkQuestionRead = { loading: boolean; error: string | undefined; retry: () => void }

export function SecurityPoolSharedFork({
	redesigned = false,
	forkQuestion,
	forkQuestionRead,
	onBranchCommitted,
	childUniverses,
	forkRecapitalizationDeadline,
	autoRefresh,
	registerPageRefresh,
	...parameters
}: SecurityPoolSharedForkParameters & {
	redesigned?: boolean
	forkQuestion?: MarketDetails | undefined
	forkQuestionRead?: ForkQuestionRead | undefined
	onBranchCommitted?: ((committed: boolean) => void) | undefined
	childUniverses?: readonly Pick<ZoltarChildUniverseSummary, 'outcomeIndex' | 'universeId' | 'exists'>[] | undefined
	forkRecapitalizationDeadline?: bigint | undefined
	autoRefresh?: boolean | undefined
	registerPageRefresh?: RegisterStatoblastPageRefresh | undefined
}) {
	const model = useSecurityPoolSharedFork(parameters)
	const state = model.state
	const display = model.displayedState
	const refreshError = useStatoblastRefreshError(model.forkError, redesigned ? model.displayedAt : undefined)
	const actionDataNotice = useOldActionDataNotice(redesigned ? model.displayedAt : undefined)
	const branch = display?.branch
	const shownPool = parameters.presentationSnapshot ?? parameters.snapshot
	const branchDone = display?.choice.recorded === true
	const choiceAt = display?.choiceDeadline ?? shownPool?.forkChoiceDeadline
	const activationAt = display?.activationDeadline ?? forkRecapitalizationDeadline
	const choiceTime = display?.timestamp ?? shownPool?.timestamp
	const forkTime = display?.forkTime ?? shownPool?.forkTime ?? 0n
	const nextDeadline = forkTime === 0n || choiceTime === undefined ? undefined : [choiceAt, activationAt].find(deadline => deadline !== undefined && deadline > choiceTime)
	const check = useSecurityPoolDeadline({
		scope: `${shownPool?.chainId}:${shownPool?.securityPool}:${shownPool?.owner}:${model.sourceInput}`,
		deadline: redesigned ? nextDeadline : undefined,
		timestamp: choiceTime,
		readAt: model.displayedAt,
		reading: model.loading,
		refresh: model.retryFork,
	})
	const choiceChecking = choiceAt !== undefined && choiceTime !== undefined && choiceTime < choiceAt && check.checking
	const approximateTime = check.now
	const activationChecking = redesigned && activationAt !== undefined && choiceTime !== undefined && choiceTime < activationAt && ((approximateTime !== undefined && approximateTime >= activationAt) || (nextDeadline === activationAt && check.checking))
	const canChooseByDeadline = !choiceChecking && choiceAt !== undefined && approximateTime !== undefined && approximateTime < choiceAt
	const choiceDate = choiceAt === undefined ? undefined : formatTimestamp(choiceAt)
	let choiceTitle = pageCopy.choiceExpired
	if (choiceChecking) choiceTitle = deadlineChecking
	else if (canChooseByDeadline && choiceDate !== undefined) choiceTitle = pageCopy.chooseBy(choiceDate)
	const showReminder = !branchDone && canChooseByDeadline && choiceAt !== undefined && choiceAt <= LAST_CALENDAR_START
	const addReminder = () => {
		const source = display ?? shownPool
		if (source === undefined || choiceAt === undefined || !showReminder) return
		const event = buildStatoblastCalendarEvent({ id: `${source.securityPool}-${source.universeId}-${choiceAt}`, generatedAt: BigInt(Math.floor(Date.now() / 1000)), startsAt: choiceAt, title: pageCopy.branchChoiceCalendar, description: location.href })
		downloadStatoblastCalendarEvent(event, pageCopy.branchChoiceCalendarFile)
	}
	const disabled = parameters.actions.busy !== undefined
	const [pricedBranch, setPricedBranch] = useState<bigint>()
	const [finalizedAuctionBranch, setFinalizedAuctionBranch] = useState<bigint>()
	const openedPositionKey = display === undefined || branch === undefined ? undefined : `statoblast:opened-branch-position:${display.chainId}:${display.securityPool}:${display.owner}:${branch.universeId}`
	const rememberOpen = () => {
		if (openedPositionKey !== undefined && model.openReason === undefined) {
			try {
				getBrowserStorage('localStorage')?.setItem(openedPositionKey, 'yes')
			} catch (error) {
				if (!(error instanceof DOMException)) throw error
			}
		}
		model.open()
	}
	let opened = false
	if (openedPositionKey !== undefined) {
		try {
			opened = getBrowserStorage('localStorage')?.getItem(openedPositionKey) === 'yes'
		} catch (error) {
			if (!(error instanceof DOMException)) throw error
		}
	}
	const priceSection = useRef<HTMLDivElement>(null)
	const auctionSection = useRef<HTMLDivElement>(null)
	const openSection = (section: HTMLDivElement | null) => {
		section?.scrollIntoView({ block: 'start' })
		section?.focus({ preventScroll: true })
	}
	const priceTarget = branchPriceTarget(state)
	const accepted = branch !== undefined && pricedBranch === branch.universeId
	const finalized = branch !== undefined && finalizedAuctionBranch === branch.universeId
	const migrationStarted = branch?.started === true || model.savedBranch?.started === true
	const walletReason = parameters.bidder === undefined ? connect : undefined
	const priceReason = walletReason ?? (migrationStarted ? undefined : pageCopy.branchPriceLockedReason)
	let auctionReason = walletReason
	if (auctionReason === undefined) {
		if (!migrationStarted) auctionReason = pageCopy.auctionLockedReason
		else if (!accepted && !finalized) auctionReason = branch?.ready ? pageCopy.auctionClosed : pageCopy.auctionNeedsPrice
	}
	const [confirmedChoice, setConfirmedChoice] = useState(false)
	useEffect(() => setConfirmedChoice(false), [model.outcomeInput, model.sourceInput])
	useEffect(() => {
		if (state !== undefined && parameters.bidder !== undefined && sameAddress(state.owner, parameters.bidder)) onBranchCommitted?.(state.choice.recorded)
	}, [state?.choice.recorded, state?.owner, parameters.bidder, onBranchCommitted])
	const chooseReason = (choiceChecking ? deadlineChecking : undefined) ?? model.chooseReason ?? (redesigned && !confirmedChoice ? pageCopy.branchConfirmationReason : undefined)
	const committedMessage = copy.chosen(state?.choice.outcomeIndex ?? 0n)
	let branchState = copy.branchStates.choose
	if (branch !== undefined) {
		branchState = copy.branchStates.unprepared
		if (branch.prepared) branchState = copy.branchStates.chosen
		if (branch.started) branchState = copy.branchStates.waiting
		if (branch.ready) branchState = copy.branchStates.active
	}
	const prepareBranch = <SecurityPoolButton model={parameters.actions} action='prepareSecurityPoolFork' label={copy.prepareBranch} pendingLabel={copy.preparingBranch} reason={model.prepareBranchReason} onClick={model.prepareBranch} />
	const chooseBranch = <SecurityPoolButton model={parameters.actions} action='chooseSecurityPoolFork' label={copy.choice} pendingLabel={copy.choosing} reason={chooseReason} onClick={model.choose} />
	const startBranch = <SecurityPoolButton model={parameters.actions} action='startSecurityPoolFork' label={copy.start} pendingLabel={copy.starting} reason={model.startReason} onClick={model.start} />
	const activateBranch = <SecurityPoolButton model={parameters.actions} action='finalizeSecurityPoolFork' label={copy.finalize} pendingLabel={copy.finalizing} reason={model.finalizeReason} onClick={model.finalize} />
	const openBranch = <ActionLauncherButton tone='secondary' idleLabel={copy.open} pendingLabel={copy.loading} availability={{ disabled: disabled || model.openReason !== undefined, reason: disabled ? copy.busy : model.openReason }} onClick={rememberOpen} />
	const pricePanel =
		!redesigned || migrationStarted ? (
			<div ref={priceSection} tabIndex={-1} className={redesigned ? 'statoblast-fork-step-body' : undefined}>
				<SecurityPoolPriceReport
					redesigned={redesigned}
					hideReportingDeadline={redesigned}
					scope='branch'
					target={priceTarget}
					displayTarget={priceTarget ?? model.savedBranch}
					actions={parameters.actions}
					bidder={parameters.bidder}
					returnFundsOnly={activationChecking || (redesigned && activationAt !== undefined && choiceTime !== undefined && choiceTime >= activationAt)}
					referencePrice={shownPool?.acceptedPrice}
					onPriceAccepted={setPricedBranch}
					autoRefresh={autoRefresh ?? false}
					registerPageRefresh={registerPageRefresh}
				/>
			</div>
		) : undefined
	const auctionPanel =
		!redesigned || migrationStarted ? (
			<div ref={auctionSection} tabIndex={-1} className={redesigned ? 'statoblast-fork-step-body' : undefined} hidden={redesigned && auctionReason !== undefined}>
				<SecurityPoolRepairAuction fork={state} savedBranch={model.savedBranch} actions={parameters.actions} bidder={parameters.bidder} openVault={parameters.openVault} onAuctionFinalized={setFinalizedAuctionBranch} sharedDeadline={redesigned} sharedDeadlineChecking={activationChecking} />
			</div>
		) : undefined
	return (
		<div className='route-view-flow'>
			{redesigned && forkTime > 0n && !branchDone && choiceAt !== undefined && choiceAt > 0n && choiceDate !== undefined && (
				<div className='statoblast-fork-choice-deadline'>
					<div>
						<strong>{choiceTitle}</strong>
						{canChooseByDeadline && <span className='statoblast-fork-choice-countdown'>{pageCopy.choiceTimeLeft(formatDuration(choiceAt - approximateTime))}</span>}
						<p>{canChooseByDeadline || choiceChecking ? pageCopy.choiceForfeit : pageCopy.noChoiceAfterDeadline}</p>
					</div>
					{showReminder && (
						<button className='secondary' type='button' onClick={addReminder}>
							{addToCalendar}
						</button>
					)}
				</div>
			)}
			<SectionBlock title={redesigned ? pageCopy.branchMigration : copy.title} description={redesigned ? pageCopy.branchDefinition : copy.description}>
				{redesigned && <SecurityPoolForkDiagram state={display} snapshot={shownPool} question={forkQuestion} outcomeInput={model.outcomeInput} childUniverses={childUniverses} />}
				{redesigned ? (
					<BranchChoices question={forkQuestion} read={forkQuestionRead} value={model.outcomeInput} onChange={model.setOutcome} disabled={disabled || branchDone} />
				) : (
					<MetricGrid>
						<SecurityPoolInput label={copy.universe} value={model.sourceInput} onChange={model.setSource} disabled={disabled} />
						<SecurityPoolInput label={copy.outcome} hint={copy.outcomeHint} value={model.outcomeInput} onChange={model.setOutcome} disabled={disabled} />
					</MetricGrid>
				)}
				<RetryableNotice message={refreshError ?? (check.failed ? deadlineChecking : undefined)} retryLabel={tryAgain} onRetry={check.failed ? check.retry : model.retryFork} />
				{state?.forkTime === 0n ? <UserMessage detail={copy.noFork} /> : undefined}
				{model.outcome?.outcomeLabel === undefined ? undefined : (
					<UserMessage
						detail={
							<>
								<OnChainText text={model.outcome.questionTitle} />
								{copy.questionOutcomeSeparator}
								<OnChainText text={model.outcome.outcomeLabel} />
								{redesigned || branch === undefined ? undefined : <OutcomeIdentity label={model.outcome.outcomeLabel} outcomeIndex={branch.outcomeIndex} />}
							</>
						}
					/>
				)}
				{redesigned ? (
					<>
						{activationAt !== undefined && activationAt > 0n && (
							<div className='statoblast-branch-recapitalization'>
								<strong>{pageCopy.recapitalizationDeadline}</strong> <span>{formatTimestamp(activationAt)}</span>
								{activationChecking && <UserMessage announcement='polite' detail={deadlineChecking} />}
								<p className='detail'>{pageCopy.recapitalizationHint}</p>
							</div>
						)}
						<ol aria-label={pageCopy.branchSteps} className='statoblast-fork-steps statoblast-fork-workflow'>
							<ForkStep title={pageCopy.prepareSelectedBranch} done={branch?.prepared === true} actionDataNotice={actionDataNotice} action={prepareBranch} />
							<ForkStep title={copy.choice} done={branchDone} actionDataNotice={actionDataNotice} action={chooseBranch}>
								{!branchDone && (
									<label className='statoblast-choice-confirmation'>
										<input type='checkbox' checked={confirmedChoice} disabled={disabled || !canChooseByDeadline || state?.branch === undefined} onChange={event => setConfirmedChoice(event.currentTarget.checked)} />
										{pageCopy.branchConfirmation}
									</label>
								)}
							</ForkStep>
							<ForkStep title={copy.start} done={branch?.started === true} detail={pageCopy.pendingSharedStep} actionDataNotice={actionDataNotice} action={startBranch} />
							<ForkStep
								title={pageCopy.branchRepPrice}
								body={pricePanel}
								done={accepted}
								detail={branch?.ready && !accepted ? pageCopy.branchPriceClosed : pageCopy.branchPriceConsequence}
								action={<ActionLauncherButton tone='secondary' idleLabel={pageCopy.openPriceStep} pendingLabel={pageCopy.openPriceStep} availability={{ disabled: priceReason !== undefined, reason: priceReason }} onClick={() => openSection(priceSection.current)} />}
							/>
							<ForkStep
								title={pageCopy.repairAuction}
								body={auctionPanel}
								done={finalized}
								action={<ActionLauncherButton tone='secondary' idleLabel={pageCopy.openAuctionStep} pendingLabel={pageCopy.openAuctionStep} availability={{ disabled: auctionReason !== undefined, reason: auctionReason }} onClick={() => openSection(auctionSection.current)} />}
							/>
							<ForkStep title={copy.finalize} done={branch?.ready === true} detail={pageCopy.pendingSharedStep} actionDataNotice={actionDataNotice} action={activateBranch} />
							<ForkStep title={copy.open} done={opened} action={openBranch} />
						</ol>
					</>
				) : (
					<>
						<MetricGrid>
							<MetricField label={copy.choiceDeadline} loading={model.loading}>
								{state === undefined || state.choiceDeadline === 0n ? undefined : formatTimestamp(state.choiceDeadline)}
							</MetricField>
							<MetricField label={copy.activationDeadline} loading={model.loading}>
								{state === undefined || state.activationDeadline === 0n ? undefined : formatTimestamp(state.activationDeadline)}
							</MetricField>
							<MetricField label={copy.child} loading={model.loading}>
								{branch === undefined ? undefined : <IdentifierValue abbreviated value={formatUniverseIdHex(branch.universeId)} />}
							</MetricField>
							<MetricField label={copy.forkQuestionId} loading={model.loading}>
								{model.outcome === undefined ? undefined : <IdentifierValue abbreviated value={formatQuestionIdHex(model.outcome.questionId)} />}
							</MetricField>
							<MetricField label={copy.state} loading={model.loading}>
								{branchState}
							</MetricField>
						</MetricGrid>
						<UserMessage tone='warning' detail={copy.choiceHint} />
						<UserMessage detail={state?.choice.recorded ? committedMessage : copy.unchosen} />
						<ol className='statoblast-fork-steps'>
							<li>{prepareBranch}</li>
							<li>{chooseBranch}</li>
							<li>{startBranch}</li>
							<li>{activateBranch}</li>
							<li>{openBranch}</li>
						</ol>
					</>
				)}
			</SectionBlock>
			{!redesigned && pricePanel}
			{!redesigned && auctionPanel}
			<SecurityPoolShareRecovery model={model} actions={parameters.actions} snapshot={shownPool} redesigned={redesigned} forkQuestion={forkQuestion} />
		</div>
	)
}

function ForkStep({ title, done, detail, children, body, action, actionDataNotice }: { title: string; done: boolean; detail?: string; children?: ComponentChildren; body?: ComponentChildren; action: ComponentChildren; actionDataNotice?: string | undefined }) {
	return (
		<li data-done={done}>
			<div className='statoblast-fork-step-row'>
				<div className='statoblast-fork-step-copy'>
					<strong>{title}</strong> {done && <span className='statoblast-step-done'>{pageCopy.completedStep}</span>}
					{actionDataNotice !== undefined && !done && <p className='detail'>{actionDataNotice}</p>}
					{detail !== undefined && !done && <p className='detail'>{detail}</p>}
					{children}
				</div>
				<div className='statoblast-fork-step-action'>{action}</div>
			</div>
			{body}
		</li>
	)
}

function BranchChoices({ question, read, value, onChange, disabled }: { question: MarketDetails | undefined; read: ForkQuestionRead | undefined; value: string; onChange: (outcome: string) => void; disabled: boolean }) {
	if (question === undefined) {
		if (read === undefined) return undefined
		if (read.loading) return <UserMessage announcement='polite' detail={pageCopy.loadingForkQuestion} />
		return <RetryableNotice message={read.error ?? pageCopy.forkQuestionUnavailable} retryLabel={tryAgain} onRetry={read.retry} />
	}
	if (question.marketType === 'scalar') {
		const outcome = /^\d+$/u.test(value) ? BigInt(value) : undefined
		const selection = outcome === undefined ? undefined : getScalarOutcomeIndexDescriptor(question, outcome)
		const tick = selection?.kind === 'tick' ? selection.tickIndex : undefined
		const fallback = outcome === 0n ? pageCopy.invalid : common.none
		return (
			<ScalarOutcomePicker
				details={{ ...question, minValueLabel: formatScalarOutcomeLabel(question, 0n), maxValueLabel: formatScalarOutcomeLabel(question, question.numTicks) }}
				disabled={disabled}
				isInvalid={outcome === 0n}
				label={pageCopy.branchTitle}
				onInvalidChange={invalid => onChange(invalid ? '0' : '')}
				onSelectedTickChange={input => {
					const selected = /^\d+$/u.test(input) ? BigInt(input) : undefined
					onChange(selected !== undefined && selected <= question.numTicks ? getScalarOutcomeIndex(question, selected).toString() : '')
				}}
				selectedOutcomeLabel={tick === undefined ? fallback : formatScalarOutcomeLabel(question, tick)}
				selectedTick={tick?.toString() ?? ''}
			/>
		)
	}
	const outcomes = namedBranchChoices(question)
	return (
		<fieldset className='statoblast-branch-choices'>
			<legend>{pageCopy.branchTitle}</legend>
			{outcomes.map(({ label, outcome }) => (
				<label key={outcome}>
					<input type='radio' name='statoblast-fork-branch' checked={value === outcome} disabled={disabled} onChange={() => onChange(outcome)} />
					<OnChainText text={label} />
				</label>
			))}
		</fieldset>
	)
}

function namedBranchChoices(question: MarketDetails | undefined) {
	if (question === undefined || question.marketType === 'scalar') return []
	return [...question.outcomeLabels.map((label, index) => ({ label, outcome: String(index + 1) })), { label: pageCopy.invalid, outcome: '0' }]
}
