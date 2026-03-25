import { formatAddress, formatCurrencyBalance } from '../lib/formatters.js'
import { getPrerequisiteLabel } from '../lib/deployment.js'
import type { OverviewPanelsProps } from '../types/components.js'

export function OverviewPanels({ accountState, deploymentStatuses, busyStepId, onDeployNextMissing }: OverviewPanelsProps) {
	const deployedCount = deploymentStatuses.filter(step => step.deployed).length
	const nextMissingStep = deploymentStatuses.find((step, index) => !step.deployed && getPrerequisiteLabel(deploymentStatuses, index) === null) ?? null

	return (
		<section class="grid">
			<article class="panel">
				<p class="panel-label">Wallet</p>
				<h2>{accountState.address === null ? 'Not Connected' : formatAddress(accountState.address)}</h2>
				<p class="detail">{accountState.address ?? 'Connect a wallet to read balances and deploy contracts.'}</p>
				<div class="metric-row">
					<div>
						<span class="metric-label">Network</span>
						<strong>{accountState.chainId ?? 'Unknown'}</strong>
					</div>
					<div>
						<span class="metric-label">ETH</span>
						<strong>{formatCurrencyBalance(accountState.ethBalance)} ETH</strong>
					</div>
					<div>
						<span class="metric-label">REP</span>
						<strong>{formatCurrencyBalance(accountState.repBalance)} REP</strong>
					</div>
				</div>
			</article>

			<article class="panel">
				<p class="panel-label">Deployment Progress</p>
				<h2>
					{deployedCount} / {deploymentStatuses.length} Ready
				</h2>
				<p class="detail">{nextMissingStep === null ? 'All deterministic contracts are deployed.' : `Next deployable contract: ${ nextMissingStep.label }`}</p>
				<div class="actions">
					<button onClick={onDeployNextMissing} disabled={accountState.address === null || nextMissingStep === null || busyStepId !== null}>
						{busyStepId === null ? 'Deploy Next Missing' : 'Deployment In Progress'}
					</button>
				</div>
			</article>
		</section>
	)
}
