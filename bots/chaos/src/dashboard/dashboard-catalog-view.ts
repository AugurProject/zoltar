import type { createSelectionControls } from './selection-controls.js'
import type { createOperationDialog } from './operation-dialog.js'
import { node, setBadge, statusLabel } from './dom.js'
import { type OperationEvaluation } from './dashboard-data.ts'

type DashboardCatalogViewContext = {
	catalogFilter: HTMLSelectElement
	catalogClassificationFilter: HTMLSelectElement
	catalogEligibilityFilter: HTMLSelectElement
	catalogSignature: string
	normalizeEcosystem: (value: string | undefined) => string
	displayedClassification: (value: OperationEvaluation) => string | undefined
	operationIsIndependentlyExecutable: (value: OperationEvaluation) => boolean
	publicCandidateCount: (value: string | number | undefined) => string | number | undefined
	catalogCaption: HTMLParagraphElement
	catalogRowCache: Map<string, { row: HTMLTableRowElement; signature: string }>
	classificationLabel: (value: string | undefined) => 'Lifecycle obligation' | 'Excluded: dangerous' | 'Role restricted' | 'Workflow prerequisite' | 'Randomly selectable' | 'Coverage alias' | 'Classification unavailable'
	operationDialog: ReturnType<typeof createOperationDialog>
	selectionControls: ReturnType<typeof createSelectionControls>
	catalogRows: HTMLDivElement
	renderCatalogGroups: (rows: HTMLTableRowElement[]) => void
	updateSelectionControls: () => void
	ecosystemOrder: readonly ['zoltar', 'statoblast', 'open-oracle', 'trading']
	parsePositiveNumber: (value: string | number | undefined) => number | undefined
	ecosystemLabels: Map<string, string>
	ecosystemGrid: HTMLDivElement
}

export function createDashboardCatalogView(context: DashboardCatalogViewContext) {
	function normalizedCatalogCopy(value: string) {
		return value
			.trim()
			.replaceAll(/\s+/g, ' ')
			.replace(/[.?!]+$/, '')
			.toLowerCase()
	}

	function renderCatalog(values: OperationEvaluation[]) {
		if (document.querySelector('#operation-dialog[open]') !== null) return
		const selectedEcosystem = context.catalogFilter.value
		const selectedClassification = context.catalogClassificationFilter.value
		const selectedEligibility = context.catalogEligibilityFilter.value
		const signature = JSON.stringify({ values, selectedEcosystem, selectedClassification, selectedEligibility })
		if (signature === context.catalogSignature) return
		context.catalogSignature = signature
		const filtered = values.filter(value => {
			if (selectedEcosystem !== 'all' && context.normalizeEcosystem(value.ecosystem) !== selectedEcosystem) return false
			if (selectedClassification !== 'all' && context.displayedClassification(value) !== selectedClassification) return false
			const independentlyExecutable = context.operationIsIndependentlyExecutable(value)
			const eligible = independentlyExecutable && value.enabled !== false && value.eligible === true
			let eligibility = 'blocked'
			if (!independentlyExecutable) eligibility = 'not-selectable'
			else if (value.enabled === false) eligibility = 'disabled'
			else if (eligible) eligibility = 'eligible'
			return selectedEligibility === 'all' || selectedEligibility === eligibility
		})
		const candidateTotal = filtered.reduce((total, value) => total + BigInt(context.publicCandidateCount(value.candidateCount) ?? 0), 0n)
		context.catalogCaption.textContent = `${filtered.length.toString()} of ${values.length.toString()} classified catalog entr${values.length === 1 ? 'y' : 'ies'} shown · ${candidateTotal.toString()} live candidate${candidateTotal === 1n ? '' : 's'}.`
		const rows = filtered.map(value => {
			const key = value.id ?? ''
			const rowSignature = JSON.stringify(value)
			const reused = context.catalogRowCache.get(key)
			// Reusing an unchanged row keeps its checkbox, focus, and layout untouched across polls.
			if (reused !== undefined && reused.signature === rowSignature) return reused.row
			const row = document.createElement('tr')
			const enabled = value.enabled !== false
			const independentlyExecutable = context.operationIsIndependentlyExecutable(value)
			const displayClassification = context.displayedClassification(value)
			const eligible = independentlyExecutable && enabled && value.eligible === true
			let displayedBlockers: string[] = []
			if (!eligible) {
				displayedBlockers = value.blockers
				if (displayedBlockers.length === 0) {
					if (!independentlyExecutable) displayedBlockers = ['This surface is classified for coverage but cannot be selected as a standalone operation']
					else if (!enabled) displayedBlockers = ['Disabled by operator policy']
					else displayedBlockers = ['No eligible candidate in current state']
				}
			}
			const nameCell = node('td', 'operation-name')
			nameCell.append(node('strong', undefined, value.label ?? value.id ?? 'Unnamed operation'))
			const description = value.description?.trim()
			if (description !== undefined && description !== '' && !displayedBlockers.some(blocker => normalizedCatalogCopy(blocker) === normalizedCatalogCopy(description))) {
				nameCell.append(node('small', 'operation-description', description))
			}
			const classificationCell = node('td')
			const classificationBadge = node('span')
			let classificationTone: Parameters<typeof setBadge>[2] = 'success'
			if (displayClassification === 'excluded-dangerous') classificationTone = 'error'
			else if (displayClassification === 'role-restricted' || displayClassification === 'prerequisite' || displayClassification === 'coverage-alias') classificationTone = 'neutral'
			else if (displayClassification === 'lifecycle-obligation') classificationTone = 'info'
			setBadge(classificationBadge, context.classificationLabel(displayClassification), classificationTone)
			classificationCell.append(classificationBadge)
			const riskCell = node('td')
			const riskBadge = node('span')
			setBadge(riskBadge, statusLabel(value.risk ?? 'standard'), value.risk === 'irreversible' || value.risk === 'high' ? 'warning' : 'neutral')
			riskCell.append(riskBadge)
			const candidatesCell = node('td', 'mono', String(context.publicCandidateCount(value.candidateCount) ?? 0))
			const eligibilityCell = node('td')
			nameCell.dataset['label'] = 'Operation'
			classificationCell.dataset['label'] = 'Classification'
			riskCell.dataset['label'] = 'Risk'
			candidatesCell.dataset['label'] = 'Candidates'
			eligibilityCell.dataset['label'] = 'Eligibility'
			const eligibilityBadge = node('span')
			if (!independentlyExecutable) setBadge(eligibilityBadge, 'Not independently selectable', 'neutral')
			else if (!enabled) setBadge(eligibilityBadge, 'Disabled', 'neutral')
			else if (eligible) setBadge(eligibilityBadge, 'Eligible', 'success')
			else setBadge(eligibilityBadge, 'Blocked', 'warning')
			eligibilityCell.append(eligibilityBadge)
			if (!eligible) {
				const listValue = node('ul', 'blocker-list')
				for (const reason of displayedBlockers) listValue.append(node('li', undefined, reason))
				eligibilityCell.append(listValue)
			}
			const open = node('button', 'operation-open secondary', 'Open operation')
			open.type = 'button'
			open.setAttribute('aria-label', `Open ${value.label ?? 'operation'}`)
			open.addEventListener('click', () => context.operationDialog.open(value))
			nameCell.append(open)
			if (value.classification === 'selectable' && independentlyExecutable && value.id !== undefined) context.selectionControls.appendToggle(nameCell, value.id, value.label ?? value.id)
			row.dataset['ecosystem'] = context.normalizeEcosystem(value.ecosystem)
			row.dataset['operationId'] = key
			row.append(nameCell, classificationCell, riskCell, candidatesCell, eligibilityCell)
			context.catalogRowCache.set(key, { row, signature: rowSignature })
			return row
		})
		if (rows.length === 0) {
			context.catalogRows.replaceChildren(node('p', 'empty-state', 'No operations match this filter.'))
			return
		}
		context.renderCatalogGroups(rows)
		context.updateSelectionControls()
	}

	function renderEcosystems(values: OperationEvaluation[]) {
		const cards = context.ecosystemOrder.map(ecosystem => {
			const operations = values.filter(value => context.normalizeEcosystem(value.ecosystem) === ecosystem && context.operationIsIndependentlyExecutable(value))
			const enabled = operations.filter(value => value.enabled !== false)
			const eligible = enabled.filter(value => value.eligible === true)
			const candidates = eligible.reduce((total, value) => total + (context.parsePositiveNumber(value.candidateCount) ?? 0), 0)
			const card = node('article', 'panel ecosystem-card')
			card.dataset['ecosystem'] = ecosystem
			const heading = node('div', 'panel-heading')
			heading.append(node('h3', undefined, context.ecosystemLabels.get(ecosystem) ?? ecosystem))
			const readiness = node('span')
			if (eligible.length > 0) setBadge(readiness, 'Ready', 'success')
			else if (operations.length === 0) setBadge(readiness, 'Discovering', 'neutral')
			else setBadge(readiness, 'Blocked', 'warning')
			heading.append(readiness)
			const metrics = node('div', 'ecosystem-metrics')
			for (const [label, amount] of [
				['Independent operations', operations.length],
				['Eligible', eligible.length],
				['Candidates', candidates],
			] as const) {
				const metric = node('div')
				metric.append(node('strong', undefined, amount.toString()), node('span', undefined, label))
				metrics.append(metric)
			}
			let summary: HTMLElement | undefined
			if (operations.length === 0) summary = node('p', 'muted', 'Waiting for protocol discovery.')
			else {
				const blockers =
					eligible.length > 0
						? []
						: [
								...new Set(
									operations.flatMap(value => {
										const operation = value.label ?? value.id ?? 'Unnamed operation'
										let reasons = value.blockers
										if (value.enabled === false) reasons = ['Disabled by operator policy']
										else if (reasons.length === 0) reasons = ['No eligible candidate in current state']
										return reasons.map(reason => `${operation}: ${reason}`)
									}),
								),
							].slice(0, 3)
				if (blockers.length > 0) {
					summary = node('ul', 'blocker-list')
					for (const blocker of blockers) summary.append(node('li', undefined, blocker))
				}
			}
			card.append(heading, metrics)
			if (summary !== undefined) card.append(summary)
			return card
		})
		context.ecosystemGrid.replaceChildren(...cards)
	}
	return { renderCatalog, renderEcosystems }
}
