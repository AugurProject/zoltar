import { describe, expect, test } from 'bun:test'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

const repositoryRoot = join(import.meta.dir, '..')

const apps = [
	{ id: 'zoltar', port: 8012 },
	{ id: 'statoblast', port: 8011 },
] as const

const batchCommands = (source: string) =>
	source
		.replaceAll('\r\n', '\n')
		.split('\n')
		.map(line => line.trim().replaceAll(/\s+/g, ' '))
		.filter(line => line !== '' && line.toLowerCase() !== '@echo off')

describe('local UI Docker launchers', () => {
	for (const app of apps) {
		test(`${app.id} builds and serves its production UI`, async () => {
			const appRoot = join(repositoryRoot, 'ui', app.id)
			const compose = Bun.YAML.parse(await readFile(join(appRoot, 'compose.yaml'), 'utf8'))
			const commands = batchCommands(await readFile(join(appRoot, 'start.bat'), 'utf8'))

			expect(compose).toEqual(
				expect.objectContaining({
					networks: { default: { external: true, name: 'zoltar' } },
					services: {
						[app.id]: expect.objectContaining({
							build: { context: '../..', dockerfile: 'ui/Dockerfile', target: `local-runtime-${app.id}` },
							environment: { UI_APP: app.id },
							ports: [`127.0.0.1:${app.port.toString()}:${app.port.toString()}`],
						}),
					},
				}),
			)
			expect(commands).toEqual(['pushd "%~dp0" || exit /b 1', 'docker network inspect zoltar >nul 2>&1 || docker network create zoltar || exit /b 1', 'docker compose up --build --force-recreate', 'set "exit_code=%errorlevel%"', 'popd', 'pause', 'exit /b %exit_code%'])
		})
	}
})
