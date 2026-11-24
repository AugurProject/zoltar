;(() => {
	// Questions and security pool pages both live under the Watchlist: every question belongs to one security pool.
	const rawTab = document.body.dataset.tab ?? ''
	const tab = rawTab === 'questions' || rawTab === 'portfolios' ? 'watchlist' : rawTab
	const forked = document.body.dataset.forked === '1'
	const menuOpen = document.body.dataset.umenu === 'open'
	const tabs = [
		['watchlist', 'Watchlist', '★'],
		['reports', 'Price reports', '◷'],
	]
	// Universe menu: a button opens a non-modal popover of ordinary links and buttons (not role="menu").
	// Esc closes it and returns focus to the button. Desktop: role="dialog" without aria-modal (non-modal popover).
	// Phones: the same element becomes a bottom sheet over a scrim, so it is aria-modal="true" with focus kept inside and a visible Close button. data-umenu="open" renders it open; data-parent-rep="1" shows REP left in a forked parent.
	const parentRep = document.body.dataset.parentRep === '1'
	const alert = forked || parentRep
	const alertLabel = forked ? 'This universe forked, action needed' : 'You still have REP in the forked parent universe'
	const migrateRow = '<a class="umenu-row strong" href="#/universes">Universes &amp; REP migration<span class="small muted">→</span></a>'
	const allRow = '<a class="umenu-row strong" href="#/universes?all=1">All universes<span class="small muted">→</span></a>'
	const forkedMenu = `<div class="umenu" id="umenu" role="dialog" aria-label="Universe">
			<div class="umenu-head"><span class="section-label">Universe</span><span class="row"><span class="badge bad">Forked</span><button type="button" class="btn sm link umenu-close">Close</button></span></div>
			<div class="umenu-cur"><b class="mono">Augur v2 › Yes</b><span class="small muted">Universe #4, frozen since Nov 24</span><span class="small muted">Your REP here: <span class="nowrap">2 310.00</span></span><span class="small muted">No deadline to migrate it.</span></div>
			<div class="section-label" style="margin-top: var(--s2)">Child universes</div>
			<a class="umenu-row" href="#/universes?child=12"><span><b>Yes</b> <span class="muted small">#12</span></span><span class="small muted">Your REP: 0.00</span></a>
			<a class="umenu-row" href="#/universes?child=13"><span><b>No</b> <span class="muted small">#13</span></span><span class="small muted">Your REP: 0.00</span></a>
			<div class="umenu-row static"><span><b>Invalid</b> <span class="muted small">#14</span></span><span class="small muted">Not created yet. Created when you migrate REP to it.</span></div>
			<div class="umenu-actions"><a class="btn sm primary" href="#/universes">Migrate REP…</a></div>
			${allRow}
		</div>`
	const parentRepMenu = `<div class="umenu" id="umenu" role="dialog" aria-label="Universe">
			<div class="umenu-head"><span class="section-label">Universe</span><span class="row"><span class="badge ok">Active</span><button type="button" class="btn sm link umenu-close">Close</button></span></div>
			<div class="umenu-cur"><b class="mono">Augur v2 › Yes</b><span class="small muted">Universe #4</span><span class="small muted">Your REP here: <span class="nowrap">2 310.00</span></span></div>
			<div class="notice warn" style="padding: .5rem .7rem"><b><span class="nowrap">1 250.00 REP</span> is still in Augur v2</b>, which forked. Migrate it to use it here. No deadline.</div>
			<div class="umenu-actions"><a class="btn sm primary" href="#/universes">Migrate REP…</a></div>
			<a class="umenu-row" href="#/universes?universe=0"><span>Augur v2 <span class="muted small">#0, forked parent</span></span><span class="small muted">View</span></a>
			${allRow}
		</div>`
	const activeMenu = `<div class="umenu" id="umenu" role="dialog" aria-label="Universe">
			<div class="umenu-head"><span class="section-label">Universe</span><span class="row"><span class="badge ok">Active</span><button type="button" class="btn sm link umenu-close">Close</button></span></div>
			<div class="umenu-cur"><b class="mono">Augur v2 › Yes</b><span class="small muted">Universe #4</span><span class="small muted">Your REP here: <span class="nowrap">2 310.00</span></span></div>
			<a class="umenu-row" href="#/universes?universe=0"><span>Augur v2 <span class="muted small">#0, forked parent</span></span><span class="small muted">View</span></a>
			${migrateRow}
		</div>`
	let universeMenu = activeMenu
	if (forked) universeMenu = forkedMenu
	else if (parentRep) universeMenu = parentRepMenu
	// The banner's action depends on where you are: security pool pages need a branch choice, the universes page needs none
	const onPoolPage = document.body.dataset.ptab !== undefined
	const onUniverses = rawTab === 'universes'
	// After the branch choice is committed (data-branch-chosen), security pool pages need no banner action
	const branchChosen = document.body.dataset.branchChosen === '1'
	let bannerAction = '<span class="row"><a class="btn sm" href="#/universes">Migrate REP…</a><a class="small" href="#/universes">How to move shares and capital</a></span>'
	if (onUniverses || (onPoolPage && branchChosen)) bannerAction = ''
	else if (onPoolPage) bannerAction = '<span class="row"><a class="btn sm" href="#/fork">Choose a branch…</a></span>'
	const header = `
	<header class="app-header">
		<div class="brand"><img src="favicon.svg" alt="" />Augur Statoblast</div>
		<nav class="tabs">${tabs.map(([id, label]) => `<a class="${tab === id ? 'on' : ''}">${label}</a>`).join('')}</nav>
		<div class="header-right">
			<span class="chip hide-m num" title="REP price">1 REP = 0.0045 ETH</span>
			<span class="umenu-wrap"><button type="button" class="chip universe-chip${menuOpen ? ' open' : ''}" aria-expanded="${menuOpen}"${menuOpen ? ' aria-controls="umenu"' : ''}><span class="hide-m" style="font-weight: 400; opacity: .75">Universe </span>Augur v2 › Yes${alert ? ` <span class="count" aria-hidden="true">!</span><span class="sr">, ${alertLabel}</span>` : ''} ▾</button>${menuOpen ? universeMenu : ''}</span>
			<span class="chip num"><span class="dot"></span>0x7a3f…91c2</span>
			<span class="chip" aria-label="Activity">◴<span class="icon-label"> Activity</span></span>
			<span class="chip" aria-label="Settings">⚙<span class="icon-label"> Settings</span></span>
		</div>
	</header>
	${forked ? `<div class="universe-banner"><span><b>This universe forked</b>. Minting, takeovers and price reports are closed. Move your REP, shares and capital to a child universe.</span>${bannerAction}</div>` : ''}`
	const bottom = `<nav class="bottom-nav">${tabs.map(([id, label, icon]) => `<a class="${tab === id ? 'on' : ''}"><span class="i">${icon}</span>${label}</a>`).join('')}</nav>`
	const page = document.querySelector('.page')
	if (tab !== 'none') page.insertAdjacentHTML('afterbegin', header)
	if (menuOpen) page.insertAdjacentHTML('afterbegin', '<div class="umenu-scrim" aria-hidden="true"></div>')
	if (tab !== 'none') page.insertAdjacentHTML('beforeend', bottom)
	const lock = '<svg width="11" height="12" viewBox="0 0 11 12" aria-hidden="true"><rect x="1" y="5" width="9" height="7" rx="1.5" fill="currentColor"/><path d="M3 5V3.5a2.5 2.5 0 0 1 5 0V5" stroke="currentColor" fill="none" stroke-width="1.5"/></svg>'
	document.addEventListener('DOMContentLoaded', () => {
		let n = 0
		// Every disabled button in a locked step is described by that step's reason (accessible description + native tooltip).
		for (const step of document.querySelectorAll('.step.locked')) {
			const reason = step.querySelector(':scope > .act > .sr, :scope > .act .sr')
			if (reason === null) continue
			if (!reason.id) reason.id = `lockreason${n++}`
			for (const btn of step.querySelectorAll('.btn.disabled')) {
				btn.setAttribute('aria-describedby', reason.id)
				btn.title = reason.textContent.trim()
			}
		}
		// Each locked step shows its own reason, visibly, right beside its title. The hidden copy becomes the visible one,
		// so the reason is read once; a locked step without a reason falls back to the generic line.
		for (const step of document.querySelectorAll('.step.locked')) {
			const title = step.querySelector(':scope > div:not(.act) > .t')
			if (title === null) continue
			const reason = step.querySelector(':scope > .act > .sr, :scope > .act .sr')
			const line = document.createElement('div')
			line.className = 's'
			line.textContent = reason === null ? 'Waits for the step above' : reason.textContent.trim()
			if (reason !== null) {
				line.id = reason.id
				reason.remove()
			}
			title.after(line)
		}
		for (const mk of document.querySelectorAll('.step.locked > .mk, .lock-icon')) mk.innerHTML = lock
	})
	for (const table of document.querySelectorAll('table.stackable')) {
		const labels = [...table.querySelectorAll('thead th')].map(th => th.textContent.trim())
		for (const row of table.querySelectorAll('tbody tr'))
			[...row.children].forEach((cell, i) => {
				if (i > 0 && labels[i] && cell.colSpan === 1 && cell.dataset.label === undefined) cell.dataset.label = labels[i]
			})
	}
})()
// Addresses and IDs never wrap: each shows in full when its line has room, otherwise shortened in the middle
// to 0x + 10 … 10 characters, never fewer: a 4…4 form is cheap to imitate with a look-alike address.
// The full value stays available as a tooltip, to screen readers, and when copied.
;(() => {
	const PATTERN = /0x[0-9a-fA-F]{64}|0x[0-9a-fA-F]{40}/g
	const SKIP = 'script, style, svg, title, textarea, .input, .addr, .sr, .header-right'
	const wrap = root => {
		const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, { acceptNode: n => (n.parentElement?.closest(SKIP) || !/0x[0-9a-fA-F]{40}/.test(n.nodeValue) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT) })
		const nodes = []
		while (walker.nextNode()) nodes.push(walker.currentNode)
		for (const node of nodes) {
			const frag = document.createDocumentFragment()
			let last = 0
			const text = node.nodeValue
			for (const m of text.matchAll(PATTERN)) {
				if (m.index > last) frag.append(text.slice(last, m.index))
				const span = document.createElement('span')
				span.className = 'addr'
				span.dataset.full = m[0]
				render(span, 0)
				frag.append(span)
				last = m.index + m[0].length
			}
			if (last < text.length) frag.append(text.slice(last))
			node.replaceWith(frag)
		}
	}
	const KEEP = [0, 10]
	const COPY_ICON = '<svg width="13" height="13" viewBox="0 0 13 13" aria-hidden="true"><rect x="4" y="4" width="8" height="8" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M2.5 9V2.5a1 1 0 0 1 1-1H9" fill="none" stroke="currentColor" stroke-width="1.3"/></svg>'
	const copyButtonOf = span => (span.nextElementSibling?.classList.contains('addr-copy') ? span.nextElementSibling : undefined)
	const render = (span, level) => {
		const full = span.dataset.full
		span.dataset.level = String(level)
		copyButtonOf(span)?.remove()
		if (level === 0) {
			span.textContent = full
			span.removeAttribute('title')
			return
		}
		// A shortened address outside a link gets a copy button, so touch and keyboard users can get the full value
		if (!span.closest('a, button, .btn, .umenu-row, .crumbs')) span.insertAdjacentHTML('afterend', `<button type="button" class="addr-copy" data-full="${full}" aria-label="Copy ${full}" title="Copy full address">${COPY_ICON}</button>`)
		const n = KEEP[level]
		span.title = full
		span.innerHTML = `<span aria-hidden="true">${full.slice(0, 2 + n)}…${full.slice(-n)}</span><span class="sr">${full}</span>`
	}
	const contentRight = el => {
		const r = el.getBoundingClientRect()
		const cs = getComputedStyle(el)
		return r.right - parseFloat(cs.paddingRight) - parseFloat(cs.borderRightWidth)
	}
	const blockOf = el => {
		let p = el.parentElement
		while (p && getComputedStyle(p).display.startsWith('inline')) p = p.parentElement
		return p
	}
	const fits = span => {
		const right = (copyButtonOf(span) ?? span).getBoundingClientRect().right
		const limits = [blockOf(span), span.closest('td, th, dd'), span.closest('.card, .drawer, .umenu, .dialog, .notice, .page')]
		if (right > document.documentElement.clientWidth) return false
		return limits.every(el => !el || right <= contentRight(el) + 0.5)
	}
	// Stack every address row of a key/value list (label above value), so the list keeps one layout
	const stackRows = dd => {
		const dl = dd.closest('dl')
		const rows = dl ? [...dl.querySelectorAll(':scope > dd')].filter(d => d.querySelector('.addr')) : [dd]
		for (const d of rows) {
			d.classList.add('addr-line')
			d.previousElementSibling?.classList.add('addr-line')
		}
	}
	const fitOne = s => {
		if (fits(s)) return
		const dd = s.closest('dd')
		const metric = s.closest('.metric')
		if (dd && !dd.classList.contains('addr-line')) {
			stackRows(dd)
			if (fits(s)) return
		}
		if (metric && !metric.classList.contains('addr-line')) {
			metric.classList.add('addr-line')
			if (fits(s)) return
		}
		render(s, 1)
		if (!fits(s)) {
			s.classList.add('addr-wrap')
			console.warn('ADDR_WRAP', s.dataset.full)
		}
	}
	const fit = () => {
		const spans = [...document.querySelectorAll('.addr')]
		for (const s of spans) {
			s.classList.remove('addr-wrap')
			if (s.dataset.level !== '0') render(s, 0)
		}
		for (const el of document.querySelectorAll('.addr-line')) el.classList.remove('addr-line')
		for (let pass = 0; pass < 3; pass++) {
			for (const s of spans) if (s.dataset.level === '0') fitOne(s)
			// A table that grew past its card because of long values shortens the addresses inside it
			for (const table of document.querySelectorAll('table')) {
				const box = table.closest('.card, .drawer, .page')
				if (!box || table.getBoundingClientRect().right <= contentRight(box) + 0.5) continue
				for (const s of table.querySelectorAll('.addr')) if (s.dataset.level === '0') render(s, 1)
			}
		}
		// One length per table or menu, so rows stay comparable
		for (const list of document.querySelectorAll('table, .umenu')) {
			const inList = [...list.querySelectorAll('.addr')].filter(s => s.closest('table, .umenu') === list)
			if (inList.some(s => s.dataset.level === '1')) for (const s of inList) if (s.dataset.level === '0') render(s, 1)
		}
	}
	document.addEventListener('click', event => {
		const button = event.target instanceof Element ? event.target.closest('.addr-copy') : null
		if (!button) return
		navigator.clipboard?.writeText(button.dataset.full ?? '')
		button.title = 'Copied'
		button.classList.add('copied')
	})
	window.fitAddresses = root => {
		wrap(root ?? document.body)
		fit()
	}
	// Copying a selection that contains a shortened address copies the full value
	document.addEventListener('copy', event => {
		const sel = getSelection()
		if (!sel || sel.rangeCount === 0) return
		const box = document.createElement('div')
		box.append(sel.getRangeAt(0).cloneContents())
		const shortened = box.querySelectorAll('.addr')
		if (shortened.length === 0) return
		for (const s of shortened) s.replaceWith(s.dataset.full ?? s.textContent)
		event.clipboardData?.setData('text/plain', box.textContent)
		event.preventDefault()
	})
	document.addEventListener('DOMContentLoaded', () => window.fitAddresses())
	let t
	addEventListener('resize', () => {
		clearTimeout(t)
		t = setTimeout(fit, 100)
	})
})()
