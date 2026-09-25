import { afterEach, expect, test } from 'bun:test'
import { cp, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { Window } from 'happy-dom'
import { buildDashboardScript } from '../src/dashboard/assets.ts'

const directories: string[] = []

afterEach(async () => {
	await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

test('builds and renders dashboard badges from the source-only UI package shipped in bot images', async () => {
	const directory = await mkdtemp(join(tmpdir(), 'bot-dashboard-assets-'))
	directories.push(directory)
	const repository = resolve(import.meta.dir, '../../..')
	const ui = join(directory, 'ui-core-shared')
	await mkdir(join(directory, 'node_modules', '@zoltar'), { recursive: true })
	await mkdir(ui)
	await cp(join(repository, 'ui/coreShared/package.json'), join(ui, 'package.json'))
	await cp(join(repository, 'ui/coreShared/ts'), join(ui, 'ts'), { recursive: true })
	await symlink(ui, join(directory, 'node_modules/@zoltar/ui-core-shared'))
	await symlink(join(repository, 'node_modules/preact'), join(directory, 'node_modules/preact'))
	for (const file of ['health-panel.ts', 'polling.ts']) await cp(join(import.meta.dir, '../src/dashboard', file), join(directory, file))
	const entrypoint = join(directory, 'entry.ts')
	await writeFile(
		entrypoint,
		`import { renderOperatorHealth } from './health-panel.ts'
renderOperatorHealth(document.body, { mode: 'Live armed', paused: true, stale: false, capitalAtRisk: '0', recoveryItems: 0, lastAction: 'None' })
`,
	)
	const script = await buildDashboardScript(entrypoint)
	const window = new Window({ settings: { enableJavaScriptEvaluation: true, disableJavaScriptFileLoading: true, suppressInsecureJavaScriptEnvironmentWarning: true } })
	try {
		window.eval(script)
		expect([...window.document.querySelectorAll('.badge')].map(badge => badge.textContent)).toEqual(['Live armed', 'Paused'])
		expect(window.document.querySelector('.operator-health')?.getAttribute('aria-label')).toBe('Operator health')
	} finally {
		await window.happyDOM.close()
	}
})
