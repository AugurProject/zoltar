import { expect, test } from 'bun:test'
import { encodeAbiParameters } from '@zoltar/core-shared/evm/ethereum'
import { getVaultOperationsRevertReason } from '@zoltar/ui-statoblast-shared/protocol/vaultOperationsErrors.js'

test('decodes a bundle revert hidden behind an unknown RPC wrapper', () => {
	const reason = 'Liquidation distance too low'
	const data = `0x08c379a0${encodeAbiParameters([{ type: 'string' }], [reason]).slice(2)}`
	expect(getVaultOperationsRevertReason({ shortMessage: 'An unknown RPC error occurred.', cause: { data: { error: { data } } } })).toBe(reason)
})

test('rejects malformed revert data and handles cyclic RPC causes', () => {
	const failure: { shortMessage: string; cause?: unknown } = { shortMessage: 'An unknown RPC error occurred.' }
	failure.cause = failure
	expect(getVaultOperationsRevertReason(failure)).toBeUndefined()
	expect(getVaultOperationsRevertReason({ data: '0x08c379a000' })).toBeUndefined()
})
