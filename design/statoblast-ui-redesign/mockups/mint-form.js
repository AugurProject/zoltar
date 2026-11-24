// One shared mint form, used on the question page (03) and in the security pool Questions tab (09).
;(() => {
	for (const target of document.querySelectorAll('.mint-form')) {
		const withQuestion = target.dataset.question === '1'
		target.outerHTML = `
		<div class="stack">
			${withQuestion ? `<div class="field"><label>Question</label><div class="input select" style="font-family: var(--sans)">Will this resolve? (security pool question 1)</div><span class="hint"><a>Find by ID</a></span></div>` : ''}
			<div class="glyph" aria-label="2.50 WETH mints 2.50 Yes, 2.50 No and 2.50 Invalid shares"><span class="tok">2.50 WETH</span><span class="op">→</span><span class="tok y">2.50 Yes</span><span class="op">+</span><span class="tok n">2.50 No</span><span class="op">+</span><span class="tok i">2.50 Invalid</span></div>
			<div class="grid-2">
				<div class="field"><label>Collateral</label><div class="input focus">2.50<span class="unit">WETH, max 6.14</span></div></div>
				<details class="disc how" style="align-self: end"><summary>Limits: pay at most 0.0275 WETH fee, receive at least 2.4750 sets</summary>
					<div class="grid-2" style="margin-top: var(--s2)">
						<div class="field"><label class="small">Max fee</label><div class="input">0.0275<span class="unit">WETH</span></div></div>
						<div class="field"><label class="small">Min complete sets</label><div class="input">2.4750</div></div>
					</div>
					<p>Defaults: 10% above the quoted fee, 1% below the quoted sets.</p>
				</details>
			</div>
			<div class="grid-2">
				<dl class="kv ruled">
					<dt>Collateral</dt><dd>2.5000 WETH</dd>
					<dt>Fee</dt><dd>0.0250 WETH</dd>
					<dt>You pay</dt><dd>2.5250 WETH</dd>
				</dl>
				<div class="ruled">
					<div class="diff">
						<span>Your shares of each outcome</span><span class="before">1.00</span><span class="arrow">→</span><span class="after">3.50</span>
						<span>Wallet WETH</span><span class="before">6.2000</span><span class="arrow">→</span><span class="after">3.6750</span>
						<span>Security pool capacity free</span><span class="before">9.00</span><span class="arrow">→</span><span class="after">6.50</span>
					</div>
				</div>
			</div>
			<div class="steps compact">
				<div class="step done"><span class="mk">✓</span><div><div class="t">Approve WETH</div><div class="s">2.5250 needed, 10.00 approved. <a>Change allowance</a></div></div><div class="act"><span class="btn sm done">Approved</span></div></div>
				<div class="step now"><span class="mk">2</span><div><div class="t">Mint 2.50 complete sets</div></div><div class="act"><span class="btn sm primary">Mint</span></div></div>
			</div>
			<p class="mock-note">Design note: an inherited question that needs recovery REP adds a “Recovery REP” row to the cost list and an “Approve recovery REP” step. Both are hidden when the amount is 0.</p>
		</div>`
	}
})()
