;(() => {
	const on = document.body.dataset.ptab
	const forked = document.body.dataset.forked === '1'
	// data-admission="fixed" on <body>: a security pool with a fixed question list (09b)
	const admission = document.body.dataset.admission === 'fixed' ? 'fixed question list' : 'any question'
	// Capital is the landing tab. Fork & recovery appears only after a fork. After a fork, REP price stays only while
	// price-report funds remain to settle, recover or return (withdrawFunding is not fork-gated); Liquidations is hidden
	const tabs = forked
		? [
				['capital', 'Capital', '<span class="badge mute">Limited</span>'],
				['questions', 'Questions', '<span class="badge mute">Minting closed</span>'],
				['price', 'REP price', '<span class="badge mute">Return funds only</span>'],
				['fork', 'Fork &amp; recovery', '<span class="count">!</span>'],
			]
		: [
				['capital', 'Capital', ''],
				['questions', 'Questions', ''],
				['price', 'REP price', '<span class="badge ok">Current</span>'],
				['liquidations', 'Liquidations', ''],
			]
	const current = tabs.find(([id]) => id === on)
	const html = `
	<div class="crumbs"><a>Watchlist</a> › <span aria-current="page">Security pool</span></div>
	<div class="route-head">
		<div>
			<div class="row">${forked ? '<span class="badge bad">Forked</span>' : '<span class="badge ok">Active</span>'}<span class="muted small">WETH collateral · ${admission}</span></div>
			<h1 style="margin-top: .5rem; display: flex; gap: .6rem; align-items: center; font-size: 1.6rem" class="mono"><button class="fav lg on" aria-pressed="true" aria-label="Saved: security pool 0x952288743ABbD4D1BC93f7aCADB4f7B8121A2766" title="Remove from saved">★</button>0x952288743ABbD4D1BC93f7aCADB4f7B8121A2766</h1>
			<div class="row small muted" style="margin-top: .3rem"><a>Copy address</a><a>Add a label</a></div>
		</div>
		<div class="row"><span class="chip"><span class="nowrap">Position of <b>you</b></span> <span class="mono muted">0x7a3f375917679e170d85356b88194849e4ea91c2</span> ▾</span></div>
	</div>
	<div class="card facts" style="margin-bottom: var(--s4)">
		<div><span class="k">Capacity in use</span><span class="v num">1.00 of 10.00 WETH</span></div>
		<div><span class="k">Total pledged REP</span><span class="v num">12 480.00</span></div>
		<div><span class="k">Holding fee</span><span class="v num">10%/yr</span></div>
		<div><span class="k">Purchase fee</span><span class="v num">1% (min 0.001 WETH)</span></div>
		<div><span class="k">Security multiplier</span><span class="v num">200%</span></div>
		<div><span class="k">Min commitment</span><span class="v num">1.00 WETH</span></div>
	</div>
	<div class="view-tabs many">${tabs.map(([id, label, extra]) => `<a class="${on === id ? 'on' : ''}">${label} ${extra}</a>`).join('')}</div>
	<div class="view-select field"><label>Page</label><div class="input select" style="font-family: var(--sans)">${current[1]}${(() => {
		const m = current[2].replace(/<[^>]+>/g, '').trim()
		return m === '' ? '' : ' · ' + (m === '!' ? 'action needed' : m.toLowerCase())
	})()}</div>${(() => {
		const need = tabs
			.filter(t => t[0] !== on && /count">!/.test(t[2]))
			.map(t => {
				const m = t[2].replace(/<[^>]+>/g, '').trim()
				return t[1] + ' (' + (m === '!' ? 'action needed' : m) + ')'
			})
		return need.length === 0 ? '' : '<span class="hint">Needs attention: ' + need.join(', ') + '</span>'
	})()}</div>`
	document.querySelector('.portfolio-head').outerHTML = html
})()
