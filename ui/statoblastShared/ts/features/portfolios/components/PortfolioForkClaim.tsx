import { ActionLauncherButton } from '@zoltar/ui-core-shared/components/ActionLauncherButton.js'
import { UserMessage } from '@zoltar/ui-core-shared/components/UserMessage.js'
import { PortfolioButton, PortfolioInput } from './PortfolioControls.js'
import { usePortfolioForkClaim, type PortfolioForkClaimParameters } from '../hooks/usePortfolioForkClaim.js'
import { buildPoolsRouteHash } from '../../../lib/statoblastLocation.js'
import * as copy from '../../../copy/portfolioFork.js'
import * as portfolioCopy from '../../../copy/portfolio.js'

export function PortfolioForkClaim(parameters: PortfolioForkClaimParameters) {
	const model = usePortfolioForkClaim(parameters)
	let refreshReason: string | undefined
	if (parameters.actions.busy !== undefined) refreshReason = portfolioCopy.busy
	else if (model.loading) refreshReason = copy.loading
	return (
		<div className='workflow-subsection'>
			<h4>{copy.title}</h4>
			<UserMessage detail={copy.prepareHint} />
			{model.parent === undefined ? undefined : <a href={buildPoolsRouteHash({ view: 'operate', securityPoolAddress: model.parent, tab: 'fork-workflow' })}>{copy.prepare}</a>}
			<PortfolioInput label={copy.outcome} hint={copy.outcomeHint} value={model.outcomeInput} onChange={model.setOutcome} disabled={parameters.actions.busy !== undefined} numeric />
			{model.selectedBranch === undefined ? undefined : <UserMessage detail={model.selectedBranch} />}
			{model.error === undefined ? undefined : <UserMessage tone='error' detail={model.error} />}
			<div className='actions'>
				<ActionLauncherButton tone='secondary' idleLabel={copy.refresh} pendingLabel={copy.refreshing} availability={{ disabled: parameters.actions.busy !== undefined || model.loading, reason: refreshReason }} onClick={model.refresh} />
				<PortfolioButton model={parameters.actions} action={`claimPortfolioPositionAndMigrate:${parameters.allocation.positionId}`} label={copy.claim} pendingLabel={copy.claiming} reason={model.reason} onClick={model.claim} />
			</div>
		</div>
	)
}
