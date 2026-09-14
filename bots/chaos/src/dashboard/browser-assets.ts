import { buildDashboardScript } from '@zoltar/bot-shared/dashboard/assets'
import { join } from 'node:path'

const sourceByPath = new Map([
	['/dashboard.js', 'dashboard.ts'],
	['/selection-controls.js', 'selection-controls.ts'],
	['/operation-dialog.js', 'operation-dialog.ts'],
	['/operation-input-format.js', 'operation-input-format.ts'],
	['/catalog-groups.js', 'catalog-groups.ts'],
	['/dom.js', 'dom.ts'],
	['/activity-timeline.js', 'activity-timeline.ts'],
	['/pending-transaction-summary.js', 'pending-transaction-summary.ts'],
	['/formatting.js', 'formatting.ts'],
	['/operator-alerts.js', 'operator-alerts.ts'],
])

export async function browserScript(path: string, directory: string) {
	const source = sourceByPath.get(path)
	return source === undefined ? undefined : await buildDashboardScript(join(directory, source))
}
