import { describe, expect, test } from 'bun:test'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { assertBotDockerPackaging, batchCommands } from '../../../tooling/testing/packaging-parsers.ts'

const botDirectory = join(import.meta.dir, '..')
const windowsLauncher = join(botDirectory, 'start.bat')

describe('Docker packaging', () => {
	test('provides a location-independent Windows launcher', async () => {
		const commands = batchCommands(await readFile(windowsLauncher, 'utf8'))
		expect(commands.at(0)).toBe('pushd "%~dp0" || exit /b 1')
		expect(commands.slice(-8)).toEqual(['docker compose stop || goto finish', 'docker compose build || goto finish', 'docker compose up --no-build --force-recreate', ':finish', 'set "exit_code=%errorlevel%"', 'popd', 'pause', 'exit /b %exit_code%'])
	})

	test('packages the shared bot image contract and starts without host UID, GID, or .env configuration', async () => {
		const { service } = await assertBotDockerPackaging({
			botDirectory,
			composeService: 'liquidator',
			copiedScripts: ['check-process-lock-runtime.mts'],
			entrypointSource: 'bots/shared/scripts/docker-entrypoint.sh',
			packageName: '@zoltar/liquidator',
			port: 4183,
			runtimeChecks: ['check-process-lock-runtime.mts'],
		})
		expect(service.environment).not.toHaveProperty('LIQUIDATOR_UID')
		expect(service.environment).not.toHaveProperty('LIQUIDATOR_GID')
	})
})
