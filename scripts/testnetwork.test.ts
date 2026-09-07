import { describe, expect, test } from 'bun:test'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { validateConnectivitySettings } from '../bots/shared/src/monitoring/connectivity.ts'

const testnetworkRoot = join(import.meta.dir, '..', 'testnetwork')
const composeFile = join(testnetworkRoot, 'compose.yaml')
const dockerfile = join(testnetworkRoot, 'Dockerfile')
const windowsLauncher = join(testnetworkRoot, 'start.bat')
const liquidatorComposeFile = join(import.meta.dir, '..', 'bots', 'liquidator', 'compose.yaml')
const arbitragerComposeFile = join(import.meta.dir, '..', 'bots', 'open-oracle-arbitrager', 'compose.yaml')
const arbitragerExampleFile = join(import.meta.dir, '..', 'bots', 'open-oracle-arbitrager', 'config', 'operator.example.json')

const batchCommands = (source: string) =>
	source
		.replaceAll('\r\n', '\n')
		.split('\n')
		.map(line => line.trim().replaceAll(/\s+/g, ' '))
		.filter(line => line !== '' && line.toLowerCase() !== '@echo off')

describe('local test network packaging', () => {
	test('builds a pinned Anvil image on the shared Zoltar network', async () => {
		const compose = Bun.YAML.parse(await readFile(composeFile, 'utf8'))
		const image = await readFile(dockerfile, 'utf8')

		expect(compose).toEqual(
			expect.objectContaining({
				networks: { default: { external: true, name: 'zoltar' } },
				services: {
					anvil: expect.objectContaining({
						build: { context: '..', dockerfile: 'testnetwork/Dockerfile' },
						image: 'zoltar-testnetwork',
						ports: ['127.0.0.1:${ANVIL_RPC_PORT:-8545}:8545'],
					}),
				},
			}),
		)

		expect(image).toContain('FROM ghcr.io/foundry-rs/foundry:v1.5.1')
		expect(image).toContain('ENTRYPOINT ["anvil"]')
		for (const argument of ['"--host", "0.0.0.0"', '"--port", "8545"', '"--chain-id", "11155111"', '"--hardfork", "osaka"', '"--block-time", "1"', '"--block-base-fee-per-gas", "0"', '"--gas-price", "0"', '"--no-priority-fee"']) {
			expect(image).toContain(argument)
		}
	})

	test('provides a location-independent Windows launcher', async () => {
		expect(batchCommands(await readFile(windowsLauncher, 'utf8'))).toEqual(['pushd "%~dp0" || exit /b 1', 'docker network inspect zoltar >nul 2>&1 || docker network create zoltar || exit /b 1', 'docker compose up --build --force-recreate', 'set "exit_code=%errorlevel%"', 'popd', 'pause', 'exit /b %exit_code%'])
	})

	test('accepts only known local node services as non-loopback HTTP RPCs', () => {
		expect(validateConnectivitySettings({ publicRpcUrls: ['http://anvil:8545'], readRpcUrl: 'http://anvil:8545' })).toEqual({
			publicRpcUrls: ['http://anvil:8545/'],
			readRpcUrl: 'http://anvil:8545/',
		})
		expect(validateConnectivitySettings({ publicRpcUrls: ['http://reth:8545'], readRpcUrl: 'http://reth:8545' })).toEqual({
			publicRpcUrls: ['http://reth:8545/'],
			readRpcUrl: 'http://reth:8545/',
		})
		expect(() => validateConnectivitySettings({ publicRpcUrls: ['http://other-service:8545'], readRpcUrl: 'http://other-service:8545' })).toThrow('HTTPS or HTTP on loopback, anvil, or reth')
	})

	test('defaults both bots to one reader while the arbitrager owns its policy in saved settings', async () => {
		expect(await readFile(liquidatorComposeFile, 'utf8')).toContain('ZOLTAR_BOT_RPC_QUORUM: ${ZOLTAR_BOT_RPC_QUORUM-1}')
		expect(await readFile(arbitragerComposeFile, 'utf8')).not.toContain('ZOLTAR_BOT_RPC_QUORUM')
		expect(JSON.parse(await readFile(arbitragerExampleFile, 'utf8'))).toMatchObject({ rpcQuorum: 1 })
	})
})
