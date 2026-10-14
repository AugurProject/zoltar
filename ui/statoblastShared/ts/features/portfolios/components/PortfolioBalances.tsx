import { SectionBlock } from '@zoltar/ui-core-shared/components/SectionBlock.js'
import { WorkflowSubsection } from '@zoltar/ui-core-shared/components/WorkflowSubsection.js'
import { MetricGrid } from '@zoltar/ui-core-shared/components/MetricGrid.js'
import { MetricField } from '@zoltar/ui-core-shared/components/MetricField.js'
import { CurrencyValue } from '@zoltar/ui-core-shared/components/CurrencyValue.js'
import { AddressValue } from '@zoltar/ui-core-shared/components/AddressValue.js'
import { Badge } from '@zoltar/ui-core-shared/components/Badge.js'
import { EmptyState } from '@zoltar/ui-core-shared/components/EmptyState.js'
import { UserMessage } from '@zoltar/ui-core-shared/components/UserMessage.js'
import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js'
import * as copy from '../../../copy/portfolio.js'
import type { usePortfolio } from '../hooks/usePortfolio.js'
import { isPortfolioPositionVisible } from '../lib/preferences.js'
import { PortfolioInput } from './PortfolioControls.js'
import { buildPoolsRouteHash } from '../../../lib/statoblastLocation.js'

type Model = ReturnType<typeof usePortfolio>

export function PortfolioBalances({ model }: { model: Pick<Model, 'snapshot' | 'positionPageCount' | 'loading' | 'refresh' | 'watchlistOnly' | 'setWatchlistOnly' | 'preferences' | 'toggleWatch' | 'branchInput' | 'setBranchInput' | 'addBranch'> }) {
	const snapshot = model.snapshot
	if (snapshot === undefined) return null
	let scopeNotice: string | undefined
	if (model.positionPageCount > 1n) scopeNotice = copy.positionPageCoverage
	else if (!snapshot.coverage.registryComplete) scopeNotice = copy.subsetCoverage
	return (
		<SectionBlock
			title={copy.snapshot}
			description={copy.coverage}
			actions={
				<button type='button' className='secondary' disabled={model.loading} onClick={() => void model.refresh()}>
					{copy.refresh}
				</button>
			}
		>
			<MetricGrid>
				<MetricField label={copy.owner}>
					<AddressValue address={snapshot.owner} />
				</MetricField>
				<MetricField label={copy.vault}>
					<AddressValue address={snapshot.vault} />
				</MetricField>
			</MetricGrid>
			{scopeNotice === undefined ? undefined : <UserMessage tone='warning' detail={scopeNotice} />}
			{snapshot.coverage.issues.length > 0 ? <UserMessage tone='warning' detail={snapshot.coverage.issues.join(' ')} /> : undefined}
			<label>
				<input type='checkbox' checked={model.watchlistOnly} onChange={event => model.setWatchlistOnly(event.currentTarget.checked)} />
				{copy.watchlistOnly}
			</label>
			{snapshot.branches.map(branch => (
				<WorkflowSubsection key={String(branch.universeId)} title={`${copy.universe} ${branch.universeId}`} badge={branch.forkTime > 0n ? <Badge tone='warning'>{copy.forked}</Badge> : undefined}>
					<MetricGrid>
						<MetricField label={copy.idle}>
							<CurrencyValue value={branch.idleAttoRep} suffix={commonCopy.rep} />
						</MetricField>
						{branch.positions
							.filter(position => position.registered)
							.slice(0, 1)
							.map(position => (
								<MetricField key={position.priceFeed} label={copy.priceFeed}>
									<AddressValue address={position.priceFeed} />
								</MetricField>
							))}
						<MetricField label={copy.token}>
							<AddressValue address={branch.repToken} />
						</MetricField>
					</MetricGrid>
					{branch.positions.length === 0 ? (
						<EmptyState title={copy.noPositions} detail={copy.noPositionsDetail} />
					) : (
						branch.positions
							.filter(
								position =>
									!model.watchlistOnly ||
									isPortfolioPositionVisible(model.preferences.watchedQuestionIds.includes(String(position.questionId)), {
										claimableFeesAttoEth: position.claimableFeesAttoEth,
										backingUnits: position.backingUnits,
										backingAttoRep: position.backingAttoRep,
										commitmentAttoEth: position.commitmentAttoEth,
										disputeStakedAttoRep: position.disputeStakeAttoRep,
										badDebtAttoEth: position.badDebtAttoEth,
										pendingCount: position.queuedOperations.length,
									}),
							)
							.map(position => (
								<div className='workflow-subsection' key={position.pool}>
									<div className='actions'>
										<a href={`${buildPoolsRouteHash({ view: 'operate', securityPoolAddress: position.pool, tab: 'vaults' })}?universe=${branch.universeId}&vault=${snapshot.vault}`}>{copy.pool}</a>
										<AddressValue address={position.pool} />
										<Badge tone={position.priceValid ? 'ok' : 'warning'}>{position.priceValid ? copy.priceFresh : copy.priceStale}</Badge>
										<label>
											<input type='checkbox' checked={model.preferences.watchedQuestionIds.includes(String(position.questionId))} onChange={() => model.toggleWatch(position.questionId)} />
											{copy.watch}
										</label>
									</div>
									{position.pendingReportId > 0n && position.pendingReportCoordinator.toLowerCase() !== position.coordinator.toLowerCase() ? <UserMessage tone='warning' detail={copy.sharedPricePending} /> : undefined}
									<MetricGrid>
										<MetricField label={copy.allocated}>
											<CurrencyValue value={position.backingAttoRep} suffix={commonCopy.rep} />
										</MetricField>
										<MetricField label={copy.commitment}>
											<CurrencyValue value={position.commitmentAttoEth} suffix={commonCopy.eth} />
										</MetricField>
										<MetricField label={copy.stake}>
											<CurrencyValue value={position.disputeStakeAttoRep} suffix={commonCopy.rep} />
										</MetricField>
										<MetricField label={copy.fees}>
											<CurrencyValue value={position.claimableFeesAttoEth} suffix={commonCopy.eth} />
										</MetricField>
										<MetricField label={copy.debt}>
											<CurrencyValue value={position.badDebtAttoEth} suffix={commonCopy.eth} />
										</MetricField>
									</MetricGrid>
								</div>
							))
					)}
				</WorkflowSubsection>
			))}
			<UserMessage detail={copy.positionsAlwaysVisible} />
			<PortfolioInput label={copy.branch} value={model.branchInput} onChange={model.setBranchInput} hint={copy.branchHint} numeric />
			<button type='button' className='secondary' disabled={model.loading} onClick={() => void model.addBranch()}>
				{copy.addBranch}
			</button>
		</SectionBlock>
	)
}

const operationLabels = { pending: copy.pending, expired: copy.expired, unknown: copy.unknown, succeeded: copy.executed, failed: copy.failed }

export function PortfolioOperationHistory({ model }: { model: Pick<Model, 'history' | 'selection' | 'historyWarning'> }) {
	return (
		<SectionBlock title={copy.queued} description={copy.historyDescription}>
			{model.historyWarning === undefined ? undefined : <UserMessage tone='warning' detail={model.historyWarning} />}
			{model.history.length === 0 ? (
				<EmptyState title={copy.noOperations} />
			) : (
				model.history.map(entry => (
					<div className='workflow-subsection' key={entry.key}>
						<div className='actions'>
							<strong>{`${copy.operation} ${entry.operationId}`}</strong>
							<Badge tone={entry.result.status === 'succeeded' ? 'ok' : 'warning'}>{operationLabels[entry.result.status]}</Badge>
							<AddressValue address={entry.pool} />
							<a href={`${buildPoolsRouteHash({ view: 'operate', securityPoolAddress: entry.pool, tab: 'vaults' })}?universe=${entry.universeId}${model.selection === undefined ? '' : `&vault=${model.selection.vault}`}`}>{copy.nativeOperations}</a>
						</div>
						{entry.result.status === 'failed' ? <UserMessage tone='error' detail={entry.result.errorMessage} /> : undefined}
					</div>
				))
			)}
		</SectionBlock>
	)
}
