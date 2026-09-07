import { describe, expect, test } from 'bun:test'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { batchCommands, dockerInstructions, parseDockerfile, requireDockerStage, shellCommandSegments } from '../../../../../tooling/testing/packaging-parsers.ts'

const composeFile = join(import.meta.dir, '..', '..', '..', 'compose.yaml')
const dockerfile = join(import.meta.dir, '..', '..', '..', '..', 'Dockerfile')
const packageFile = join(import.meta.dir, '..', '..', '..', 'package.json')
const windowsLauncher = join(import.meta.dir, '..', '..', '..', 'start.bat')

describe('standalone Docker Compose packaging', () => {
	test('builds the trading image from the repository root and publishes the UI', async () => {
		const compose = Bun.YAML.parse(await readFile(composeFile, 'utf8')) as { services?: { trading?: { build?: Record<string, unknown>; environment?: Record<string, unknown>; ports?: unknown[] } } }
		const trading = compose.services?.trading
		expect(trading?.build).toEqual({ context: '../..', dockerfile: 'ui/Dockerfile', target: 'local-runtime-trading' })
		expect(trading?.environment).toEqual({ UI_APP: 'trading' })
		expect(trading?.environment).not.toHaveProperty('TRADING_UI_DEPLOYMENT')
		expect(trading?.ports).toContain('127.0.0.1:4163:8080')
	})

	test('includes canonical core deployments for browser wallet setup', async () => {
		const stages = parseDockerfile(await readFile(dockerfile, 'utf8'))
		const common = requireDockerStage(stages, 'common-builder')
		const tradingBuilder = requireDockerStage(stages, 'trading-builder')
		const runtime = requireDockerStage(stages, 'local-runtime-trading')
		expect(dockerInstructions(common, 'COPY')).toEqual(expect.arrayContaining(['./docs/mainnet-deployment-addresses.json /source/docs/mainnet-deployment-addresses.json', './docs/sepolia-deployment-addresses.json /source/docs/sepolia-deployment-addresses.json']))
		expect(dockerInstructions(tradingBuilder, 'RUN').flatMap(shellCommandSegments)).toContain('bun ../../tooling/ui/production.mts trading')
		expect(dockerInstructions(runtime, 'COPY').some(copy => copy.endsWith('/source/ui/trading/dist/ /app/ui/trading/'))).toBe(true)
	})

	test('builds the standalone image from the repository-root Dockerfile', async () => {
		const packageJson = await Bun.file(packageFile).json()
		const command = packageJson.scripts['docker:build']
		expect(command).toBeString()
		expect(shellCommandSegments(command)).toEqual(['docker build --file ../Dockerfile --target local-runtime-trading --tag zoltar-trading ../..'])
	})

	test('provides a location-independent Windows launcher', async () => {
		const commands = batchCommands(await readFile(windowsLauncher, 'utf8'))
		expect(commands.at(0)).toBe('pushd "%~dp0" || exit /b 1')
		expect(commands.slice(-5)).toEqual(['docker compose up --build --force-recreate', 'set "exit_code=%errorlevel%"', 'popd', 'pause', 'exit /b %exit_code%'])
	})
})
