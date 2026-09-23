import { optionalRecord as record } from '@zoltar/bot-shared/infrastructure/json-validation'
import { fullIdentifier, node, setBadge } from './dom.js'
import { stringValue, type Topology } from './dashboard-data.ts'

type DashboardTopologyViewContext = {
	topologyGroupSignatures: WeakMap<HTMLDivElement, string>
	topologyAnchor: HTMLSpanElement
	topologyStatus: HTMLParagraphElement
	topologyUniverses: HTMLDivElement
	topologyPools: HTMLDivElement
	topologyReports: HTMLDivElement
	topologyAuctions: HTMLDivElement
	topologyPairs: HTMLDivElement
}

export function createDashboardTopologyView(context: DashboardTopologyViewContext) {
	function topologyIdentifier(value: string | undefined, fallback: string, type: string) {
		return value === undefined ? node('span', 'mono muted', fallback) : fullIdentifier(value, type)
	}

	function topologyIdentifierFact(label: string, value: string | undefined, type: string) {
		const fact = node('span', 'topology-fact topology-identifier-fact')
		fact.append(node('span', undefined, label), topologyIdentifier(value, 'Unavailable', type))
		return fact
	}

	function renderTopologyGroup(target: HTMLDivElement, values: readonly unknown[], render: (value: Record<string, unknown>) => HTMLElement) {
		const signature = JSON.stringify(values)
		if (context.topologyGroupSignatures.get(target) === signature) return
		context.topologyGroupSignatures.set(target, signature)
		if (values.length === 0) {
			target.className = 'topology-list empty-state'
			target.textContent = 'None discovered at this anchor.'
			return
		}
		target.className = 'topology-list'
		target.replaceChildren(
			...values.flatMap(value => {
				const source = record(value)
				return source === undefined ? [] : [render(source)]
			}),
		)
	}

	function topologyRow(identity: HTMLElement | string, facts: Array<HTMLElement | string>) {
		const row = node('div', 'topology-row')
		const heading = node('strong')
		heading.append(typeof identity === 'string' ? document.createTextNode(identity) : identity)
		const details = node('small', 'topology-facts')
		for (const fact of facts) details.append(typeof fact === 'string' ? node('span', 'topology-fact', fact) : fact)
		row.append(heading, details)
		return row
	}

	function renderTopology(value: Topology) {
		const visibleTotal = value.universes.length + value.pools.length + value.reports.length + value.auctions.length + value.pairs.length
		const discoveredTotal = value.totalCounts.universes + value.totalCounts.pools + value.totalCounts.reports + value.totalCounts.auctions + value.totalCounts.pairs
		if (value.anchorBlock === undefined) {
			setBadge(context.topologyAnchor, 'Anchor unavailable', 'warning')
			context.topologyStatus.textContent = 'Waiting for the first canonical scan to publish its sanitized protocol topology.'
		} else {
			setBadge(context.topologyAnchor, `Block ${String(value.anchorBlock)}`, value.complete === false || value.truncated === true ? 'warning' : 'success')
			if (value.truncated === true) {
				context.topologyStatus.textContent = `${visibleTotal.toString()} of ${discoveredTotal.toString()} anchored protocol identities shown · dashboard projection is capped; canonical discovery is ${value.complete === false ? 'incomplete' : 'complete'}.`
			} else {
				context.topologyStatus.textContent = `${visibleTotal.toString()} protocol identit${visibleTotal === 1 ? 'y' : 'ies'} · discovery ${value.complete === false ? 'incomplete' : 'complete'}.`
			}
		}
		renderTopologyGroup(context.topologyUniverses, value.universes, source =>
			topologyRow(`Universe ${String(source['id'] ?? '—')}`, [source['parentUniverseId'] === undefined ? 'genesis' : `parent ${String(source['parentUniverseId'])}`, `${String(source['knownChildOutcomeCount'] ?? 0)} child routes`, topologyIdentifierFact('REP', stringValue(source['repToken']), 'universe REP token')]),
		)
		renderTopologyGroup(context.topologyPools, value.pools, source =>
			topologyRow(topologyIdentifier(stringValue(source['address']), 'Pool unavailable', 'security pool address'), [
				`universe ${String(source['universeId'] ?? '—')}`,
				`state ${String(source['systemState'] ?? '—')}`,
				`${String(source['vaultCount'] ?? 0)} vaults${source['awaitingForkContinuation'] === true ? ' · fork continuation pending' : ''}`,
			]),
		)
		renderTopologyGroup(context.topologyReports, value.reports, source =>
			topologyRow(`Report ${String(source['reportId'] ?? '—')}`, [
				topologyIdentifierFact('Token 1', stringValue(source['token1']), 'report token 1'),
				topologyIdentifierFact('Token 2', stringValue(source['token2']), 'report token 2'),
				`settlement ${String(source['settlementTime'] ?? '—')}`,
				`flags ${String(source['flags'] ?? '—')}`,
			]),
		)
		renderTopologyGroup(context.topologyAuctions, value.auctions, source =>
			topologyRow(topologyIdentifier(stringValue(source['address']), 'Auction unavailable', 'truth auction address'), [topologyIdentifierFact('Pool', stringValue(source['pool']), 'truth auction pool address'), source['finalized'] === true ? 'finalized' : 'active', `${String(source['bidCount'] ?? 0)} indexed bids`]),
		)
		renderTopologyGroup(context.topologyPairs, value.pairs, source =>
			topologyRow(topologyIdentifier(stringValue(source['address']), 'Pair unavailable', 'trading pair address'), [
				topologyIdentifierFact('Pool', stringValue(source['pool']), 'trading pair pool address'),
				`universe ${String(source['universeId'] ?? '—')}`,
				`status ${String(source['status'] ?? '—')}`,
				`${String(source['feeBps'] ?? '—')} bps`,
			]),
		)
	}
	return { renderTopology }
}
