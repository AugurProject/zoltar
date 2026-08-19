import { describe, expect, test } from 'bun:test'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

const composeFile = join(import.meta.dir, '..', '..', 'compose.yaml')
const dockerfile = join(import.meta.dir, '..', '..', 'Dockerfile')
const dockerignore = join(import.meta.dir, '..', '..', 'Dockerfile.dockerignore')
const windowsLauncher = join(import.meta.dir, '..', '..', 'start.bat')

describe('standalone Docker Compose packaging', () => {
	test('builds the trading image from the repository root and publishes the UI', async () => {
		const source = await readFile(composeFile, 'utf8')
		expect(source).toContain('context: ..')
		expect(source).toContain('dockerfile: trading/Dockerfile')
		expect(source).not.toContain('TRADING_UI_DEPLOYMENT')
		expect(source).toContain('127.0.0.1:4163:4163')
	})

	test('includes canonical core deployments for browser wallet setup', async () => {
		const source = await readFile(dockerfile, 'utf8')
		const ignoredContext = await readFile(dockerignore, 'utf8')
		expect(source).toContain('COPY docs/mainnet-deployment-addresses.json docs/sepolia-deployment-addresses.json ./docs/')
		expect(ignoredContext).toContain('!docs/\n!docs/mainnet-deployment-addresses.json\n!docs/sepolia-deployment-addresses.json')
		expect(source).toContain('RUN cd trading && bun run ui:build')
	})

	test('provides a location-independent Windows launcher', async () => {
		const source = (await readFile(windowsLauncher, 'utf8')).replaceAll('\r\n', '\n')
		expect(source).toContain('pushd "%~dp0"')
		expect(source).toContain('docker compose up --build --force-recreate\nset "exit_code=%errorlevel%"\npopd\npause\nexit /b %exit_code%')
	})
})
