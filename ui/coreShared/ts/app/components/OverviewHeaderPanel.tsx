import type { ComponentChildren } from 'preact'
import { useState } from 'preact/hooks'
import { EnvironmentDetailsToggle, HeaderMetricStrip } from '../../components/HeaderMetricStrip.js'
import { HeaderToolbar } from '../../components/HeaderToolbar.js'
import { MainnetDisabledNotice } from './MainnetDisabledNotice.js'

type OverviewHeaderPanelProps = {
	applicationTitle: string
	/** Environment badges beside the brand: active network, simulation, wrong wallet network. */
	badges?: ComponentChildren
	className?: string
	/** Wallet and universe controls on the toolbar's right side. */
	controls?: ComponentChildren
	/** Content under the metric strip, such as a universe state hint. */
	footer?: ComponentChildren
	/** Metric groups for the shared strip; secondary groups collapse behind the details toggle on narrow screens. */
	metrics?: ComponentChildren
	/** Notices between the toolbar and the metric strip: fork warnings, wallet read errors. */
	notices?: ComponentChildren
	settingsMenu?: ComponentChildren
	simulation: boolean
}

/**
 * The header panel every application renders under the simulation banner: brand toolbar, mainnet notice,
 * application notices, the collapsible metric strip, and footer hints. Applications supply the slot contents
 * so the toolbar geometry, strip breakpoints, and details toggle behave the same everywhere.
 */
export function OverviewHeaderPanel({ applicationTitle, badges, className, controls, footer, metrics, notices, settingsMenu, simulation }: OverviewHeaderPanelProps) {
	const [showEnvironmentDetails, setShowEnvironmentDetails] = useState(false)
	const panelClassName = ['overview-panel', 'overview-wallet-panel', simulation ? 'is-simulation' : undefined, className].filter(token => token !== undefined && token !== '').join(' ')
	return (
		<section className='overview-shell'>
			<article className={panelClassName}>
				<HeaderToolbar
					brand={
						<>
							<img src='./favicon.svg' alt='' width='28' height='28' />
							{applicationTitle}
						</>
					}
					badges={badges}
					controls={controls}
					settings={settingsMenu}
				/>
				<MainnetDisabledNotice />
				{notices}
				{metrics === undefined ? undefined : (
					<>
						<HeaderMetricStrip expanded={showEnvironmentDetails}>{metrics}</HeaderMetricStrip>
						<EnvironmentDetailsToggle expanded={showEnvironmentDetails} onToggle={() => setShowEnvironmentDetails(current => !current)} />
					</>
				)}
				{footer}
			</article>
		</section>
	)
}
