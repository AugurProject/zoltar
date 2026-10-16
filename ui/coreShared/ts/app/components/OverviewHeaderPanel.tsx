import type { ComponentChildren } from 'preact'
import { HeaderToolbar } from '../../components/HeaderToolbar.js'
import { MainnetDisabledNotice } from './MainnetDisabledNotice.js'

type OverviewHeaderPanelProps = {
	applicationTitle: string
	/** Environment badges beside the brand: active network and wrong wallet network. */
	badges?: ComponentChildren
	/** Universe and account controls on the top bar's right side; balances live in the account popover. */
	controls?: ComponentChildren
	/** Hints under the top bar, such as a universe state hint. */
	footer?: ComponentChildren
	navigation?: ComponentChildren
	/** Notices under the top bar: fork warnings, wallet read errors. */
	notices?: ComponentChildren
	settingsMenu?: ComponentChildren
}

/** Shared application identity, available before the active chain backend starts. */
export function ApplicationBrand({ applicationTitle }: { applicationTitle: string }) {
	return (
		<>
			<img src='./favicon.svg' alt='' width='28' height='28' />
			<span className='application-brand-name'>{applicationTitle}</span>
		</>
	)
}

/**
 * The top bar every application renders under the simulation strip: brand, primary navigation, universe and
 * account controls, and settings on one row, followed by any notices. Applications supply the slot contents so
 * the bar geometry and breakpoints behave the same everywhere.
 */
export function OverviewHeaderPanel({ applicationTitle, badges, controls, footer, navigation, notices, settingsMenu }: OverviewHeaderPanelProps) {
	return (
		<>
			<HeaderToolbar brand={<ApplicationBrand applicationTitle={applicationTitle} />} badges={badges} controls={controls} navigation={navigation} settings={settingsMenu} />
			<MainnetDisabledNotice />
			{notices}
			{footer}
		</>
	)
}
