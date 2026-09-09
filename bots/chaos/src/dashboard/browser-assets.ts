import { join } from 'node:path'

const sourceByPath = new Map([
	['/dashboard.js', 'dashboard.ts'],
	['/operation-dialog.js', 'operation-dialog.ts'],
	['/catalog-groups.js', 'catalog-groups.ts'],
	['/formatting.js', 'formatting.ts'],
	['/operator-alerts.js', 'operator-alerts.ts'],
	['/retirement-dashboard.js', 'retirement-dashboard.ts'],
])

export async function browserScript(path: string, directory: string, transpiler: { transformSync: (source: string) => string }) {
	const source = sourceByPath.get(path)
	return source === undefined ? undefined : transpiler.transformSync(await Bun.file(join(directory, source)).text())
}
