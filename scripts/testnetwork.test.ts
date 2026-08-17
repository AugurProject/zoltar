import { describe, expect, test } from 'bun:test'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { validateConnectivitySettings } from '../bots/shared/src/monitoring/connectivity.ts'

const testnetworkRoot = join(import.meta.dir, '..', 'testnetwork')
const composeFile = join(testnetworkRoot, 'compose.yaml')
const dockerfile = join(testnetworkRoot, 'Dockerfile')
const windowsLauncher = join(testnetworkRoot, 'start.bat')
const botComposeFiles = [join(import.meta.dir, '..', 'bots', 'liquidator', 'compose.yaml'), join(import.meta.dir, '..', 'bots', 'open-oracle-arbitrager', 'compose.yaml')]

describe('local test network packaging', () => {
	test('builds a pinned Anvil image on the shared Zoltar network', async () => {
		const compose = await readFile(composeFile, 'utf8')
		const image = await readFile(dockerfile, 'utf8')

		expect(compose).toContain('  anvil:')
		expect(compose).toContain('context: ..')
		expect(compose).toContain('dockerfile: testnetwork/Dockerfile')
		expect(compose).toContain('image: zoltar-testnetwork')
		expect(compose).toContain('127.0.0.1:${ANVIL_RPC_PORT:-8545}:8545')
		expect(compose).toContain('name: zoltar')
		expect(compose).toContain('external: true')

		expect(image).toContain('FROM ghcr.io/foundry-rs/foundry:v1.5.1')
		expect(image).toContain('ENTRYPOINT ["anvil"]')
		for (const argument of ['"--host", "0.0.0.0"', '"--port", "8545"', '"--chain-id", "11155111"', '"--hardfork", "osaka"', '"--block-time", "1"', '"--block-base-fee-per-gas", "0"', '"--gas-price", "0"', '"--no-priority-fee"']) {
			expect(image).toContain(argument)
		}
	})

	test('provides a location-independent Windows launcher', async () => {
		const source = (await readFile(windowsLauncher, 'utf8')).replaceAll('\r\n', '\n')
		expect(source).toContain('pushd "%~dp0"')
		expect(source).toContain('docker network inspect zoltar >nul 2>&1 || docker network create zoltar || exit /b 1')
		expect(source).toContain('docker compose up --build --force-recreate\nset "exit_code=%errorlevel%"\npopd\npause\nexit /b %exit_code%')
	})

	test('accepts only the repository Anvil service as a non-loopback HTTP RPC', () => {
		expect(validateConnectivitySettings({ publicRpcUrls: ['http://anvil:8545'], readRpcUrl: 'http://anvil:8545' })).toEqual({
			publicRpcUrls: ['http://anvil:8545/'],
			readRpcUrl: 'http://anvil:8545/',
		})
		expect(() => validateConnectivitySettings({ publicRpcUrls: ['http://other-service:8545'], readRpcUrl: 'http://other-service:8545' })).toThrow('HTTPS, loopback HTTP, or the local Anvil service')
	})

	test('passes the configurable one-reader default quorum policy to both bots', async () => {
		for (const file of botComposeFiles) expect(await readFile(file, 'utf8')).toContain('ZOLTAR_BOT_RPC_QUORUM: ${ZOLTAR_BOT_RPC_QUORUM-1}')
	})
})
