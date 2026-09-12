import type { ComponentChildren } from 'preact'

type HeaderToolbarProps = {
	badges?: ComponentChildren
	brand: ComponentChildren
	controls?: ComponentChildren
	settings?: ComponentChildren
}

/** Single-row application toolbar: brand and environment badges on the left, wallet and universe controls and settings on the right. */
export function HeaderToolbar({ badges, brand, controls, settings }: HeaderToolbarProps) {
	return (
		<div className='header-toolbar'>
			<div className='header-toolbar-brand'>
				<h2 className='application-brand'>{brand}</h2>
				{badges === undefined ? undefined : <span className='environment-badge-row'>{badges}</span>}
			</div>
			{controls === undefined ? undefined : <div className='header-toolbar-controls'>{controls}</div>}
			{settings === undefined ? undefined : <div className='header-toolbar-settings'>{settings}</div>}
		</div>
	)
}
