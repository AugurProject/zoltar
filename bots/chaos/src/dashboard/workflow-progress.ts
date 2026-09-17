import { optionalRecord } from '@zoltar/bot-shared/infrastructure/json-validation'
import { fullIdentifier, node } from './dom.js'

export function workflowProgress(values: readonly unknown[], active: boolean) {
	const steps = values.map(value => optionalRecord(value) ?? {})
	const view = node('div', 'operation-receipts')
	view.setAttribute('aria-busy', String(active))
	if (steps.length === 0) {
		view.append(node('p', 'muted', active ? 'Workflow steps are being prepared.' : 'No transactions recorded.'))
		return view
	}
	const included = steps.filter(step => step['status'] === 'confirmed').length
	const heading = node('h3', undefined, `Workflow · ${included} of ${steps.length} included`)
	if (active) {
		const spinner = node('span', 'workflow-spinner')
		spinner.setAttribute('aria-hidden', 'true')
		heading.prepend(spinner)
	}
	view.append(heading)
	const list = node('ol')
	const current = steps.findIndex(step => step['status'] !== 'confirmed')
	for (const [index, step] of steps.entries()) {
		const row = node('li')
		const status = typeof step['status'] === 'string' ? step['status'] : 'planned'
		const labels: Record<string, string> = { planned: active && index === current ? 'Preparing transaction' : 'Queued', signed: 'Signed · awaiting submission', submitted: 'Submitted · awaiting inclusion', confirmed: 'Included', failed: 'Failed', blocked: 'Recovery required' }
		row.append(node('p', undefined, `${typeof step['label'] === 'string' ? step['label'] : 'Transaction'} · ${labels[status] ?? status}`))
		const hash = step['hash']
		if (typeof hash === 'string' && /^0x[0-9a-f]{64}$/i.test(hash)) {
			const url = typeof step['explorerUrl'] === 'string' ? step['explorerUrl'] : ''
			const parsed = URL.canParse(url) ? new URL(url) : undefined
			const explorerUrl = parsed !== undefined && ['http:', 'https:'].includes(parsed.protocol) && !parsed.username && !parsed.password ? parsed.href : undefined
			row.append(fullIdentifier(hash, 'transaction hash', { explorerUrl }))
		}
		list.append(row)
	}
	view.append(list)
	return view
}
