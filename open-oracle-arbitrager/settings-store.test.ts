import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Hex } from '@zoltar/shared/ethereum'
import { loadOperatorSettings, saveOperatorSettings } from './settings-store.js'

const temporaryDirectories: string[] = []
const privateKey = `0x${'11'.repeat(32)}` as Hex

afterEach(async () => {
	await Promise.all(temporaryDirectories.splice(0).map(directory => rm(directory, { force: true, recursive: true })))
})

function settings(privateKeyValue: Hex | undefined) {
	return {
		connectivity: {
			publicRpcUrls: ['https://submit-one.example/', 'https://submit-two.example/'],
			readRpcUrl: 'https://read.example/',
		},
		paused: true,
		privateKey: privateKeyValue,
		strategy: {
			maxSpotTwapTicks: 75n,
			minimumProfitBps: 200n,
			minimumProfitWeth: 25n * 10n ** 15n,
			minimumRemainingBlocks: 4n,
			minimumRemainingSeconds: 48n,
			pollMilliseconds: 15_000,
			twapSeconds: 2_400,
		},
		submission: {
			mode: 'private' as const,
			relayUrls: ['https://relay.flashbots.net/', 'https://relay.example/'],
		},
		tokenAddresses: ['0x0000000000000000000000000000000000000001' as const],
	}
}

describe('operator settings persistence', () => {
	test('atomically round-trips restart settings with owner-only permissions', async () => {
		const directory = await mkdtemp(join(tmpdir(), 'zoltar-arbitrager-settings-'))
		temporaryDirectories.push(directory)
		const path = join(directory, 'nested', 'settings.json')
		await saveOperatorSettings(path, 'mainnet', settings(privateKey))
		expect((await stat(path)).mode & 0o777).toBe(0o600)
		expect(await loadOperatorSettings(path, 'mainnet')).toEqual(settings(privateKey))
	})

	test('does not write an unremembered signer and removes a previously remembered signer', async () => {
		const directory = await mkdtemp(join(tmpdir(), 'zoltar-arbitrager-settings-'))
		temporaryDirectories.push(directory)
		const path = join(directory, 'settings.json')
		await saveOperatorSettings(path, 'mainnet', settings(privateKey))
		await saveOperatorSettings(path, 'mainnet', settings(undefined))
		const contents = await readFile(path, 'utf8')
		expect(contents).not.toContain(privateKey)
		expect(await loadOperatorSettings(path, 'mainnet')).toEqual(settings(undefined))
	})

	test('fails closed for malformed, unknown, or cross-network settings', async () => {
		const directory = await mkdtemp(join(tmpdir(), 'zoltar-arbitrager-settings-'))
		temporaryDirectories.push(directory)
		const path = join(directory, 'settings.json')
		expect(await loadOperatorSettings(path, 'mainnet')).toBeUndefined()
		await writeFile(path, 'not json', 'utf8')
		expect(loadOperatorSettings(path, 'mainnet')).rejects.toThrow('not valid JSON')
		await saveOperatorSettings(path, 'mainnet', settings(undefined))
		expect(loadOperatorSettings(path, 'sepolia')).rejects.toThrow('for mainnet, not sepolia')
		const parsed = JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>
		await writeFile(path, JSON.stringify({ ...parsed, unexpected: true }), 'utf8')
		expect(loadOperatorSettings(path, 'mainnet')).rejects.toThrow('Unknown saved operator setting')
	})
})
