export function cell(...children: (Node | string)[]) {
	const value = document.createElement('td')
	for (const child of children) {
		value.append(typeof child === 'string' ? document.createTextNode(child) : child)
	}
	return value
}

export function stacked(primary: string, secondary: string) {
	const fragment = document.createDocumentFragment()
	const strong = document.createElement('strong')
	strong.textContent = primary
	const small = document.createElement('small')
	small.textContent = secondary
	fragment.append(strong, small)
	return fragment
}

export function poolStatusText(pool: { approvedUniverse: boolean; centralizedPriceAllowed: boolean; selected: boolean; systemState: string }) {
	if (!pool.approvedUniverse) return 'Universe not approved'
	if (pool.systemState !== '0') return 'Pool inactive'
	if (!pool.centralizedPriceAllowed) return 'Market consensus guard'
	return pool.selected ? 'Eligible' : ''
}

export function botVaultState(vault: { healthBps?: string; vaultRepBacking: string; openInterestDisplay: string }) {
	const health = vault.healthBps === undefined ? undefined : BigInt(vault.healthBps)
	if (vault.vaultRepBacking === '0' && vault.openInterestDisplay === '0') return 'Inactive'
	if (health === undefined) return 'No open interest'
	if (health < 10_000n) return `Top-up required · ${health.toString()} bps`
	return `Healthy · ${health.toString()} bps`
}

export function publicFailure(error: unknown, message: string, includeDetail = false) {
	if (includeDetail && error instanceof Error) {
		const detail = error.message.trim()
		if (detail !== '' && detail !== message && !/^Request failed with HTTP \d+$/.test(detail) && !/(?:https?:\/\/[^\s/:]+:[^@\s]+@|authorization|bearer|password|secret|token\s*[=:])/i.test(detail)) return detail
	}
	return message
}
