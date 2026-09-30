import { expect, test } from 'bun:test'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readBotEnvironment, rpcQuorumEnvironment, signerLockRootEnvironment } from '../../src/config/environment.ts'

test('reads every shared bot variable into one typed object with its defaults', () => {
	expect(readBotEnvironment({})).toEqual({
		dashboard: { loopbackPublished: false, password: undefined, publicAuthority: undefined },
		scanBlockTimeMs: undefined,
		signerLockRoot: join(tmpdir(), 'zoltar-bot-locks'),
	})
	expect(
		readBotEnvironment({
			SCAN_BLOCK_TIME_MS: '2000',
			ZOLTAR_BOT_DASHBOARD_LOOPBACK_PUBLISHED: 'true',
			ZOLTAR_BOT_DASHBOARD_PASSWORD: 'correct horse battery staple',
			ZOLTAR_BOT_DASHBOARD_PUBLIC_AUTHORITY: 'bot.example:4183',
			ZOLTAR_BOT_RPC_QUORUM: '2',
			ZOLTAR_BOT_SIGNER_LOCK_ROOT: '/state/locks',
		}),
	).toEqual({
		dashboard: { loopbackPublished: true, password: 'correct horse battery staple', publicAuthority: 'bot.example:4183' },
		scanBlockTimeMs: 2000,
		signerLockRoot: '/state/locks',
	})
})

test('rejects malformed values with the variable name and keeps lenient fallbacks', () => {
	expect(() => readBotEnvironment({ SCAN_BLOCK_TIME_MS: '0' })).toThrow('SCAN_BLOCK_TIME_MS must be a positive integer')
	expect(() => readBotEnvironment({ SCAN_BLOCK_TIME_MS: '1.5' })).toThrow('SCAN_BLOCK_TIME_MS must be a positive integer')
	expect(() => rpcQuorumEnvironment({ ZOLTAR_BOT_RPC_QUORUM: '3' })).toThrow('ZOLTAR_BOT_RPC_QUORUM must be 1 or 2')
	expect(rpcQuorumEnvironment({ ZOLTAR_BOT_RPC_QUORUM: '2' })).toBe(2)
	expect(() => rpcQuorumEnvironment({ ZOLTAR_BOT_RPC_QUORUM: '' })).toThrow('ZOLTAR_BOT_RPC_QUORUM must be 1 or 2')
	expect(() => readBotEnvironment({ SCAN_BLOCK_TIME_MS: 'soon' })).toThrow('SCAN_BLOCK_TIME_MS must be a positive integer')
	expect(signerLockRootEnvironment({ ZOLTAR_BOT_SIGNER_LOCK_ROOT: '   ' })).toBe(join(tmpdir(), 'zoltar-bot-locks'))
	expect(readBotEnvironment({ ZOLTAR_BOT_DASHBOARD_LOOPBACK_PUBLISHED: '1' }).dashboard.loopbackPublished).toBe(false)
})
