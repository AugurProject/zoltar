import { expect } from 'bun:test'
import { explorerTransaction, state } from './dashboard-harness.ts'
import { cancellationHash, candidateHash, longCatalogBlocker, longCatalogLabel, topologyIdentifiers, transactionHash } from './dashboard-workflow-fixtures.ts'
import type { WorkflowRecoveryContext, WorkflowViewport } from './workflow-recovery-harness.ts'

// Staged per-viewport checks of the workflow-recovery dashboard test: the catalog, ecosystem, recovery, and activity routes.

/** The grouped operation catalog, its coverage aliases, filters, and narrow-viewport card layout. */
export async function verifyOperationCatalog(context: WorkflowRecoveryContext, viewport: WorkflowViewport) {
	const { cdp, dashboard, waitFor } = context
	await cdp.command('Page.navigate', { url: new URL('/catalog', dashboard.url).href })
	await waitFor("document.querySelector('header #last-block')?.textContent === 'Block 12345678'", 'Shared block header did not render on the catalog route')
	await waitFor("document.querySelector('#catalog-caption')?.textContent?.includes('2 live candidates') === true", 'Grouped operation catalog did not render')
	expect(await cdp.evaluate("document.querySelectorAll('#catalog-rows .operation-id-copy, #catalog-rows .operation-name small.mono').length")).toBe(0)
	await cdp.evaluate("document.querySelectorAll('#catalog-rows details').forEach(group => { group.open = true })")
	expect(
		await cdp.evaluate(`(() => {
			const alias = [...document.querySelectorAll('#catalog-rows tbody tr')].find(row => row.textContent?.includes('claimAuctionProceeds'))
			const selectableAlias = [...document.querySelectorAll('#catalog-rows tbody tr')].find(row => row.querySelector('.operation-name strong')?.textContent === 'WETH9.receive')
			const statoblast = [...document.querySelectorAll('#coverage-summary .coverage-card')].find(card => card.textContent?.includes('Statoblast'))
			return {
				aliasClassification: selectableAlias?.querySelector('td:nth-child(2) .badge')?.textContent,
				aliasCopyable: selectableAlias?.querySelector('.operation-id-copy') instanceof HTMLButtonElement,
				aliasEligibility: selectableAlias?.querySelector('td:nth-child(5) .badge')?.textContent,
				coverage: statoblast?.querySelector('strong')?.textContent,
				eligibility: alias?.querySelector('td:nth-child(5) .badge')?.textContent,
			}
		})()`),
	).toEqual({
		aliasClassification: 'Coverage alias',
		aliasCopyable: false,
		aliasEligibility: 'Not independently selectable',
		coverage: '0/0',
		eligibility: 'Not independently selectable',
	})
	const redundantCatalogCopy = await cdp.evaluate(`(() => {
		const normalize = value => value?.trim().replaceAll(/\\s+/g, ' ').replace(/[.?!]+$/, '').toLowerCase()
		return [...document.querySelectorAll('#catalog-rows tbody tr')].flatMap(row => {
			const description = row.querySelector('.operation-name > small:not(.mono)')?.textContent
			const normalizedDescription = normalize(description)
			if (normalizedDescription === undefined || normalizedDescription === '') return []
			const duplicate = [...row.querySelectorAll('.blocker-list li')].some(blocker => normalize(blocker.textContent) === normalizedDescription)
			return duplicate ? [row.querySelector('.operation-name strong')?.textContent] : []
		})
	})()`)
	expect(redundantCatalogCopy).toEqual([])
	expect(
		await cdp.evaluate(`(() => {
			const row = [...document.querySelectorAll('#catalog-rows tbody tr')].find(candidate => candidate.textContent?.includes('Pool.initialize'))
			return {
				blockers: [...(row?.querySelectorAll('.blocker-list li') ?? [])].map(blocker => blocker.textContent),
				descriptions: row?.querySelectorAll('.operation-name > small:not(.mono)').length,
			}
		})()`),
	).toEqual({ blockers: ['factory only'], descriptions: 0 })
	expect(
		await cdp.evaluate(`(() => {
			const row = [...document.querySelectorAll('#catalog-rows tbody tr')].find(candidate => candidate.querySelector('.operation-name strong')?.textContent === 'Settle report')
			return {
				blockers: row?.querySelectorAll('.blocker-list li').length,
				description: row?.querySelector('.operation-description')?.textContent,
			}
		})()`),
	).toEqual({ blockers: 0, description: 'Settle the anchored report.' })
	if (viewport.label === 'desktop') {
		expect(
			await cdp.evaluate(`({
					candidate: [...document.querySelectorAll('#catalog-rows tbody tr')].find(row => row.querySelector('.operation-name strong')?.textContent === 'Settle report')?.querySelector('td:nth-child(4)')?.textContent,
					rows: document.querySelectorAll('#catalog-rows tbody tr').length,
				})`),
		).toEqual({ candidate: '2', rows: 6 })
		expect(
			await cdp.evaluate(`(() => {
				const shell = document.querySelector('#catalog-rows .table-shell')
				const headers = [...shell.querySelectorAll('thead th')]
				if (!(shell instanceof HTMLElement)) return undefined
				const eligibilityBounds = headers.at(-1)?.getBoundingClientRect()
				return {
					allColumnsVisible: eligibilityBounds !== undefined && eligibilityBounds.right <= shell.getBoundingClientRect().right + 1,
					headerLabels: headers.map(header => header.textContent?.trim()),
					horizontalOverflow: shell.scrollWidth > shell.clientWidth,
				}
			})()`),
		).toEqual({ allColumnsVisible: true, headerLabels: ['Operation', 'Classification', 'Risk', 'Candidates', 'Eligibility'], horizontalOverflow: false })
		await cdp.evaluate(`(() => {
			const filter = document.querySelector('#catalog-classification-filter')
			if (!(filter instanceof HTMLSelectElement)) return
			filter.value = 'coverage-alias'
			filter.dispatchEvent(new Event('change', { bubbles: true }))
		})()`)
		expect(await cdp.evaluate(`document.querySelector('#catalog-rows')?.textContent?.includes('WETH9.receive') === true && document.querySelectorAll('#catalog-rows tbody tr').length === 1`)).toBe(true)
		await cdp.evaluate(`(() => {
				const filter = document.querySelector('#catalog-classification-filter')
				if (!(filter instanceof HTMLSelectElement)) return
				filter.value = 'role-restricted'
				filter.dispatchEvent(new Event('change', { bubbles: true }))
			})()`)
		expect(await cdp.evaluate(`document.querySelector('#catalog-rows')?.textContent?.includes('Pool.initialize') === true && document.querySelectorAll('#catalog-rows tbody tr').length === 1`)).toBe(true)
	} else {
		const mobileCatalog = await cdp.evaluate(`(() => {
			const shell = document.querySelector('#catalog-rows [data-ecosystem="open-oracle"] .table-shell')
			const row = [...document.querySelectorAll('#catalog-rows tbody tr')].find(candidate => candidate.querySelector('.operation-name strong')?.textContent === 'Blocked report sibling')
			if (!(shell instanceof HTMLElement) || !(row instanceof HTMLTableRowElement)) return undefined
			const operationLabel = row.querySelector('.operation-name strong')
			const blocker = row.querySelector('.blocker-list li')
			if (operationLabel !== null) operationLabel.textContent = ${JSON.stringify(longCatalogLabel)}
			if (blocker !== null) blocker.textContent = ${JSON.stringify(longCatalogBlocker)}
			shell.scrollLeft = shell.scrollWidth
			const cells = [...row.querySelectorAll(':scope > td')]
			const rowBounds = row.getBoundingClientRect()
			const shellBounds = shell.getBoundingClientRect()
			return {
				blocker: blocker?.textContent,
				candidateCount: cells[3]?.textContent?.trim(),
				cellLabels: cells.map(cell => getComputedStyle(cell, '::before').content.replaceAll('"', '')),
				cellsContained: cells.every(cell => {
					const bounds = cell.getBoundingClientRect()
					return bounds.left >= rowBounds.left - 1 && bounds.right <= rowBounds.right + 1 && cell.scrollWidth <= cell.clientWidth
				}),
				documentOverflow: document.body.scrollWidth > document.documentElement.clientWidth,
				eligibility: cells[4]?.querySelector('.badge')?.textContent,
				identity: operationLabel?.textContent,
				maximumHorizontalScroll: shell.scrollWidth - shell.clientWidth,
				risk: cells[2]?.querySelector('.badge')?.textContent,
				rowContained: rowBounds.left >= shellBounds.left - 1 && rowBounds.right <= shellBounds.right + 1 && row.scrollWidth <= row.clientWidth,
				rowDisplay: getComputedStyle(row).display,
				shellOverflow: shell.scrollWidth > shell.clientWidth,
			}
		})()`)
		const copyTargetHeights = await cdp.evaluate(`[...document.querySelectorAll('#catalog-rows .operation-open')].map(button => button.getBoundingClientRect().height)`)
		expect(Array.isArray(copyTargetHeights)).toBe(true)
		if (!Array.isArray(copyTargetHeights)) throw new Error('Mobile catalog Open operation controls did not render')
		expect(copyTargetHeights.length).toBeGreaterThan(0)
		for (const height of copyTargetHeights) expect(height).toBeGreaterThanOrEqual(44)
		expect(mobileCatalog).toEqual({
			blocker: longCatalogBlocker,
			candidateCount: '0',
			cellLabels: ['Operation', 'Classification', 'Risk', 'Candidates', 'Eligibility'],
			cellsContained: true,
			documentOverflow: false,
			eligibility: 'Blocked',
			identity: longCatalogLabel,
			maximumHorizontalScroll: 0,
			risk: 'Low',
			rowContained: true,
			rowDisplay: 'grid',
			shellOverflow: false,
		})
	}
}

/** The anchored topology panels and ecosystem readiness cards. */
export async function verifyEcosystemTopology(context: WorkflowRecoveryContext, viewport: WorkflowViewport) {
	const { cdp, dashboard, expectVisibleIdentifiers, waitFor } = context
	await cdp.command('Page.navigate', { url: new URL('/ecosystem', dashboard.url).href })
	await waitFor("document.querySelector('#topology-anchor')?.textContent === 'Block 4242'", `${viewport.label} anchored topology did not render`)
	expect(await cdp.evaluate(`[...document.querySelectorAll('#ecosystem-grid .ecosystem-metrics')].map(metrics => [...metrics.querySelectorAll('span')].map(label => label.textContent))`)).toEqual(Array.from({ length: 4 }, () => ['Ready for random work', 'Selected for random work', 'Lifecycle ready']))
	expect(await cdp.evaluate("document.querySelector('#topology-status')?.textContent")).toBe('5 protocol identities · discovery complete.')
	expect(
		await cdp.evaluate(`({
				auctions: document.querySelectorAll('#topology-auctions .topology-row').length,
				pairs: document.querySelectorAll('#topology-pairs .topology-row').length,
				pools: document.querySelectorAll('#topology-pools .topology-row').length,
				reports: document.querySelectorAll('#topology-reports .topology-row').length,
				universes: document.querySelectorAll('#topology-universes .topology-row').length,
			})`),
	).toEqual({ auctions: 1, pairs: 1, pools: 1, reports: 1, universes: 1 })
	const topologyPresentation = await cdp.evaluate(`({
		summaryHeights: [...document.querySelectorAll('.topology-grid summary')].map(summary => summary.getBoundingClientRect().height),
		topbarBackground: getComputedStyle(document.querySelector('.operator-shell')).backgroundColor,
	})`)
	expect(Reflect.get(Object(topologyPresentation), 'topbarBackground')).toBe('color(srgb 0.0627451 0.0823529 0.113725 / 0.82)')
	const summaryHeights = Reflect.get(Object(topologyPresentation), 'summaryHeights')
	expect(summaryHeights).toHaveLength(5)
	if (!Array.isArray(summaryHeights)) throw new Error('Missing topology summary bounds')
	for (const height of summaryHeights) {
		if (typeof height !== 'number') throw new Error('Missing topology summary bounds')
		expect(height).toBeGreaterThanOrEqual(44)
	}
	await expectVisibleIdentifiers(topologyIdentifiers, viewport.width === 390 ? 44 : 32, '.topology-panel .full-identifier')
	const ecosystemCards = await cdp.evaluate(`[...document.querySelectorAll('#ecosystem-grid .ecosystem-card')].map(card => ({
		blockers: [...card.querySelectorAll('.blocker-list li')].map(item => item.textContent),
		ecosystem: card.getAttribute('data-ecosystem'),
		readiness: card.querySelector('.panel-heading .badge')?.textContent,
		summary: card.querySelector(':scope > p, :scope > ul')?.textContent,
	}))`)
	const openOracleCard = Array.isArray(ecosystemCards) ? ecosystemCards.find(card => Reflect.get(card, 'ecosystem') === 'open-oracle') : undefined
	const tradingCard = Array.isArray(ecosystemCards) ? ecosystemCards.find(card => Reflect.get(card, 'ecosystem') === 'trading') : undefined
	expect(openOracleCard).toEqual({ blockers: [], ecosystem: 'open-oracle', readiness: 'Lifecycle ready' })
	expect(tradingCard).toEqual({ blockers: ['Router enter: No safe route exists'], ecosystem: 'trading', readiness: 'Blocked', summary: 'Router enter: No safe route exists' })
	expect(await cdp.evaluate('document.body.scrollWidth === document.documentElement.clientWidth')).toBe(true)
}

/** Pending transaction recovery forms, identifiers, obligation retries, and the recovery textarea states. */
export async function verifyRecoveryRoute(context: WorkflowRecoveryContext, viewport: WorkflowViewport) {
	const { cdp, dashboard, expectVisibleIdentifiers, fixture, waitFor } = context
	await cdp.command('Page.navigate', { url: new URL('/recovery', dashboard.url).href })
	await waitFor("document.querySelector('#pending-transactions .identifier-value') !== null", `${viewport.label} recovery identifiers did not render`)
	expect(
		await cdp.evaluate(`({
			replacement: document.querySelector('#replacement-form')?.hidden,
			cancellation: document.querySelector('#cancellation-form')?.hidden,
			candidate: document.querySelector('#candidate-form')?.hidden,
		})`),
	).toEqual({ replacement: true, cancellation: true, candidate: false })
	expect(await cdp.evaluate("document.querySelector('#pending-transactions .transaction-wait strong')?.textContent")).toBe('Verifying the queued replacement')
	expect(
		await cdp.evaluate(`(() => {
			const row = document.querySelector('#pending-transactions .stack-row')
			const note = row?.querySelector('.transaction-wait')
			const headline = note?.querySelector('strong')
			const detail = note?.querySelector('small')
			if (!(row instanceof HTMLElement) || !(note instanceof HTMLElement) || !(headline instanceof HTMLElement) || !(detail instanceof HTMLElement)) return undefined
			const rowStyle = getComputedStyle(row)
			const noteStyle = getComputedStyle(note)
			const contentHeight = headline.offsetHeight + detail.offsetHeight + parseFloat(noteStyle.rowGap) + parseFloat(noteStyle.paddingTop) + parseFloat(noteStyle.paddingBottom) + parseFloat(noteStyle.borderTopWidth) + parseFloat(noteStyle.borderBottomWidth)
			return {
				contained: note.getBoundingClientRect().bottom <= row.getBoundingClientRect().bottom && note.getBoundingClientRect().top >= row.getBoundingClientRect().top,
				contentSized: Math.abs(note.offsetHeight - contentHeight) <= 2,
				fullWidth: Math.round(note.getBoundingClientRect().width) === Math.round(row.clientWidth - parseFloat(rowStyle.paddingLeft) - parseFloat(rowStyle.paddingRight)),
			}
		})()`),
	).toEqual({ contained: true, contentSized: true, fullWidth: true })
	await expectVisibleIdentifiers(
		[
			{ explorerUrl: explorerTransaction(transactionHash), type: 'pending transaction hash', value: transactionHash },
			{ explorerUrl: explorerTransaction(candidateHash), type: 'replacement transaction hash', value: candidateHash },
			{ explorerUrl: explorerTransaction(cancellationHash), type: 'cancellation transaction hash', value: cancellationHash },
		],
		viewport.width === 390 ? 44 : 32,
	)
	expect(
		await cdp.evaluate(`({
			obligation: document.querySelector('#obligations .badge')?.textContent,
			option: document.querySelector('#obligation-id option')?.textContent,
			pending: document.querySelector('#pending-transactions .badge')?.textContent,
		})`),
	).toEqual({ obligation: 'Executing', option: 'Rendered obligation · Executing', pending: 'Waiting transaction' })
	expect(
		await cdp.evaluate(`(() => {
			const row = [...document.querySelectorAll('#obligations .stack-row')].find(candidate => candidate.textContent?.includes('Deferred obligation'))
			return { detail: row?.querySelector('small')?.textContent, status: row?.querySelector('.badge')?.textContent, tone: row?.querySelector('.badge')?.className }
		})()`),
	).toEqual({ detail: 'OpenOracle · 1 of 3 included attempts failed · next attempt Aug 24, 2026, 12:03:00 AM', status: 'Retry waiting', tone: 'badge warning' })
	const recoveryTextarea = await cdp.evaluate(`(() => {
		const fields = document.querySelector('#candidate-fields')
		const input = document.querySelector('#candidate-confirmation')
		const textarea = document.querySelector('#candidate-reason')
		if (!(fields instanceof HTMLFieldSetElement) || !(input instanceof HTMLInputElement) || !(textarea instanceof HTMLTextAreaElement)) return undefined
		const disabled = textarea.matches(':disabled')
		const disabledStyle = getComputedStyle(textarea)
		const inputStyle = getComputedStyle(input)
		const styledLikeInput =
			disabledStyle.backgroundColor === inputStyle.backgroundColor &&
			disabledStyle.borderColor === inputStyle.borderColor &&
			disabledStyle.borderRadius === inputStyle.borderRadius &&
			disabledStyle.color === inputStyle.color &&
			disabledStyle.fontFamily === inputStyle.fontFamily
		fields.disabled = false
		textarea.value = 'Operator confirmed the canonical recovery state.'
		textarea.focus()
		const enabledStyle = getComputedStyle(textarea)
		return {
			disabled,
			enabled: !textarea.matches(':disabled'),
			minimumHeight: Number.parseFloat(enabledStyle.minHeight),
			styledLikeInput,
			value: textarea.value,
		}
	})()`)
	expect(recoveryTextarea).toEqual({
		disabled: true,
		enabled: true,
		minimumHeight: 80,
		styledLikeInput: true,
		value: 'Operator confirmed the canonical recovery state.',
	})
	const previousInitialState = fixture.initialDashboardState
	const previousRecoveredState = fixture.recoveredDashboardState
	fixture.initialDashboardState = state({ pendingTransactions: [{ hash: transactionHash, replacementHash: candidateHash, status: 'submitted' }] })
	fixture.recoveredDashboardState = fixture.initialDashboardState
	await cdp.evaluate("window.dispatchEvent(new Event('focus'))")
	await waitFor("document.querySelector('#rpc-health-retry-button')?.disabled === false && document.querySelector('#candidate-reason')?.matches(':disabled') === false", 'Recovery textarea did not become available from current state')
	await cdp.evaluate("document.querySelector('#candidate-reason')?.focus()")
	await cdp.command('Input.dispatchKeyEvent', { code: 'Tab', key: 'Tab', type: 'keyDown', windowsVirtualKeyCode: 9 })
	await cdp.command('Input.dispatchKeyEvent', { code: 'Tab', key: 'Tab', type: 'keyUp', windowsVirtualKeyCode: 9 })
	await cdp.command('Input.dispatchKeyEvent', { code: 'Tab', key: 'Tab', modifiers: 8, type: 'keyDown', windowsVirtualKeyCode: 9 })
	await cdp.command('Input.dispatchKeyEvent', { code: 'Tab', key: 'Tab', modifiers: 8, type: 'keyUp', windowsVirtualKeyCode: 9 })
	expect(
		await cdp.evaluate(`(() => {
			const textarea = document.querySelector('#candidate-reason')
			if (!(textarea instanceof HTMLTextAreaElement)) return undefined
			const style = getComputedStyle(textarea)
			return { focused: document.activeElement === textarea, outlineStyle: style.outlineStyle, outlineWidth: style.outlineWidth }
		})()`),
	).toEqual({ focused: true, outlineStyle: 'solid', outlineWidth: '2px' })
	fixture.initialDashboardState = previousInitialState
	fixture.recoveredDashboardState = previousRecoveredState
}

/** The overview activity list renders without an expand control. */
export async function verifyOverviewActivity(context: WorkflowRecoveryContext, viewport: WorkflowViewport) {
	const { cdp, dashboard, waitFor } = context
	await cdp.command('Page.navigate', { url: new URL('/overview', dashboard.url).href })
	await waitFor("document.querySelector('#activity-list .identifier-value') !== null", `${viewport.label} overview activity did not render`)
	expect(
		await cdp.evaluate(`({
			activity: document.querySelector('#activity-list .badge')?.textContent,
			expandHidden: document.querySelector('#activity-expand')?.classList.contains('hidden'),
		})`),
	).toEqual({ activity: 'Dry run', expandHidden: true })
}
