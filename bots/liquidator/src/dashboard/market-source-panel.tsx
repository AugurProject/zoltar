import { Fragment, h, render, type ComponentChildren } from 'preact'
import type { MarketSourceRow } from './api-validation.ts'
import { element, shorten } from '@zoltar/bot-shared/dashboard/dom'

const statusPresentation: Record<MarketSourceRow['status'], { badgeClass: string; defaultReason: string; label: string }> = {
	admitted: { badgeClass: 'success', defaultReason: 'Meets the active admission policy', label: 'Admitted' },
	excluded: { badgeClass: 'warning', defaultReason: 'Excluded by the active admission policy', label: 'Excluded' },
	failed: { badgeClass: 'warning', defaultReason: 'Probe did not return usable evidence', label: 'Failed' },
	observed: { badgeClass: '', defaultReason: 'Probe succeeded; admission still requires the persistence and consensus policy', label: 'Observed' },
}

function sourceCell(value: ComponentChildren, label: string, heading: string) {
	return h('td', { 'data-label': label, headers: heading }, value)
}

export function renderMarketSources(sources: MarketSourceRow[]) {
	const rows =
		sources.length === 0
			? [h('tr', { key: 'empty' }, h('td', { class: 'empty', colSpan: 6 }, 'No market sources are configured.'))]
			: sources.map(source => {
					const presentation = statusPresentation[source.status]
					return h(
						'tr',
						{ key: `${source.kind}:${source.id}:${source.assetId}:${source.market}` },
						sourceCell(source.kind.toUpperCase(), 'Venue', 'source-kind-heading'),
						sourceCell(source.id, 'Source', 'source-id-heading'),
						sourceCell(shorten(source.assetId), 'REP asset', 'source-asset-heading'),
						sourceCell(source.market, 'Market', 'source-market-heading'),
						sourceCell(h('span', { class: `badge ${presentation.badgeClass}` }, presentation.label), 'Status', 'source-status-heading'),
						sourceCell(source.reason ?? presentation.defaultReason, 'Reason', 'source-reason-heading'),
					)
				})
	render(h(Fragment, null, ...rows), element('market-source-rows', HTMLTableSectionElement))
}
