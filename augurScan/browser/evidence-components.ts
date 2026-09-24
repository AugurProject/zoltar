import { isRecord } from './api-validation.ts'
import { decodeValue, isAddressIdentity } from './api-decoding.ts'
import type { ArgumentDefinition, ProtocolAddressLinkOptions } from './browser-types.ts'
import { short } from './identifier-format.ts'

interface EvidenceComponentsDeps {
	element: <K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string) => HTMLElementTagNameMap[K]
	api: (path: string) => Promise<unknown>
	selectedChainId: () => string
	isDemo: boolean
	number: (value: string | number | bigint | null | undefined) => string
}

export const createEvidenceComponents = (deps: EvidenceComponentsDeps) => {
	const { element, api, selectedChainId, isDemo, number } = deps
	const addressIdentityCache = new Map<string, string | false | Promise<string | undefined>>()
	const detailCard = (term: string, description: string, wide = false) => {
		const card = element('dl', `detail-card${wide ? ' wide' : ''}`)
		card.append(element('dt', '', term), element('dd', '', description ?? '—'))
		return card
	}

	const evidenceDetailCard = (term: string, base: string, type: string, value: string, label = value) => {
		const card = element('dl', 'detail-card')
		const description = element('dd')
		description.append(internalEvidenceLink(base, type, value, label))
		card.append(element('dt', '', term), description)
		return card
	}

	const addressDetailCard = (term: string, address: string | null | undefined, { knownLabel, chainId, wide = false }: { knownLabel?: string | null; chainId?: string; wide?: boolean } = {}) => {
		const card = element('dl', `detail-card${wide ? ' wide' : ''}`)
		const description = element('dd')
		if (address) description.append(protocolAddressLink(address, { knownLabel, chainId }))
		else description.textContent = '—'
		card.append(element('dt', '', term), description)
		return card
	}

	const internalEvidenceLink = (_base: string, type: string, value: string | number, label: string) => {
		const link = element('a', 'explorer-link', label)
		let path = `/address/${value}`
		if (type === 'tx') path = `/tx/${value}`
		else if (type === 'block') path = `/block/${value}`
		link.href = `${path}?chainId=${selectedChainId()}${isDemo ? '&demo=1' : ''}`
		return link
	}

	const usableAddressLabel = (label: unknown): string | undefined => (typeof label === 'string' && label.length > 0 && !label.toLowerCase().startsWith('unknown') ? label : undefined)

	const addressIdentityKey = (chainId: string, address: string) => `${chainId}:${address.toLowerCase()}`

	const invalidateAddressIdentityCache = (chainId: string, missesOnly = false): void => {
		const prefix = `${chainId}:`
		for (const [key, value] of addressIdentityCache) {
			if (key.startsWith(prefix) && (!missesOnly || typeof value !== 'string')) addressIdentityCache.delete(key)
		}
	}

	const resolveAddressLabel = async (chainId: string, address: string): Promise<string | undefined> => {
		const key = addressIdentityKey(chainId, address)
		const cached = addressIdentityCache.get(key)
		if (typeof cached === 'string') return cached
		if (cached === false) return undefined
		if (cached) return await cached
		const pending = api(`/api/v1/address-identity?${new URLSearchParams({ chainId: String(chainId), address })}`)
			.then(value => decodeValue(value, isAddressIdentity, 'Address identity'))
			.then(identity => {
				const resolved = usableAddressLabel(identity.label)
				if (addressIdentityCache.get(key) !== pending) return undefined
				addressIdentityCache.set(key, resolved ?? false)
				return resolved
			})
			.catch(() => {
				if (addressIdentityCache.get(key) !== pending) return undefined
				addressIdentityCache.delete(key)
				return undefined
			})
		addressIdentityCache.set(key, pending)
		return await pending
	}

	const protocolAddressLink = (address: string | null, { knownLabel, chainId = selectedChainId(), className = 'address-link', compact = false }: ProtocolAddressLinkOptions = {}) => {
		const resolvedAddress = address ?? ''
		const key = addressIdentityKey(chainId, resolvedAddress)
		const suppliedLabel = usableAddressLabel(knownLabel)
		const cachedLabel = addressIdentityCache.get(key)
		const canonicalLabel = typeof cachedLabel === 'string' ? cachedLabel : undefined
		const displayLabel = canonicalLabel ?? suppliedLabel
		const link = element('a', className, displayLabel ?? (compact ? short(resolvedAddress, 10, 8) : resolvedAddress))
		const params = new URLSearchParams({ chainId: String(chainId) })
		if (isDemo) params.set('demo', '1')
		link.href = `/address/${resolvedAddress}?${params}`
		link.title = displayLabel ? `${displayLabel} · ${resolvedAddress}` : resolvedAddress
		if (!canonicalLabel) {
			void resolveAddressLabel(chainId, resolvedAddress).then(resolvedLabel => {
				if (!resolvedLabel) return
				link.textContent = resolvedLabel
				link.title = `${resolvedLabel} · ${resolvedAddress}`
			})
		}
		return link
	}

	const decodedValueNode = (rawValue: unknown, displayValue: unknown, chainId: string) => {
		const node = element('span', 'decoded-value')
		if (typeof rawValue === 'string' && /^0x[0-9a-fA-F]{40}$/.test(rawValue)) {
			node.append(protocolAddressLink(rawValue, { chainId }))
			return node
		}
		if (Array.isArray(rawValue)) {
			node.append(document.createTextNode('['))
			rawValue.forEach((value, index) => {
				if (index > 0) node.append(document.createTextNode(', '))
				node.append(decodedValueNode(value, Array.isArray(displayValue) ? displayValue[index] : undefined, chainId))
			})
			node.append(document.createTextNode(']'))
			return node
		}
		if (isRecord(rawValue)) {
			node.append(document.createTextNode('{ '))
			Object.entries(rawValue).forEach(([key, value], index) => {
				if (index > 0) node.append(document.createTextNode(', '))
				node.append(document.createTextNode(`${key}: `), decodedValueNode(value, isRecord(displayValue) ? displayValue[key] : undefined, chainId))
			})
			node.append(document.createTextNode(' }'))
			return node
		}
		const rendered = displayValue !== undefined && displayValue !== null && typeof displayValue !== 'object' ? displayValue : rawValue
		node.textContent = rendered === undefined || rendered === null ? '—' : String(rendered)
		return node
	}

	const decodedArgumentsTable = (schema: ArgumentDefinition[] | null | undefined, rawArguments: Record<string, unknown> | null | undefined, displayArguments: Record<string, unknown> | null | undefined, chainId: string) => {
		const raw = rawArguments ?? {}
		const display = displayArguments ?? {}
		const entries: ArgumentDefinition[] = schema?.length ? schema.toSorted((left, right) => left.index - right.index) : Object.keys(raw).map((name, index) => ({ index, name, type: 'unknown' }))
		const table = element('table', 'arguments')
		const head = element('thead')
		const headRow = element('tr')
		for (const label of ['# / Name', 'Solidity type', 'Value']) headRow.append(element('th', '', label))
		head.append(headRow)
		const body = element('tbody')
		for (const entry of entries) {
			const rawValue = raw[entry.name]
			const row = element('tr')
			const nameCell = element('td', '', `#${number(entry.index)} · ${entry.name}`)
			nameCell.dataset.label = '# / Name'
			const typeCell = element('td', '', `${entry.type}${entry.indexed ? ' · indexed' : ''}`)
			typeCell.dataset.label = 'Solidity type'
			const displayCell = element('td')
			displayCell.dataset.label = 'Value'
			displayCell.append(decodedValueNode(rawValue, display[entry.name], chainId))
			row.append(nameCell, typeCell, displayCell)
			body.append(row)
		}
		table.append(head, body)
		return table
	}

	return { detailCard, evidenceDetailCard, addressDetailCard, internalEvidenceLink, invalidateAddressIdentityCache, protocolAddressLink, decodedArgumentsTable, clearAddressIdentityCache: () => addressIdentityCache.clear() }
}
