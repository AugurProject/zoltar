import type { ComponentChildren } from 'preact'

type HeaderToolbarProps = {
	badges?: ComponentChildren
	brand: ComponentChildren
	controls?: ComponentChildren
	navigation?: ComponentChildren
	settings?: ComponentChildren
}

/** The one-row top bar: brand and environment badges, primary navigation, universe and account controls, then settings. */
export function HeaderToolbar({ badges, brand, controls, navigation, settings }: HeaderToolbarProps) {
	return (
		<div className='header-toolbar'>
			<div className='header-toolbar-brand'>
				<h2 className='application-brand'>{brand}</h2>
				{badges === undefined ? undefined : <span className='environment-badge-row'>{badges}</span>}
			</div>
			{navigation === undefined ? undefined : <div className='header-toolbar-navigation'>{navigation}</div>}
			{controls === undefined ? undefined : <div className='header-toolbar-controls'>{controls}</div>}
			{settings === undefined ? undefined : <div className='header-toolbar-settings'>{settings}</div>}
		</div>
	)
}
