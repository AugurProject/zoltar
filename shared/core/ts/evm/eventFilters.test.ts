import { expect, test } from 'bun:test'
import { createPublicClient, custom, encodeEventTopics, keccak256, toHex } from './ethereum.js'

for (const anonymous of [false, true]) {
	const event = {
		type: 'event',
		name: 'Filter',
		anonymous,
		inputs: [
			{ name: 'value', type: 'uint256', indexed: true },
			{ type: 'uint256', indexed: true },
		],
	} as const
	const signature = anonymous ? [] : [keccak256('Filter(uint256,uint256)')]

	for (const unnamedInput of [event.inputs[1], { ...event.inputs[1], name: '' }]) {
		const partiallyNamedEvent = { ...event, inputs: [event.inputs[0], unnamedInput] } as const
		test(`preserves named filters in partially named events (anonymous=${anonymous}, emptyName=${'name' in unnamedInput})`, async () => {
			for (const value of [7n, [7n, 8n], []]) {
				const topics = [...signature, Array.isArray(value) ? value.map(item => toHex(item, { size: 32 })) : toHex(value, { size: 32 }), null]
				expect(encodeEventTopics({ abi: [partiallyNamedEvent], eventName: 'Filter', args: { value } })).toEqual(topics)
				const client = createPublicClient({
					transport: custom({
						request: async ({ method, params }) => {
							expect(method).toBe('eth_getLogs')
							expect(params).toEqual([{ topics }])
							return []
						},
					}),
				})
				await expect(client.getLogs({ event: partiallyNamedEvent, args: { value } })).resolves.toEqual([])
			}
		})
	}

	test(`encodes empty OR filters as wildcards (anonymous=${anonymous})`, () => {
		const namedEvent = {
			...event,
			inputs: [
				{ name: 'value', type: 'uint256', indexed: true },
				{ name: 'other', type: 'uint256', indexed: true },
			],
		} as const
		for (const args of [{ value: [], other: [7n, 8n] }, [[], [7n, 8n]]]) {
			expect(encodeEventTopics({ abi: [namedEvent], eventName: 'Filter', args })).toEqual([...signature, [], [toHex(7n, { size: 32 }), toHex(8n, { size: 32 })]])
		}
	})
}
