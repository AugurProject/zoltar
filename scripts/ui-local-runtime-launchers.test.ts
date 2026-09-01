import { describe, expect, test } from 'bun:test'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

const repositoryRoot = join(import.meta.dir, '..')

const apps = [
	{ id: 'zoltar', port: 8012 },
	{ id: 'statoblast', port: 8011 },
] as const

describe('local UI Docker launchers', () => {
	for (const app of apps) {
		test(`${app.id} builds and serves its production UI`, async () => {
			const appRoot = join(repositoryRoot, 'ui', app.id)
			const composeSource = await readFile(join(appRoot, 'compose.yaml'), 'utf8')
			const compose = Bun.YAML.parse(composeSource)
			const launcherSource = (await readFile(join(appRoot, 'start.bat'), 'utf8')).replaceAll('\r\n', '\n')

			expect(composeSource).toContain('context: ../..')
			expect(composeSource).toContain('dockerfile: ui/Dockerfile')
			expect(composeSource).toContain(`target: local-runtime-${app.id}`)
			expect(composeSource).toContain(`127.0.0.1:${app.port}:${app.port}`)
			expect(composeSource).toContain(`UI_APP: ${app.id}`)
			expect(compose).toEqual(
				expect.objectContaining({
					networks: { default: { external: true, name: 'zoltar' } },
				}),
			)
			expect(launcherSource).toContain('pushd "%~dp0"')
			expect(launcherSource).toContain('docker network inspect zoltar >nul 2>&1 || docker network create zoltar || exit /b 1')
			expect(launcherSource).toContain('docker compose up --build --force-recreate\nset "exit_code=%errorlevel%"\npopd\npause\nexit /b %exit_code%')
		})
	}
})
