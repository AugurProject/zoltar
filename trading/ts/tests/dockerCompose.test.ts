import { describe, expect, test } from 'bun:test'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

const composeFile = join(import.meta.dir, '..', '..', 'compose.yaml')
const dockerfile = join(import.meta.dir, '..', '..', '..', 'ui', 'Dockerfile')
const packageFile = join(import.meta.dir, '..', '..', 'package.json')
const windowsLauncher = join(import.meta.dir, '..', '..', 'start.bat')

describe('standalone Docker Compose packaging', () => {
	test('builds the trading image from the repository root and publishes the UI', async () => {
		const source = await readFile(composeFile, 'utf8')
		expect(source).toContain('context: ..')
		expect(source).toContain('dockerfile: ui/Dockerfile')
		expect(source).toContain('target: local-runtime')
		expect(source).not.toContain('TRADING_UI_DEPLOYMENT')
		expect(source).toContain('127.0.0.1:4163:8080')
		expect(source).toContain('UI_APP: trading')
	})

	test('includes canonical core deployments for browser wallet setup', async () => {
		const source = await readFile(dockerfile, 'utf8')
		expect(source).toContain('COPY ./docs/mainnet-deployment-addresses.json /source/docs/mainnet-deployment-addresses.json')
		expect(source).toContain('COPY ./docs/sepolia-deployment-addresses.json /source/docs/sepolia-deployment-addresses.json')
		expect(source).toContain('bun ../coreShared/build/production.mts trading')
		expect(source).toContain('/source/ui/trading/dist/ /app/ui/trading/')
	})

	test('builds the standalone image from the repository-root Dockerfile', async () => {
		const packageJson = await Bun.file(packageFile).json()
		expect(packageJson.scripts['docker:build']).toBe('docker build --file ../ui/Dockerfile --target local-runtime --tag zoltar-trading ..')
	})

	test('provides a location-independent Windows launcher', async () => {
		const source = (await readFile(windowsLauncher, 'utf8')).replaceAll('\r\n', '\n')
		expect(source).toContain('pushd "%~dp0"')
		expect(source).toContain('docker compose up --build --force-recreate\nset "exit_code=%errorlevel%"\npopd\npause\nexit /b %exit_code%')
	})
})
