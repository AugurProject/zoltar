import * as appCopy from '../copy/app.js'
import * as commonCopy from '../copy/common.js'
import * as simulationCopy from '../copy/simulation.js'
import type { BadgeTone } from '../types/components.js'
import { Badge } from './Badge.js'

type ScenarioStatus = { badgeTone: BadgeTone; compactLabel?: string; label: string }

export function getScenarioStatus(parameters: { bootstrapError: string | undefined; bootstrapWarning: string | undefined; isBootstrapped: boolean }): ScenarioStatus {
	if (parameters.bootstrapError !== undefined) return { badgeTone: 'blocked', label: commonCopy.error }
	if (parameters.isBootstrapped && parameters.bootstrapWarning !== undefined) return { badgeTone: 'warning', compactLabel: simulationCopy.warningLabel, label: simulationCopy.readyWithWarningLabel }
	if (parameters.isBootstrapped) return { badgeTone: 'ok', label: simulationCopy.ready }
	return { badgeTone: 'pending', label: simulationCopy.bootstrapping }
}

type SimulationStripSummaryProps = {
	accountLabel: string
	bootstrapLabel: string | undefined
	/** Fraction from 0 to 1; undefined while the simulator has not reported progress yet. */
	bootstrapProgress: number | undefined
	bootstrapping: boolean
	detailsOpen: boolean
	scenarioLabel: string
	status: ScenarioStatus
}

/**
 * The one-line simulation strip that summarizes the simulator above the application chrome. While the
 * scenario boots it shows the current step and a thin progress bar inline, so the details panel can
 * stay collapsed and the page keeps its layout.
 */
export function SimulationStripSummary({ accountLabel, bootstrapLabel, bootstrapProgress, bootstrapping, detailsOpen, scenarioLabel, status }: SimulationStripSummaryProps) {
	const progressPercent = Math.round((bootstrapProgress ?? 0.08) * 100)
	return (
		<summary>
			<span className='simulation-strip'>
				<h2 className='simulation-strip-title'>{appCopy.browserSimulation}</h2>
				<Badge tone={status.badgeTone} ariaLabel={status.label}>
					{status.compactLabel ?? status.label}
				</Badge>
				<strong className='simulation-strip-scenario'>{scenarioLabel}</strong>
				{bootstrapping ? (
					<span className='simulation-strip-progress'>
						<span className='simulation-strip-progress-label'>{bootstrapLabel ?? simulationCopy.preparingScenario}</span>
						<span className='simulation-strip-progress-track' aria-hidden='true'>
							<span className='simulation-strip-progress-fill' style={{ width: `${progressPercent.toString()}%` }} />
						</span>
					</span>
				) : (
					<span className='simulation-banner-compact-account'>{accountLabel}</span>
				)}
				<span className='simulation-banner-compact-action'>{detailsOpen ? simulationCopy.hideSimulationDetails : simulationCopy.showSimulationDetails}</span>
				<span className='simulation-strip-caret' aria-hidden='true' />
			</span>
		</summary>
	)
}
