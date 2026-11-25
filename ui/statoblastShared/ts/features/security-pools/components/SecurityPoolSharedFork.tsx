import { getBrowserStorage } from '@zoltar/ui-core-shared/lib/browserStorage.js'
import { sameAddress } from '@zoltar/ui-core-shared/lib/address.js'
import { formatScalarOutcomeLabel, getScalarOutcomeIndex, getScalarOutcomeIndexDescriptor } from '@zoltar/ui-core-shared/lib/scalarOutcome.js'
import { ScalarOutcomePicker } from '@zoltar/ui-core-shared/components/ScalarOutcomePicker.js'
import type { ComponentChildren } from 'preact'
import type { MarketDetails, ZoltarChildUniverseSummary } from '@zoltar/ui-core-shared/types/contracts.js'
import * as pageCopy from '../../../copy/forkRecovery.js'
import { addToCalendar } from '../../../copy/questionPage.js'
import { buildStatoblastCalendarEvent, downloadStatoblastCalendarEvent, LAST_CALENDAR_START } from '../../reporting/lib/escalationReminder.js'
import type { RegisterStatoblastPageRefresh } from '../../useStatoblastPageRefresh.js'
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
import { SecurityPoolShareRecovery } from './SecurityPoolShareRecovery.js'
import { SecurityPoolForkDiagram } from './SecurityPoolForkDiagram.js'
import { SecurityPoolPriceReport } from './SecurityPoolPriceReport.js'
import { branchPriceTarget } from '../hooks/useSecurityPoolPrice.js'
import { SecurityPoolRepairAuction } from './SecurityPoolRepairAuction.js'
import * as copy from '../../../copy/securityPoolSharedFork.js'
import * as common from '@zoltar/ui-core-shared/copy/common.js'

export type ForkQuestionRead = { loading: boolean; error: string | undefined; retry: () => void }

export function SecurityPoolSharedFork({
	redesigned = false,
	forkQuestion,
	forkQuestionRead,
	onBranchCommitted,
	childUniverses,
	autoRefresh,
	registerPageRefresh,
	...parameters
}: SecurityPoolSharedForkParameters & {
	redesigned?: boolean
	forkQuestion?: MarketDetails | undefined
	forkQuestionRead?: ForkQuestionRead | undefined
	onBranchCommitted?: ((committed: boolean) => void) | undefined
	childUniverses?: readonly Pick<ZoltarChildUniverseSummary, 'outcomeIndex' | 'universeId' | 'exists'>[] | undefined
	autoRefresh?: boolean | undefined
	registerPageRefresh?: RegisterStatoblastPageRefresh | undefined
}) {
	const model = useSecurityPoolSharedFork(parameters)
	const state = model.state
	const display = model.displayedState
	const branch = display?.branch
	const shownPool = parameters.presentationSnapshot ?? parameters.snapshot
	const branchDone = display?.choice.recorded === true
	const choiceAt = display?.choiceDeadline
	const canChooseByDeadline = choiceAt !== undefined && display !== undefined && display.timestamp < choiceAt
	const choiceDate = choiceAt === undefined ? undefined : formatTimestamp(choiceAt)
	const showReminder = !branchDone && canChooseByDeadline && choiceAt !== undefined && choiceAt <= LAST_CALENDAR_START
	const addReminder = () => {
		if (display === undefined || choiceAt === undefined || !showReminder) return
		const event = buildStatoblastCalendarEvent({ id: `${display.securityPool}-${display.universeId}-${choiceAt}`, generatedAt: BigInt(Math.floor(Date.now() / 1000)), startsAt: choiceAt, title: pageCopy.branchChoiceCalendar, description: location.href })
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
	const priceReason = migrationStarted ? undefined : pageCopy.branchPriceLockedReason
	let auctionReason: string | undefined
	if (!migrationStarted) auctionReason = pageCopy.auctionLockedReason
	else if (!accepted && !finalized) auctionReason = branch?.ready ? pageCopy.auctionClosed : pageCopy.auctionNeedsPrice
	const [confirmedChoice, setConfirmedChoice] = useState(false)
	useEffect(() => setConfirmedChoice(false), [model.outcomeInput, model.sourceInput])
	useEffect(() => {
		if (state !== undefined && parameters.bidder !== undefined && sameAddress(state.owner, parameters.bidder)) onBranchCommitted?.(state.choice.recorded)
	}, [state?.choice.recorded, state?.owner, parameters.bidder, onBranchCommitted])
	const chooseReason = model.chooseReason ?? (redesigned && !confirmedChoice ? pageCopy.branchConfirmationReason : undefined)
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
	return (
		<div className='route-view-flow'>
			{redesigned && display !== undefined && display.forkTime > 0n && !branchDone && choiceDate !== undefined && (
				<div className='statoblast-fork-choice-deadline'>
					<div>
						<strong>{canChooseByDeadline ? pageCopy.chooseBy(choiceDate) : pageCopy.choiceExpired}</strong>
						{canChooseByDeadline && choiceAt !== undefined && <span className='statoblast-fork-choice-countdown'>{pageCopy.choiceTimeLeft(formatDuration(choiceAt - display.timestamp))}</span>}
						<p>{canChooseByDeadline ? pageCopy.choiceForfeit : pageCopy.noChoiceAfterDeadline}</p>
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
					<BranchChoices question={forkQuestion} read={forkQuestionRead} value={model.outcomeInput} onChange={model.setOutcome} disabled={disabled || state?.choice.recorded === true} />
				) : (
					<MetricGrid>
						<SecurityPoolInput label={copy.universe} value={model.sourceInput} onChange={model.setSource} disabled={disabled} />
						<SecurityPoolInput label={copy.outcome} hint={copy.outcomeHint} value={model.outcomeInput} onChange={model.setOutcome} disabled={disabled} />
					</MetricGrid>
				)}
				<RetryableNotice message={model.forkError} retryLabel={tryAgain} onRetry={model.retryFork} />
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
						{display !== undefined && display.activationDeadline > 0n && (
							<div className='statoblast-branch-recapitalization'>
								<strong>{pageCopy.recapitalizationDeadline}</strong> <span>{formatTimestamp(display.activationDeadline)}</span>
								<p className='detail'>{pageCopy.recapitalizationHint}</p>
							</div>
						)}
						<ol aria-label={pageCopy.branchSteps} className='statoblast-fork-steps statoblast-fork-workflow'>
							<ForkStep title={pageCopy.prepareSelectedBranch} done={branch?.prepared === true} action={prepareBranch} />
							<ForkStep title={copy.choice} done={branchDone} action={chooseBranch}>
								{!branchDone && (
									<label className='statoblast-choice-confirmation'>
										<input type='checkbox' checked={confirmedChoice} disabled={disabled || !canChooseByDeadline || state?.branch === undefined} onChange={event => setConfirmedChoice(event.currentTarget.checked)} />
										{pageCopy.branchConfirmation}
									</label>
								)}
							</ForkStep>
							<ForkStep title={copy.start} done={branch?.started === true} detail={pageCopy.pendingSharedStep} action={startBranch} />
							<ForkStep
								title={pageCopy.branchRepPrice}
								done={accepted}
								revisit
								detail={branch?.ready && !accepted ? pageCopy.branchPriceClosed : pageCopy.branchPriceConsequence}
								action={<ActionLauncherButton tone='secondary' idleLabel={pageCopy.openPriceStep} pendingLabel={pageCopy.openPriceStep} availability={{ disabled: priceReason !== undefined, reason: priceReason }} onClick={() => openSection(priceSection.current)} />}
							/>
							<ForkStep
								title={pageCopy.repairAuction}
								done={finalized}
								revisit
								action={<ActionLauncherButton tone='secondary' idleLabel={pageCopy.openAuctionStep} pendingLabel={pageCopy.openAuctionStep} availability={{ disabled: auctionReason !== undefined, reason: auctionReason }} onClick={() => openSection(auctionSection.current)} />}
							/>
							<ForkStep title={copy.finalize} done={branch?.ready === true} detail={pageCopy.pendingSharedStep} action={activateBranch} />
							<ForkStep title={copy.open} done={opened} revisit action={openBranch} />
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
			{(!redesigned || migrationStarted) && (
				<div ref={priceSection} tabIndex={-1}>
					<SecurityPoolPriceReport
						redesigned={redesigned}
						hideReportingDeadline={redesigned}
						scope='branch'
						target={priceTarget}
						displayTarget={priceTarget ?? model.savedBranch}
						actions={parameters.actions}
						bidder={parameters.bidder}
						referencePrice={shownPool?.acceptedPrice}
						onPriceAccepted={setPricedBranch}
						autoRefresh={autoRefresh ?? false}
						registerPageRefresh={registerPageRefresh}
					/>
				</div>
			)}
			{(!redesigned || migrationStarted) && (
				<div ref={auctionSection} tabIndex={-1} hidden={redesigned && auctionReason !== undefined}>
					<SecurityPoolRepairAuction fork={state} savedBranch={model.savedBranch} actions={parameters.actions} bidder={parameters.bidder} openVault={parameters.openVault} onAuctionFinalized={setFinalizedAuctionBranch} sharedDeadline={redesigned} />
				</div>
			)}
			<SecurityPoolShareRecovery model={model} actions={parameters.actions} snapshot={shownPool} redesigned={redesigned} />
		</div>
	)
}

function ForkStep({ title, done, detail, children, action, revisit = false }: { title: string; done: boolean; detail?: string; children?: ComponentChildren; action: ComponentChildren; revisit?: boolean }) {
	return (
		<li data-done={done}>
			<div className='statoblast-fork-step-row'>
				<div className='statoblast-fork-step-copy'>
					<strong>{title}</strong>
					{detail !== undefined && !done && <p className='detail'>{detail}</p>}
					{children}
				</div>
				<div className='statoblast-fork-step-action'>
					{done && <span className='statoblast-step-done'>{pageCopy.completedStep}</span>}
					{(!done || revisit) && action}
				</div>
			</div>
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
