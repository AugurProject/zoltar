import { describe, expect, test } from 'bun:test'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { assertBotDockerPackaging, batchCommands } from '../../../tooling/testing/packaging-parsers.ts'

const botDirectory = join(import.meta.dir, '..')
const windowsLauncher = join(botDirectory, 'start.bat')

describe('Docker packaging', () => {
	test('creates the shared external signer-lock volume before Compose runs', async () => {
		for (const launcher of ['start.bat']) {
			const commands = batchCommands(await readFile(join(botDirectory, launcher), 'utf8'))
			const create = 'docker volume create zoltar-bot-signer-locks >nul || goto finish'
			expect(commands).toContain(create)
			expect(commands.indexOf(create)).toBeLessThan(commands.findIndex(command => command.startsWith('docker compose ')))
		}
	})

	test('provides a location-independent Windows launcher', async () => {
		expect(batchCommands(await readFile(windowsLauncher, 'utf8'))).toEqual([
			'pushd "%~dp0" || exit /b 1',
			'docker network inspect zoltar >nul 2>&1 || docker network create zoltar || exit /b 1',
			'docker volume create zoltar-bot-signer-locks >nul || goto finish',
			'docker compose stop || goto finish',
			'docker compose build || goto finish',
			'docker compose up --no-build --force-recreate',
			':finish',
			'set "exit_code=%errorlevel%"',
			'popd',
			'pause',
			'exit /b %exit_code%',
		])
	})

	test('packages the shared bot image contract with a passwordless dashboard published only on host loopback', async () => {
		const { service } = await assertBotDockerPackaging({
			botDirectory,
			composeService: 'arbitrager',
			copiedScripts: ['check-market-fixture.mts'],
			entrypointSource: 'bots/shared/scripts/docker-entrypoint.sh',
			packageName: '@zoltar/open-oracle-arbitrager',
			port: 4173,
			runtimeChecks: [],
		})
		expect(service.environment).toEqual({ ZOLTAR_BOT_DASHBOARD_LOOPBACK_PUBLISHED: 'true', ZOLTAR_BOT_SIGNER_LOCK_ROOT: '.state/process-locks' })
		expect(service.volumes).toEqual(expect.arrayContaining(['signer-locks:/app/bots/open-oracle-arbitrager/.state/process-locks']))
		const compose: unknown = Bun.YAML.parse(await readFile(join(botDirectory, 'compose.yaml'), 'utf8'))
		expect(compose).toMatchObject({ volumes: { 'signer-locks': { name: 'zoltar-bot-signer-locks', external: true } } })
	})
})
