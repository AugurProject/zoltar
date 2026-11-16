import { expect, test } from 'bun:test'
import { encodeFunctionData } from './codec.js'
import { parseAbiItem, parseAbiParameters } from './parser.js'

test('canonicalizes payable addresses without treating payable as a parameter name', () => {
	expect(parseAbiParameters('address payable')).toEqual([{ type: 'address' }])
	expect(parseAbiParameters('address payable recipient, address payable[] recipients')).toEqual([
		{ type: 'address', name: 'recipient' },
		{ type: 'address[]', name: 'recipients' },
	])
	expect(parseAbiParameters('(address payable recipient, uint amount) payout')).toEqual([
		{
			type: 'tuple',
			name: 'payout',
			components: [
				{ type: 'address', name: 'recipient' },
				{ type: 'uint256', name: 'amount' },
			],
		},
	])
	expect(parseAbiParameters('address payable indexed recipient')).toEqual([{ type: 'address', indexed: true, name: 'recipient' }])
})

test('preserves function payable mutability while canonicalizing address inputs and outputs', () => {
	const payable = parseAbiItem('function pay(address payable recipient) payable returns (address payable)')
	const canonical = parseAbiItem('function pay(address recipient) payable returns (address)')
	expect(payable).toEqual(canonical)
	expect(payable).toMatchObject({ stateMutability: 'payable' })
	const recipient = '0x0000000000000000000000000000000000000001'
	expect(encodeFunctionData({ abi: [payable], functionName: 'pay', args: [recipient] })).toBe(encodeFunctionData({ abi: [canonical], functionName: 'pay', args: [recipient] }))
})
