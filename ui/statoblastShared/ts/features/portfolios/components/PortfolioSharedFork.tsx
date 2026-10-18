import { SectionBlock } from '@zoltar/ui-core-shared/components/SectionBlock.js'
import { MetricGrid } from '@zoltar/ui-core-shared/components/MetricGrid.js'
import { MetricField } from '@zoltar/ui-core-shared/components/MetricField.js'
import { CurrencyValue } from '@zoltar/ui-core-shared/components/CurrencyValue.js'
import { UserMessage } from '@zoltar/ui-core-shared/components/UserMessage.js'
import { PaginationControls } from '@zoltar/ui-core-shared/components/PaginationControls.js'
import { ActionLauncherButton } from '@zoltar/ui-core-shared/components/ActionLauncherButton.js'
import { formatTimestamp } from '@zoltar/ui-core-shared/lib/formatters.js'
import { zeroAddress } from '@zoltar/core-shared/evm/ethereum'
import { PortfolioButton, PortfolioInput } from './PortfolioControls.js'
import { usePortfolioSharedFork, type PortfolioSharedForkParameters } from '../hooks/usePortfolioSharedFork.js'
import { buildPoolsRouteHash } from '../../../lib/statoblastLocation.js'
import * as copy from '../../../copy/portfolioSharedFork.js'
import * as forkCopy from '../../../copy/portfolioFork.js'
import * as portfolioCopy from '../../../copy/portfolio.js'
import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js'

function choiceTimestamp(value: bigint | undefined) {
	if (value === undefined) return undefined
	return value === 0n ? copy.notForked : formatTimestamp(value)
}

export function PortfolioSharedFork(parameters: PortfolioSharedForkParameters) {
	const model = usePortfolioSharedFork(parameters)
	const state = model.state
	const busy = parameters.actions.busy !== undefined
	const preparation = model.preparation
	return (
		<SectionBlock title={copy.title} description={copy.description}>
			<h4>{model.rootContext ? copy.originalReserve : model.incomingLabel}</h4>
			{model.rootContext ? undefined : (
				<ActionLauncherButton
					tone='secondary'
					idleLabel={copy.parentBranch}
					pendingLabel={copy.loading}
					availability={{ disabled: busy || state === undefined, reason: busy ? portfolioCopy.busy : copy.loading }}
					onClick={() => {
						if (state !== undefined) model.openContext(state.parentContextId)
					}}
				/>
			)}
			<details>
				<summary>{copy.advanced}</summary>
				<PortfolioInput label={copy.context} hint={copy.contextHint} value={model.contextInput} onChange={model.setContext} disabled={busy} numeric />
			</details>
			{model.error === undefined ? undefined : <UserMessage tone='error' detail={model.error} />}
			<MetricGrid>
				<MetricField label={copy.universe} loading={model.loading}>
					{state === undefined ? undefined : String(state.universeId)}
				</MetricField>
				<MetricField label={copy.token} loading={model.loading}>
					{state === undefined ? undefined : <code>{state.repToken}</code>}
				</MetricField>
				<MetricField label={copy.opensAt} loading={model.loading}>
					{choiceTimestamp(state?.opensAt)}
				</MetricField>
				<MetricField label={copy.closesAt} loading={model.loading}>
					{choiceTimestamp(state?.closesAt)}
				</MetricField>
			</MetricGrid>
			<UserMessage detail={copy.choiceHint} />
			<PortfolioInput label={forkCopy.outcome} hint={forkCopy.outcomeHint} value={model.outcomeInput} onChange={model.setOutcome} disabled={busy} numeric />
			{model.selectedBranch === undefined ? undefined : <UserMessage detail={model.selectedBranch} />}
			<UserMessage detail={model.loading ? copy.loading : copy.pageSummary(model.intervals.length, model.selectedCount)} />
			<details>
				<summary>{copy.periods}</summary>
				<ul>
					{model.intervals.map(interval => (
						<li key={String(interval.intervalId)}>{copy.intervalSummary(interval.intervalId, interval.startPosition, interval.open ? (state?.positionCount ?? 0n) : interval.endPosition, interval.selected ? interval.outcomeIndex : undefined)}</li>
					))}
				</ul>
			</details>
			<div className='actions'>
				<PortfolioButton model={parameters.actions} action='chooseSharedFork' label={copy.choice} pendingLabel={copy.choosing} reason={model.chooseReason} onClick={model.choose} />
				<PortfolioButton model={parameters.actions} action='revokeSharedFork' label={copy.revoke} pendingLabel={copy.revoking} reason={model.revokeReason} onClick={model.revoke} />
				<ActionLauncherButton tone='secondary' idleLabel={copy.openChild} pendingLabel={copy.loading} availability={{ disabled: busy || model.openChildReason !== undefined, reason: busy ? portfolioCopy.busy : model.openChildReason }} onClick={model.openChild} />
				<ActionLauncherButton tone='secondary' idleLabel={copy.refreshed} pendingLabel={copy.refreshing} availability={{ disabled: busy || model.loading, reason: busy ? portfolioCopy.busy : copy.loading }} onClick={model.refresh} />
			</div>
			<div className='actions'>
				{model.branches.map(branch => (
					<ActionLauncherButton key={String(branch.contextId)} tone='secondary' idleLabel={copy.openBranch(branch.label)} pendingLabel={copy.loading} availability={{ disabled: busy, reason: portfolioCopy.busy }} onClick={() => model.openContext(branch.contextId)} />
				))}
			</div>
			<PaginationControls hasPreviousPage={(state?.intervalStart ?? 0n) > 0n} hasNextPage={state !== undefined && state.intervalStart + 64n < state.intervalCount} loading={model.loading} onPreviousPage={model.previousPage} onNextPage={model.nextPage} />
			<div className='workflow-subsection'>
				<PortfolioInput label={copy.position} hint={copy.positionHint} value={model.positionInput} onChange={model.setPosition} disabled={busy} numeric />
				{preparation?.needsPreparation ? <UserMessage detail={forkCopy.prepareHint} /> : undefined}
				{preparation === undefined || preparation.pool === zeroAddress ? undefined : <a href={buildPoolsRouteHash({ view: 'operate', securityPoolAddress: preparation.pool, tab: 'fork-workflow' })}>{forkCopy.prepare}</a>}
				<PortfolioButton model={parameters.actions} action='processSharedFork' label={copy.process} pendingLabel={copy.processing} reason={model.processReason} onClick={model.process} />
			</div>
			{model.rootContext ? (
				<UserMessage detail={copy.rootRecovery} />
			) : (
				<div className='workflow-subsection'>
					<MetricGrid>
						<MetricField label={copy.recoveredRep} loading={model.loading}>
							<CurrencyValue value={state?.recoverableRepAttoRep} suffix={commonCopy.rep} />
						</MetricField>
						<MetricField label={copy.recoveredEth} loading={model.loading}>
							<CurrencyValue value={state?.recoverableFeesAttoEth} suffix={commonCopy.eth} />
						</MetricField>
					</MetricGrid>
					<UserMessage detail={copy.recoverHint} />
					<PortfolioButton model={parameters.actions} action='collectSharedFork' label={copy.recover} pendingLabel={copy.recovering} reason={model.collectReason} onClick={model.collect} />
					<details>
						<summary>{copy.fallback}</summary>
						<UserMessage tone='warning' detail={copy.fallbackHint} />
						<PortfolioButton model={parameters.actions} action='claimContextPosition' label={copy.individual} pendingLabel={copy.individualPending} reason={model.individualReason} onClick={() => model.individual(false)} />
						<PortfolioButton model={parameters.actions} action='claimContextPositionAndMigrate' label={copy.individualFork} pendingLabel={copy.individualForkPending} reason={model.individualForkReason} onClick={() => model.individual(true)} />
					</details>
				</div>
			)}
		</SectionBlock>
	)
}
