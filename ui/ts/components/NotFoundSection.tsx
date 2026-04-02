export function NotFoundSection() {
	return (
		<section className='panel market-panel'>
			<div className='not-found-shell'>
				<div className='not-found-mark'>
					<p className='eyebrow'>Augur PLACEHOLDER</p>
					<h1>404</h1>
				</div>

				<div className='not-found-copy'>
					<h2>That page is not in the map</h2>
					<p className='detail'>The hash in the address bar does not match any known section of the app. Use one of the routes below to get back into the system.</p>
					<div className='hero-status'>
						<span className='status-chip ready'>Unknown route</span>
						<span className='status-chip muted'>Hash navigation</span>
						<span className='status-chip muted'>Mainnet console</span>
					</div>
				</div>
			</div>

			<div className='actions'>
				<a className='button-link' href='#/deploy'>
					Return to Deploy
				</a>
				<a className='button-link secondary-link' href='#/zoltar'>
					Open Zoltar
				</a>
				<a className='button-link secondary-link' href='#/security-pools'>
					Open Security Pools
				</a>
			</div>
		</section>
	)
}
