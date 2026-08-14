import { describe, expect, test } from 'bun:test'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

const composeFile = join(import.meta.dir, '..', '..', 'compose.yaml')
const dockerfile = join(import.meta.dir, '..', '..', 'Dockerfile')
const windowsLauncher = join(import.meta.dir, '..', '..', 'start.bat')

describe('standalone Docker Compose packaging', () => {
	test('builds the trading image from the repository root and publishes the UI', async () => {
		const source = await readFile(composeFile, 'utf8')
		expect(source).toContain('context: ..')
		expect(source).toContain('dockerfile: trading/Dockerfile')
		expect(source).toContain('TRADING_UI_DEPLOYMENT: ${TRADING_UI_DEPLOYMENT:-}')
		expect(source).toContain('127.0.0.1:4163:4163')
	})

	test('includes canonical core deployments for browser wallet setup', async () => {
		const source = await readFile(dockerfile, 'utf8')
		expect(source).toContain('COPY docs/mainnet-deployment-addresses.json docs/sepolia-deployment-addresses.json ./docs/')
		expect(source).toContain('ARG TRADING_UI_DEPLOYMENT')
		expect(source).toContain('if [ -n "${TRADING_UI_DEPLOYMENT}" ]')
	})

	test('provides a location-independent Windows launcher', async () => {
		const source = (await readFile(windowsLauncher, 'utf8')).replaceAll('\r\n', '\n')
		expect(source).toContain('pushd "%~dp0"')
		expect(source).toContain('docker compose up --build --force-recreate\nset "exit_code=%errorlevel%"\npopd\npause\nexit /b %exit_code%')
	})
})
