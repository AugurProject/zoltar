import { expect, test } from 'bun:test'
import { concatHex, encodeFunctionData, getAddress, isHex, parseAbi, toHex, zeroHash } from '../../src/ethereum.ts'
import { decodeAction } from '../../src/metadata.ts'
import transaction from './delegation-transaction.json'

const wrapperAbi = parseAbi(['function redeemDelegations(bytes[] _permissionContexts,bytes32[] _modes,bytes[] _executionCallDatas)'])
const target = getAddress(transaction.target)
const labels = new Map([[target.toLowerCase(), 'Security Pool']])
const kinds = new Map([[target.toLowerCase(), 'securityPool']])
const wrapped = (execution: `0x${string}`, mode = zeroHash) => encodeFunctionData({ abi: wrapperAbi, functionName: 'redeemDelegations', args: [['0x'], [mode], [execution]] })

test('decodes the reported Sepolia delegation transaction and its inner call', () => {
	if (!isHex(transaction.input)) throw new Error('Invalid transaction fixture')
	const decoded = decodeAction(undefined, `0x${transaction.input.slice(2)}`, labels, new Map(), kinds)
	expect(decoded.status).toBe('decoded')
	expect(decoded.name).toBe('redeemDelegations')
	expect(decoded.summary).toContain('Security Pool')
	expect(decoded.summary).toContain('depositRepToVault')
	expect(decoded.summary).toContain('110 REP')
	expect(decoded.summary).toContain('targetHealthFactorBps=10000')
	expect(decoded.summary).not.toContain('Unknown call')
	expect(decoded.referencedAddresses).toContain(target)
	expect(decoded.displayArguments?.['_executionCallDatas']).not.toEqual(decoded.arguments?.['_executionCallDatas'])
})

test('decodes known token calls inside single executions with token formatting', () => {
	const call = encodeFunctionData({ abi: parseAbi(['function transfer(address to,uint256 value) returns (bool)']), functionName: 'transfer', args: [target, 2n * 10n ** 18n] })
	const decoded = decodeAction(undefined, wrapped(concatHex([target, toHex(0n, { size: 32 }), call])), labels, new Map(), new Map([[target.toLowerCase(), 'reputationToken']]))
	expect(decoded.name).toBe('redeemDelegations')
	expect(decoded.summary).toContain('transfer')
	expect(decoded.summary).toContain('2 REP')
})

test('retains unknown targets, unsupported modes and malformed execution data without inventing inner calls', () => {
	const execution = concatHex([target, toHex(0n, { size: 32 }), '0x12345678'])
	const unknown = decodeAction(undefined, wrapped(execution), labels)
	expect(unknown.name).toBe('redeemDelegations')
	expect(unknown.summary).toContain('0x12345678')
	const unsupported = decodeAction(undefined, wrapped(execution, `0xff${'00'.repeat(31)}`), labels)
	expect(unsupported.name).toBe('redeemDelegations')
	expect(unsupported.summary).toContain('Unsupported execution mode')
	expect(unsupported.arguments?.['_executionCallDatas']).toEqual([execution.toLowerCase()])
	const malformed = decodeAction(undefined, wrapped('0x1234'), labels)
	expect(malformed.name).toBe('redeemDelegations')
	expect(malformed.summary).toContain('Malformed execution')
})

test('rejects malformed wrapper calldata and preserves ordinary unknown calls', () => {
	expect(decodeAction(undefined, '0xcef6d209', labels).status).toBe('failed')
	expect(decodeAction(undefined, '0x12345678', labels).status).toBe('unknown')
})

test('preserves multiple executions, native value and allow-failure mode', () => {
	const execution = concatHex([target, toHex(3n * 10n ** 18n, { size: 32 })])
	const input = encodeFunctionData({
		abi: wrapperAbi,
		functionName: 'redeemDelegations',
		args: [
			['0x', '0x'],
			[zeroHash, `0x0001${'00'.repeat(30)}`],
			[execution, execution],
		],
	})
	const decoded = decodeAction(undefined, input, labels, new Map(), kinds, { nativeSymbol: 'SepoliaETH' })
	expect(decoded.summary).toContain('3 SepoliaETH')
	expect(decoded.summary).toContain('allow failure')
	expect(decoded.displayArguments?.['_executionCallDatas']).toHaveLength(2)
	expect(decoded.referencedAddresses).toEqual([target])
})

test('rejects mismatched delegation arrays', () => {
	const input = encodeFunctionData({ abi: wrapperAbi, functionName: 'redeemDelegations', args: [[], [zeroHash], []] })
	expect(decodeAction(undefined, input, labels)).toMatchObject({ status: 'failed', error: 'Delegation arrays must have matching lengths' })
})

test('bounds nested delegation decoding and keeps the wrapper identity', () => {
	let input = wrapped(concatHex([target, toHex(0n, { size: 32 })]))
	for (let depth = 0; depth < 6; depth++) input = wrapped(concatHex([target, toHex(0n, { size: 32 }), input]))
	const decoded = decodeAction(undefined, input, labels)
	expect(decoded.status).toBe('decoded')
	expect(decoded.summary).toContain('Nested execution decoding limit reached')
	expect(decoded.summary.length).toBeLessThan(1000)
})

test('does not reinterpret known protocol calls as delegation wrappers', () => {
	const contract = { address: target, kind: 'securityPool', label: 'Security Pool', provenance: 'test' }
	if (!isHex(transaction.input)) throw new Error('Invalid transaction fixture')
	expect(decodeAction(contract, `0x${transaction.input.slice(2)}`, labels).status).toBe('failed')
})
