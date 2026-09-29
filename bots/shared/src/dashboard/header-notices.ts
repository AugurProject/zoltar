function initializeHeaderNotices() {
	const disclosure = document.getElementById('header-notices')
	const toggle = document.getElementById('header-notices-toggle')
	const count = document.getElementById('header-notices-count')
	const empty = document.getElementById('header-notices-empty')
	const status = document.getElementById('header-notices-status')
	const notices = disclosure?.querySelector('.operator-notices')
	if (!(disclosure instanceof HTMLDetailsElement) || !(toggle instanceof HTMLElement) || count === null || !(empty instanceof HTMLElement) || status === null || notices === undefined || notices === null) throw new Error('Bot notice controls are missing')

	const update = () => {
		const visible = [...notices.querySelectorAll<HTMLElement>('.notice')].filter(notice => notice.textContent?.trim() !== '' && notice.closest('[hidden], .hidden') === null)
		const errors = visible.filter(notice => notice.matches('.error, .warning, [data-tone="danger"], [data-tone="warning"]'))
		const label = errors.length === 0 ? 'No errors or warnings' : `${errors.length.toString()} ${errors.length === 1 ? 'error or warning' : 'errors and warnings'}`
		count.textContent = errors.length.toString()
		toggle.setAttribute('aria-label', `${label}. Bot notices`)
		disclosure.classList.toggle('has-errors', errors.length > 0)
		empty.hidden = visible.length > 0
		if (status.textContent !== label) status.textContent = label
	}
	const dismiss = (restoreFocus: boolean) => {
		disclosure.open = false
		if (restoreFocus) toggle.focus()
	}
	document.addEventListener('click', event => {
		if (disclosure.open && !event.composedPath().includes(disclosure)) dismiss(false)
	})
	disclosure.addEventListener('click', event => {
		if (event.target instanceof Element && event.target.closest('a[href]') !== null) dismiss(false)
	})
	document.addEventListener('keydown', event => {
		if (event.key === 'Escape' && disclosure.open) {
			event.preventDefault()
			dismiss(true)
		}
	})
	const revealLinkedNotice = () => {
		const id = window.location.hash.slice(1)
		const target = document.getElementById(id)
		if (target !== null && notices.contains(target)) disclosure.open = true
	}
	window.addEventListener('hashchange', revealLinkedNotice)
	window.addEventListener('popstate', revealLinkedNotice)
	const observer = new MutationObserver(update)
	const observeNotices = () => {
		observer.observe(notices, { attributes: true, attributeFilter: ['class', 'hidden', 'data-tone'], childList: true, characterData: true, subtree: true })
		update()
	}
	window.addEventListener('pagehide', () => observer.disconnect())
	window.addEventListener('pageshow', observeNotices)
	observeNotices()
	revealLinkedNotice()
}

initializeHeaderNotices()

export {}
