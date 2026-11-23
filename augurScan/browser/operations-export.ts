export const renderHistoricalExport = (container: ParentNode, title: string, href: string): HTMLElement => {
	for (const row of container.querySelectorAll<HTMLElement>('[data-export-href]')) {
		if (row.dataset['exportHref'] === href) return row
	}

	const row = document.createElement('div')
	row.className = 'operations-row'
	row.dataset['exportHref'] = href
	const copy = document.createElement('div')
	const name = document.createElement('strong')
	name.textContent = title
	const status = document.createElement('span')
	status.setAttribute('role', 'status')
	status.textContent = 'NDJSON is downloaded one page at a time.'
	copy.append(name, status)

	const button = document.createElement('button')
	button.type = 'button'
	button.className = 'secondary compact'
	button.textContent = 'Download page 1'
	button.setAttribute('aria-label', `Download page 1 of ${title}`)
	row.append(copy, button)

	let page = 1
	let cursor: string | undefined
	const labelButton = (label: string) => {
		button.textContent = label
		button.setAttribute('aria-label', `${label} · ${title}`)
	}

	button.addEventListener('click', async () => {
		button.disabled = true
		delete status.dataset['errorDetail']
		status.textContent = `Downloading page ${page}…`
		try {
			const url = new URL(href, location.origin)
			if (cursor !== undefined) url.searchParams.set('cursor', cursor)
			const response = await fetch(url)
			if (response.status === 409 && cursor !== undefined) {
				cursor = undefined
				page = 1
				labelButton('Download page 1')
				status.textContent = 'The export snapshot changed. Download page 1 to restart.'
				return
			}
			if (!response.ok) throw new Error(`HTTP ${response.status}`)
			const nextCursor = response.headers.get('x-augurscan-next-cursor') ?? undefined
			if (response.headers.get('x-augurscan-truncated') !== String(nextCursor !== undefined)) throw new Error('Incomplete export continuation metadata')

			const file = URL.createObjectURL(await response.blob())
			const link = document.createElement('a')
			link.href = file
			link.download = `augurscan-${url.searchParams.get('dataset')}-${url.searchParams.get('chainId')}-page-${page}.ndjson`
			link.click()
			window.setTimeout(() => URL.revokeObjectURL(file), 0)

			cursor = nextCursor
			if (cursor === undefined) {
				status.textContent = `Page ${page} downloaded. Export complete.`
				page = 1
				labelButton('Download again')
			} else {
				status.textContent = `Page ${page} downloaded. More pages are available.`
				page++
				labelButton(`Download page ${page}`)
			}
		} catch (error) {
			status.dataset['errorDetail'] = error instanceof Error ? error.message : 'Unknown export failure'
			status.textContent = `Page ${page} could not be downloaded. Try again.`
		} finally {
			button.disabled = false
		}
	})
	return row
}
