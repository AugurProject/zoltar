// Shared price-report component: security pool Price tab (10) and the branch price step (12b).
;(() => {
	for (const target of document.querySelectorAll('.price-report')) {
		const branch = target.dataset.branch === '1'
		target.outerHTML = `
		<div class="stack">
			${branch ? `<div class="steps compact"><div class="step done"><span class="mk">✓</span><div><div class="t">Prepare branch price feed</div></div><div class="act"><span class="btn sm done">Prepared</span></div></div></div>` : ''}
			<div class="grid-2">
				<div class="field"><label>${branch ? 'Branch REP price' : 'REP price'}</label><div class="input focus">240.00<span class="unit">REP per WETH</span></div><span class="hint">Last accepted${branch ? ' in the parent' : ''}: 220.00</span></div>
				<div class="field"><label>Report stake</label><div class="input">0.1050<span class="unit">WETH</span></div><span class="hint">Minimum 0.1000 WETH + 5% buffer</span></div>
			</div>
			<div role="img" aria-label="This report covers 25.00 WETH; current exposure is 10.00 WETH, leaving 15.00 WETH of headroom.">
				<div class="spread small"><span>This report covers</span><span class="num">25.00 WETH</span></div>
				<div class="segbar" style="margin-top: .3rem"><i style="width: 40%; background: var(--accent)"></i><i style="width: 60%; background: var(--success-soft)"></i></div>
				<div class="seglegend"><span><i style="background: var(--accent)"></i>Exposure now <b>10.00</b></span><span><i style="background: var(--success-soft)"></i>Headroom <b>15.00</b></span></div>
			</div>
			<dl class="kv"><dt>Settle bounty, paid by you</dt><dd>0.0010 ETH</dd></dl>
			<p class="notice warn" style="padding: .4rem .7rem">Disputers can trade against your quote. You may get back a different mix of WETH and REP.</p>
			<details class="disc how"><summary>How a price report works</summary><p>You fund a two-sided quote at your price. A report that covers less than the pool's exposure is rejected.</p></details>
			<div class="steps compact">
				<div class="step now"><span class="mk">1</span><div><div class="t">Wrap ETH</div><div class="s">Need 0.1050 WETH, have 0.0400</div></div><div class="act"><span class="btn sm primary">Wrap 0.0650 ETH</span></div></div>
				<div class="step"><span class="mk">2</span><div><div class="t">Approve WETH</div><div class="s">0.1050 WETH needed · <a>Adjust amount</a></div></div><div class="act"><span class="btn sm">Approve WETH</span></div></div>
				<div class="step"><span class="mk">3</span><div><div class="t">Approve REP</div><div class="s">25.20 ${branch ? 'branch ' : ''}REP needed, wallet has 2 310.00 · <a>Adjust amount</a></div></div><div class="act"><span class="btn sm">Approve REP</span></div></div>
				<div class="step locked"><span class="mk"></span><div><div><div class="t">Report ${branch ? 'branch ' : ''}REP price</div><div class="s">Gas now 8.2 nanoETH/gas, accepted up to 30</div></div></div><div class="act"><span class="btn sm disabled">Report price</span><span class="why">Approve WETH and REP first.</span></div></div>
			</div>
		</div>`
	}
})()
