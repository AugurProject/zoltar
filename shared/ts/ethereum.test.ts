import { describe, expect, test } from 'bun:test'
import {
	concatHex,
	createPublicClient,
	createWalletClient,
	custom,
	decodeFunctionData,
	decodeEventLog,
	encodeAbiParameters,
	encodeDeployData,
	encodeEventTopics,
	encodeFunctionData,
	formatEther,
	formatUnits,
	getAddress,
	getCreate2Address,
	hexToBytes,
	isAddress,
	isHex,
	keccak256,
	mainnet,
	numberToBytes,
	parseAbiItem,
	parseAbiParameters,
	parseTransaction,
	parseUnits,
	privateKeyToAccount,
	publicActions,
	recoverTransactionAddress,
	toHex,
	type BlockTransaction,
	type EIP1193Provider,
	type Hash,
	type Hex,
} from '@zoltar/shared/ethereum'

const PRIVATE_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80' satisfies Hex
const ACCOUNT_ADDRESS = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266'
const TOKEN_ADDRESS = '0x00000000000000000000000000000000000000AA'
const OWNER_ADDRESS = '0x00000000000000000000000000000000000000BB'
const RECIPIENT_ADDRESS = '0x00000000000000000000000000000000000000CC'
const MULTICALL_ADDRESS = '0x00000000000000000000000000000000000000DD'
const RECEIPT_HASH = `0x${'11'.repeat(32)}` satisfies Hash
const BLOCK_HASH = `0x${'22'.repeat(32)}` satisfies Hash
const TX_HASH = `0x${'33'.repeat(32)}` satisfies Hash

const BALANCE_OF_ABI = [
	{
		inputs: [{ name: 'owner', type: 'address' }],
		name: 'balanceOf',
		outputs: [{ name: 'balance', type: 'uint256' }],
		stateMutability: 'view',
		type: 'function',
	},
] as const
const TRANSFER_ABI = [
	{
		inputs: [
			{ name: 'to', type: 'address' },
			{ name: 'amount', type: 'uint256' },
		],
		name: 'transfer',
		outputs: [{ name: 'success', type: 'bool' }],
		type: 'function',
	},
] as const
const TRANSFER_EVENT_ABI = [
	{
		inputs: [
			{ indexed: true, name: 'from', type: 'address' },
			{ indexed: true, name: 'to', type: 'address' },
			{ name: 'value', type: 'uint256' },
		],
		name: 'Transfer',
		type: 'event',
	},
] as const
const SUBMIT_REPORT_ABI = [
	{
		inputs: [
			{ name: 'reportId', type: 'uint256' },
			{ name: 'amount1', type: 'uint128' },
			{ name: 'amount2', type: 'uint128' },
			{ name: 'stateHash', type: 'bytes32' },
		],
		name: 'submitReport',
		type: 'function',
	},
	{
		inputs: [
			{ name: 'reportId', type: 'uint256' },
			{ name: 'amount1', type: 'uint128' },
			{ name: 'amount2', type: 'uint128' },
			{ name: 'stateHash', type: 'bytes32' },
			{ name: 'reporter', type: 'address' },
		],
		name: 'submitReport',
		type: 'function',
	},
]
const WITHDRAW_DEPOSIT_OVERLOAD_ABI = [
	{
		inputs: [
			{ name: 'depositIndex', type: 'uint256' },
			{ name: 'outcome', type: 'uint8' },
		],
		name: 'withdrawDeposit',
		type: 'function',
	},
	{
		inputs: [
			{
				components: [
					{ name: 'depositor', type: 'address' },
					{ name: 'amount', type: 'uint256' },
				],
				name: 'proof',
				type: 'tuple',
			},
			{ name: 'outcome', type: 'uint8' },
		],
		name: 'withdrawDeposit',
		type: 'function',
	},
] as const
const MULTICALL3_ABI = [
	{
		inputs: [
			{
				components: [
					{ name: 'target', type: 'address' },
					{ name: 'allowFailure', type: 'bool' },
					{ name: 'callData', type: 'bytes' },
				],
				name: 'calls',
				type: 'tuple[]',
			},
		],
		name: 'aggregate3',
		outputs: [
			{
				components: [
					{ name: 'success', type: 'bool' },
					{ name: 'returnData', type: 'bytes' },
				],
				name: 'returnData',
				type: 'tuple[]',
			},
		],
		stateMutability: 'payable',
		type: 'function',
	},
] as const
const OWNER_CHECK_ABI = [
	{
		inputs: [{ name: 'target', type: 'address' }],
		name: 'ownerCheck',
		outputs: [{ name: 'ok', type: 'uint256' }],
		stateMutability: 'nonpayable',
		type: 'function',
	},
] as const

function getArrayEntry(value: unknown, index: number, context: string) {
	if (!Array.isArray(value)) throw new Error(`${context} must be an array`)
	return value[index]
}

function getObjectEntry(value: unknown, key: string, context: string) {
	if (typeof value !== 'object' || value === null) throw new Error(`${context} must be an object`)
	return Reflect.get(value, key)
}

function getDecodedEntry(value: unknown, index: number, key: string, context: string) {
	if (Array.isArray(value)) return value[index]
	if (typeof value !== 'object' || value === null) throw new Error(`${context} must be an object or array`)
	const namedValue = Reflect.get(value, key)
	if (namedValue !== undefined) return namedValue
	return Reflect.get(value, index.toString())
}

function requireHex(value: unknown, context: string): Hex {
	if (typeof value !== 'string') throw new Error(`${context} must be hex`)
	return value as Hex
}

function createProvider(handler: (request: { method: string; params: unknown }) => Promise<unknown> | unknown, calls: { method: string; params: unknown }[]): EIP1193Provider {
	return {
		request: async request => {
			calls.push({
				method: request.method,
				params: request.params,
			})
			return await handler({
				method: request.method,
				params: request.params,
			})
		},
	}
}

describe('shared ethereum compatibility layer', () => {
	test('abi helpers preserve legacy decoding and parsing behavior', () => {
		const lowerCaseOwner = OWNER_ADDRESS.toLowerCase()
		const transferCall = encodeFunctionData({
			abi: TRANSFER_ABI,
			functionName: 'transfer',
			args: [lowerCaseOwner, 15n],
		})
		const decodedCall = decodeFunctionData({
			abi: TRANSFER_ABI,
			data: transferCall,
		})
		expect(decodedCall.functionName).toBe('transfer')
		expect(decodedCall.args).toEqual([getAddress(lowerCaseOwner), 15n])
		const arrayCallAbi = [
			{
				inputs: [{ name: 'values', type: 'uint256[]' }],
				name: 'setValues',
				outputs: [],
				type: 'function',
			},
		] as const
		expect(
			decodeFunctionData({
				abi: arrayCallAbi,
				data: encodeFunctionData({
					abi: arrayCallAbi,
					args: [[1n, 2n]],
					functionName: 'setValues',
				}),
			}).args,
		).toEqual([[1n, 2n]])
		const tupleArrayCallAbi = [
			{
				inputs: [
					{
						components: [
							{ name: 'amount', type: 'uint256' },
							{ name: 'recipient', type: 'address' },
						],
						name: 'items',
						type: 'tuple[]',
					},
				],
				name: 'setItems',
				outputs: [],
				type: 'function',
			},
		] as const
		expect(
			decodeFunctionData({
				abi: tupleArrayCallAbi,
				data: encodeFunctionData({
					abi: tupleArrayCallAbi,
					args: [[{ amount: 3n, recipient: lowerCaseOwner }]],
					functionName: 'setItems',
				}),
			}).args,
		).toEqual([[{ amount: 3n, recipient: getAddress(lowerCaseOwner) }]])

		const eventTopics = encodeEventTopics({
			abi: TRANSFER_EVENT_ABI,
			eventName: 'Transfer',
			args: [OWNER_ADDRESS, RECIPIENT_ADDRESS, null],
		})
		const decodedEvent = decodeEventLog({
			abi: TRANSFER_EVENT_ABI,
			data: encodeAbiParameters([{ name: 'value', type: 'uint256' }], [25n]),
			topics: eventTopics.filter((topic): topic is Hex => topic !== null),
		})
		expect(decodedEvent.eventName).toBe('Transfer')
		expect(getDecodedEntry(decodedEvent.args, 0, 'from', 'decoded event args')).toBe(getAddress(OWNER_ADDRESS))
		expect(getDecodedEntry(decodedEvent.args, 1, 'to', 'decoded event args')).toBe(getAddress(RECIPIENT_ADDRESS))
		expect(getDecodedEntry(decodedEvent.args, 2, 'value', 'decoded event args')).toBe(25n)

		const deploymentData = encodeDeployData({
			abi: [
				{
					inputs: [
						{ name: 'owner', type: 'address' },
						{ name: 'supply', type: 'uint256' },
					],
					type: 'constructor',
				},
			],
			args: [OWNER_ADDRESS, 7n],
			bytecode: '0x60006001',
		})
		expect(deploymentData).toBe(
			`0x60006001${encodeAbiParameters(
				[
					{ name: 'owner', type: 'address' },
					{ name: 'supply', type: 'uint256' },
				],
				[OWNER_ADDRESS, 7n],
			).slice(2)}`,
		)
		expect(
			encodeDeployData({
				abi: [],
				bytecode: '0x60006002',
			}),
		).toBe('0x60006002')

		expect(parseAbiParameters('address indexed from, uint256 amount')).toEqual([
			{ indexed: true, name: 'from', type: 'address' },
			{ name: 'amount', type: 'uint256' },
		])
		expect(parseAbiParameters('address depositor, (uint256 amount, bytes32 salt) proof')).toEqual([
			{ name: 'depositor', type: 'address' },
			{
				components: [
					{ name: 'amount', type: 'uint256' },
					{ name: 'salt', type: 'bytes32' },
				],
				name: 'proof',
				type: 'tuple',
			},
		])
		expect(parseAbiItem('function transfer(address to, uint256 amount)')).toEqual({
			inputs: [
				{ name: 'to', type: 'address' },
				{ name: 'amount', type: 'uint256' },
			],
			name: 'transfer',
			outputs: [],
			type: 'function',
		})
		expect(parseAbiItem('function balanceOf(address owner) view returns (uint256 balance)')).toEqual({
			inputs: [{ name: 'owner', type: 'address' }],
			name: 'balanceOf',
			outputs: [{ name: 'balance', type: 'uint256' }],
			stateMutability: 'view',
			type: 'function',
		})
		expect(parseAbiItem('function aliasTypes(uint value, byte flag) external view returns (uint result, byte raw)')).toEqual({
			inputs: [
				{ name: 'value', type: 'uint256' },
				{ name: 'flag', type: 'bytes1' },
			],
			name: 'aliasTypes',
			outputs: [
				{ name: 'result', type: 'uint256' },
				{ name: 'raw', type: 'bytes1' },
			],
			stateMutability: 'view',
			type: 'function',
		})
		expect(
			encodeFunctionData({
				abi: [parseAbiItem('function aliasTypes(uint value, byte flag) external view returns (uint result, byte raw)')],
				functionName: 'aliasTypes',
				args: [7n, '0xaa'],
			}),
		).toBe(
			encodeFunctionData({
				abi: [
					{
						inputs: [
							{ name: 'value', type: 'uint256' },
							{ name: 'flag', type: 'bytes1' },
						],
						name: 'aliasTypes',
						outputs: [
							{ name: 'result', type: 'uint256' },
							{ name: 'raw', type: 'bytes1' },
						],
						stateMutability: 'view',
						type: 'function',
					},
				],
				functionName: 'aliasTypes',
				args: [7n, '0xaa'],
			}),
		)
		expect(parseAbiItem('function withdrawDeposit((address depositor, uint256 amount) proof, uint8 outcome) nonpayable returns (uint256 amountToWithdraw)')).toEqual({
			inputs: [
				{
					components: [
						{ name: 'depositor', type: 'address' },
						{ name: 'amount', type: 'uint256' },
					],
					name: 'proof',
					type: 'tuple',
				},
				{ name: 'outcome', type: 'uint8' },
			],
			name: 'withdrawDeposit',
			outputs: [{ name: 'amountToWithdraw', type: 'uint256' }],
			stateMutability: 'nonpayable',
			type: 'function',
		})
		expect(parseAbiItem('event Transfer(address indexed from, address indexed to, uint256 value)')).toEqual({
			inputs: [
				{ indexed: true, name: 'from', type: 'address' },
				{ indexed: true, name: 'to', type: 'address' },
				{ name: 'value', type: 'uint256' },
			],
			name: 'Transfer',
			type: 'event',
		})
		expect(isAddress(OWNER_ADDRESS)).toBe(true)
		expect(isAddress(`0X${OWNER_ADDRESS.slice(2)}`)).toBe(false)
		expect(concatHex(['0x12', '0x34', '0xab'])).toBe('0x1234ab')
	})

	test('overloaded function selection resolves by signature and argument count', () => {
		const stateHash = `0x${'55'.repeat(32)}` satisfies Hex
		const fourArgumentCall = encodeFunctionData({
			abi: SUBMIT_REPORT_ABI,
			functionName: 'submitReport',
			args: [7n, 8n, 9n, stateHash],
		})
		const fiveArgumentCall = encodeFunctionData({
			abi: SUBMIT_REPORT_ABI,
			functionName: 'submitReport',
			args: [7n, 8n, 9n, stateHash, OWNER_ADDRESS],
		})

		expect(fourArgumentCall.slice(0, 10)).not.toBe(fiveArgumentCall.slice(0, 10))
		expect(
			decodeFunctionData({
				abi: SUBMIT_REPORT_ABI,
				data: fourArgumentCall,
			}).args,
		).toEqual([7n, 8n, 9n, stateHash])
		expect(
			decodeFunctionData({
				abi: SUBMIT_REPORT_ABI,
				data: fiveArgumentCall,
			}).args,
		).toEqual([7n, 8n, 9n, stateHash, getAddress(OWNER_ADDRESS)])
	})

	test('overloaded function selection resolves same-arity overloads by argument shape', () => {
		const proof = {
			amount: 9n,
			depositor: OWNER_ADDRESS,
		} as const
		const scalarCall = encodeFunctionData({
			abi: WITHDRAW_DEPOSIT_OVERLOAD_ABI,
			functionName: 'withdrawDeposit',
			args: [7n, 1],
		})
		const tupleCall = encodeFunctionData({
			abi: WITHDRAW_DEPOSIT_OVERLOAD_ABI,
			functionName: 'withdrawDeposit',
			args: [proof, 1],
		})

		expect(scalarCall).toBe(
			encodeFunctionData({
				abi: WITHDRAW_DEPOSIT_OVERLOAD_ABI,
				functionName: 'withdrawDeposit(uint256,uint8)',
				args: [7n, 1],
			}),
		)
		expect(tupleCall).toBe(
			encodeFunctionData({
				abi: WITHDRAW_DEPOSIT_OVERLOAD_ABI,
				functionName: 'withdrawDeposit((address,uint256),uint8)',
				args: [proof, 1],
			}),
		)
		expect(scalarCall.slice(0, 10)).not.toBe(tupleCall.slice(0, 10))
		const decodedTupleCall = decodeFunctionData({
			abi: WITHDRAW_DEPOSIT_OVERLOAD_ABI,
			data: tupleCall,
		})
		const decodedProof = getDecodedEntry(decodedTupleCall.args, 0, 'proof', 'decoded tuple call args')
		expect(decodedTupleCall.functionName).toBe('withdrawDeposit')
		expect(getDecodedEntry(decodedProof, 0, 'depositor', 'decoded proof')).toBe(getAddress(OWNER_ADDRESS))
		expect(getDecodedEntry(decodedProof, 1, 'amount', 'decoded proof')).toBe(9n)
		expect(getDecodedEntry(decodedTupleCall.args, 1, 'outcome', 'decoded tuple call args')).toBe(1n)
	})

	test('transaction helpers sign, parse, recover, and format values', async () => {
		const account = privateKeyToAccount(PRIVATE_KEY)
		expect(account.address).toBe(ACCOUNT_ADDRESS)
		const signedMessage = await account.signMessage?.(keccak256('flashbots request body'))
		expect(signedMessage).toMatch(/^0x[0-9a-f]{130}$/)

		const signedLegacy = await account.signTransaction?.({
			chainId: 1,
			gas: 21_000n,
			gasPrice: 5n,
			nonce: 7n,
			to: TOKEN_ADDRESS,
			value: 9n,
		})
		if (signedLegacy === undefined) throw new Error('legacy signer missing')

		const parsedLegacy = parseTransaction(signedLegacy)
		expect(parsedLegacy.chainId).toBe(1n)
		expect(parsedLegacy.gas).toBe(21_000n)
		expect(parsedLegacy.gasPrice).toBe(5n)
		expect(parsedLegacy.nonce).toBe(7n)
		expect(parsedLegacy.to).toBe(getAddress(TOKEN_ADDRESS))
		expect(parsedLegacy.type).toBe('legacy')
		expect(parsedLegacy.value).toBe(9n)
		expect(await recoverTransactionAddress({ serializedTransaction: signedLegacy })).toBe(ACCOUNT_ADDRESS)

		const signedEip1559 = await account.signTransaction?.({
			chainId: 1,
			data: '0x1234',
			gas: 30_000n,
			maxFeePerGas: 20n,
			maxPriorityFeePerGas: 3n,
			nonce: 8n,
			to: RECIPIENT_ADDRESS,
			value: 12n,
		})
		if (signedEip1559 === undefined) throw new Error('eip1559 signer missing')

		const parsedEip1559 = parseTransaction(signedEip1559)
		expect(parsedEip1559.maxFeePerGas).toBe(20n)
		expect(parsedEip1559.maxPriorityFeePerGas).toBe(3n)
		expect(parsedEip1559.data).toBe('0x1234')
		expect(parsedEip1559.type).toBe('eip1559')

		expect(parseUnits('1.2300', 6)).toBe(1_230_000n)
		expect(parseUnits('1.', 18)).toBe(1_000_000_000_000_000_000n)
		expect(parseUnits('0.', 18)).toBe(0n)
		expect(parseUnits('1.0000000000000000000', 18)).toBe(1_000_000_000_000_000_000n)
		expect(() => parseUnits('.', 18)).toThrow('Invalid decimal value')
		expect(() => parseUnits('1.0000000000000000001', 18)).toThrow('Too many decimal places')
		expect(formatUnits(-1_230_000n, 6)).toBe('-1.23')
		expect(formatEther(123_000_000_000_000_000n)).toBe('0.123')
		expect(toHex(0)).toBe('0x0')
		expect(toHex(1)).toBe('0x1')
		expect(toHex(1n, { size: 2 })).toBe('0x0001')
		expect(toHex(new Uint8Array([]))).toBe('0x')
		expect(toHex(new Uint8Array([1]))).toBe('0x01')
		expect(() => toHex(-1)).toThrow('safe integer range')
		expect(() => toHex(-1n)).toThrow('safe integer range')
		expect(() => toHex(Number.MAX_SAFE_INTEGER + 1)).toThrow('safe integer range')
		expect(() => numberToBytes(Number.MAX_SAFE_INTEGER + 1)).toThrow('safe integer range')
		await expect(
			account.signTransaction?.({
				chainId: Number.MAX_SAFE_INTEGER + 1,
				gas: 21_000n,
				gasPrice: 5n,
				nonce: 7n,
				to: TOKEN_ADDRESS,
				value: 9n,
			}),
		).rejects.toThrow('safe integer range')
		expect(hexToBytes('0x1')).toEqual(new Uint8Array([1]))
		expect(isHex('0x1')).toBe(true)
		expect(isHex('0x1', { strict: true })).toBe(true)
		expect(isHex('ab')).toBe(false)
		expect(isHex('ab', { strict: true })).toBe(false)
		expect(isHex('abc')).toBe(false)
		expect(isHex('0xg')).toBe(false)
		expect(encodeAbiParameters([{ type: 'bytes' }], ['0x1'])).toBe(`0x${'00'.repeat(31)}20${'00'.repeat(31)}01${'10'}${'00'.repeat(31)}`)
		expect(encodeAbiParameters([{ type: 'bytes1' }], ['0x1'])).toBe(`0x10${'00'.repeat(31)}`)
		const oddBytesEventAbi = [
			{
				inputs: [
					{ indexed: true, name: 'fixed', type: 'bytes1' },
					{ indexed: true, name: 'dynamic', type: 'bytes' },
				],
				name: 'OddBytes',
				type: 'event',
			},
		] as const
		expect(
			encodeEventTopics({
				abi: oddBytesEventAbi,
				args: {
					dynamic: '0x1',
					fixed: '0x1',
				},
				eventName: 'OddBytes',
			}),
		).toEqual(['0x8e116c9360bbe2babb572771bef9e7dc316ca38e5c8b8660288df9d109be14f2', `0x10${'00'.repeat(31)}`, '0x5fe7f977e71dba2ea1a68e21057beebb9be2ac30c6410aa38d4f3fbe41dcffd2'])
		expect(
			encodeEventTopics({
				abi: oddBytesEventAbi,
				args: ['0x12', '0x12'],
				eventName: 'OddBytes',
			}),
		).toEqual(['0x8e116c9360bbe2babb572771bef9e7dc316ca38e5c8b8660288df9d109be14f2', `0x12${'00'.repeat(31)}`, '0x5fa2358263196dbbf23d1ca7a509451f7a2f64c15837bfbb81298b1e3e24e4fa'])
		expect(() =>
			encodeEventTopics({
				abi: oddBytesEventAbi,
				args: {
					dynamic: '0x1',
					fixed: '0x123',
				},
				eventName: 'OddBytes',
			}),
		).toThrow()
		const mixedIndexedEventAbi = [
			{
				inputs: [
					{ indexed: true, name: 'fixed', type: 'bytes1' },
					{ indexed: false, name: 'value', type: 'uint256' },
					{ indexed: true, name: 'dynamic', type: 'bytes' },
				],
				name: 'Mixed',
				type: 'event',
			},
		] as const
		const mixedIndexedTopics: (Hex | null)[] = ['0x14a2d594a2cb204ac32de7c5cd85d7edefbdcd1950db4ac196dfa859d6c00bb9', `0x10${'00'.repeat(31)}`, '0x5fe7f977e71dba2ea1a68e21057beebb9be2ac30c6410aa38d4f3fbe41dcffd2']
		expect(
			encodeEventTopics({
				abi: mixedIndexedEventAbi,
				args: ['0x1', '0x1'],
				eventName: 'Mixed',
			}),
		).toEqual(mixedIndexedTopics)
		expect(
			encodeEventTopics({
				abi: mixedIndexedEventAbi,
				args: ['0x1', 5n, '0x1'],
				eventName: 'Mixed',
			}),
		).toEqual(mixedIndexedTopics)
		expect(
			encodeEventTopics({
				abi: mixedIndexedEventAbi,
				args: {
					dynamic: '0x1',
					fixed: '0x1',
					value: 5n,
				},
				eventName: 'Mixed',
			}),
		).toEqual(mixedIndexedTopics)
		expect(keccak256('0x1')).toBe(keccak256('0x01'))
		expect(
			getCreate2Address({
				bytecode: '0x60006001',
				from: OWNER_ADDRESS,
				salt: toHex(1, { size: 32 }),
			}),
		).toBe(
			getCreate2Address({
				bytecodeHash: keccak256('0x60006001'),
				from: OWNER_ADDRESS,
				salt: toHex(1, { size: 32 }),
			}),
		)
		expect(
			getCreate2Address({
				bytecode: '0x1',
				from: OWNER_ADDRESS,
				salt: toHex(1, { size: 32 }),
			}),
		).toBe(
			getCreate2Address({
				bytecode: '0x01',
				from: OWNER_ADDRESS,
				salt: toHex(1, { size: 32 }),
			}),
		)
	})

	test('public client normalizes rpc reads, blocks, logs, and receipt polling', async () => {
		const calls: { method: string; params: unknown }[] = []
		const balanceOfData = encodeFunctionData({
			abi: BALANCE_OF_ABI,
			functionName: 'balanceOf',
			args: [OWNER_ADDRESS],
		})
		const transferTopics = encodeEventTopics({
			abi: TRANSFER_EVENT_ABI,
			eventName: 'Transfer',
			args: [OWNER_ADDRESS, RECIPIENT_ADDRESS, null],
		}).filter((topic): topic is Hex => topic !== null)
		let receiptPolls = 0
		const provider = createProvider(({ method, params }) => {
			if (method === 'eth_call') {
				const tx = getArrayEntry(params, 0, 'eth_call params')
				const data = getObjectEntry(tx, 'data', 'eth_call transaction')
				if (data === balanceOfData) return encodeAbiParameters([{ type: 'uint256' }], [42n])
				throw new Error(`Unexpected call data: ${String(data)}`)
			}
			if (method === 'eth_estimateGas') return '0x5208'
			if (method === 'eth_getBlockByNumber') {
				expect(getArrayEntry(params, 0, 'block params')).toBe('0xa')
				expect(getArrayEntry(params, 1, 'block params')).toBe(true)
				return {
					baseFeePerGas: '0x2',
					hash: BLOCK_HASH,
					number: '0xa',
					parentHash: `0x${'44'.repeat(32)}`,
					timestamp: '0x5',
					transactions: [
						{
							from: OWNER_ADDRESS,
							gas: '0x5208',
							hash: TX_HASH,
							input: '0x',
							nonce: '0x0',
							to: RECIPIENT_ADDRESS,
							transactionIndex: '0x0',
							type: '0x2',
							value: '0x5',
						},
					],
				}
			}
			if (method === 'eth_getLogs') {
				return [
					{
						address: TOKEN_ADDRESS,
						blockHash: BLOCK_HASH,
						blockNumber: '0x1',
						data: encodeAbiParameters([{ type: 'uint256' }], [5n]),
						logIndex: '0x0',
						removed: false,
						topics: transferTopics,
						transactionHash: TX_HASH,
						transactionIndex: '0x0',
					},
				]
			}
			if (method === 'eth_getTransactionReceipt') {
				receiptPolls += 1
				if (receiptPolls === 1) return null
				return {
					blockHash: BLOCK_HASH,
					blockNumber: '0xa',
					cumulativeGasUsed: '0x5208',
					effectiveGasPrice: '0x3',
					from: OWNER_ADDRESS,
					gasUsed: '0x5208',
					logs: [],
					status: '0x1',
					to: RECIPIENT_ADDRESS,
					transactionHash: RECEIPT_HASH,
					transactionIndex: '0x0',
					type: '0x2',
				}
			}
			throw new Error(`Unexpected rpc method: ${method}`)
		}, calls)
		const client = createPublicClient({
			chain: mainnet,
			transport: custom(provider),
		})

		expect(
			await client.readContract({
				abi: BALANCE_OF_ABI,
				address: TOKEN_ADDRESS,
				functionName: 'balanceOf',
				args: [OWNER_ADDRESS],
			}),
		).toBe(42n)
		expect(
			(
				await client.simulateContract({
					abi: BALANCE_OF_ABI,
					address: TOKEN_ADDRESS,
					functionName: 'balanceOf',
					args: [OWNER_ADDRESS],
				})
			).result,
		).toBe(42n)
		expect(
			await client.estimateContractGas({
				abi: BALANCE_OF_ABI,
				address: TOKEN_ADDRESS,
				functionName: 'balanceOf',
				args: [OWNER_ADDRESS],
			}),
		).toBe(21_000n)

		const block = await client.getBlock({
			blockNumber: 10n,
			includeTransactions: true,
		})
		expect(block.number).toBe(10n)
		expect(block.transactions).toHaveLength(1)
		expect(getObjectEntry(block.transactions[0], 'gas', 'block transaction')).toBe(21_000n)

		const transferEvent = TRANSFER_EVENT_ABI[0]
		if (transferEvent === undefined) throw new Error('transfer event ABI missing')
		const logs = await client.getLogs({
			address: TOKEN_ADDRESS,
			event: transferEvent,
			fromBlock: 1n,
			toBlock: 1n,
		})
		expect(logs).toHaveLength(1)
		expect(getObjectEntry(logs[0], 'eventName', 'decoded log')).toBe('Transfer')
		const logArgs = getObjectEntry(logs[0], 'args', 'decoded log')
		expect(getDecodedEntry(logArgs, 0, 'from', 'decoded log args')).toBe(getAddress(OWNER_ADDRESS))
		expect(getDecodedEntry(logArgs, 1, 'to', 'decoded log args')).toBe(getAddress(RECIPIENT_ADDRESS))
		expect(getDecodedEntry(logArgs, 2, 'value', 'decoded log args')).toBe(5n)
		const signatureTopic = transferTopics[0]
		const ownerTopic = transferTopics[1]
		if (signatureTopic === undefined || ownerTopic === undefined) throw new Error('transfer topics missing')
		const rawTopicFilter = [[signatureTopic], ownerTopic] as const
		const rawLogs = await client.getLogs({
			address: TOKEN_ADDRESS,
			fromBlock: 1n,
			toBlock: 1n,
			topics: rawTopicFilter,
		})
		expect(rawLogs).toHaveLength(1)
		expect(rawLogs[0]?.topics).toEqual(transferTopics)
		const rawLogsCall = calls.filter(call => call.method === 'eth_getLogs').at(-1)
		const rawLogsFilter = getArrayEntry(rawLogsCall?.params, 0, 'raw eth_getLogs params')
		expect(getObjectEntry(rawLogsFilter, 'topics', 'raw eth_getLogs filter')).toEqual(rawTopicFilter)
		await expect(client.getLogs({ address: TOKEN_ADDRESS, event: transferEvent, topics: rawTopicFilter })).rejects.toThrow('getLogs accepts either an event or raw topics, not both')

		const receipt = await client.waitForTransactionReceipt({
			hash: RECEIPT_HASH,
			pollingInterval: 0,
			timeout: 50,
		})
		expect(receipt.status).toBe('success')
		expect(receipt.effectiveGasPrice).toBe(3n)
		expect(receiptPolls).toBe(2)
		expect(calls.map(call => call.method)).toContain('eth_getLogs')
	})

	test('waitForTransactionReceipt resolves same-nonce replacements and reports the replacement reason', async () => {
		const originalHash = `0x${'55'.repeat(32)}` satisfies Hash
		const replacementHash = `0x${'66'.repeat(32)}` satisfies Hash
		const replacements: { reason: string; transactionHash: Hash }[] = []
		const calls: { method: string; params: unknown }[] = []
		const originalTransaction = {
			from: OWNER_ADDRESS,
			gas: '0x5208',
			hash: originalHash,
			input: '0x1234',
			nonce: '0x7',
			to: RECIPIENT_ADDRESS,
			transactionIndex: null,
			type: '0x2',
			value: '0x5',
		}
		const replacementTransaction = {
			...originalTransaction,
			gasPrice: '0x9',
			hash: replacementHash,
			transactionIndex: '0x0',
		}
		const provider = createProvider(({ method, params }) => {
			if (method === 'eth_getTransactionByHash') {
				expect(getArrayEntry(params, 0, 'transaction params')).toBe(originalHash)
				return originalTransaction
			}
			if (method === 'eth_getTransactionReceipt') {
				const hash = getArrayEntry(params, 0, 'receipt params')
				if (hash === originalHash) return null
				if (hash === replacementHash) {
					return {
						blockHash: BLOCK_HASH,
						blockNumber: '0xa',
						cumulativeGasUsed: '0x5208',
						effectiveGasPrice: '0x9',
						from: OWNER_ADDRESS,
						gasUsed: '0x5208',
						logs: [],
						status: '0x1',
						to: RECIPIENT_ADDRESS,
						transactionHash: replacementHash,
						transactionIndex: '0x0',
						type: '0x2',
					}
				}
			}
			if (method === 'eth_blockNumber') return '0x0'
			if (method === 'eth_getBlockByNumber') {
				expect(getArrayEntry(params, 0, 'replacement block params')).toBe('0x0')
				expect(getArrayEntry(params, 1, 'replacement block params')).toBe(true)
				return {
					hash: BLOCK_HASH,
					number: '0x0',
					parentHash: `0x${'44'.repeat(32)}`,
					timestamp: '0x5',
					transactions: [replacementTransaction],
				}
			}
			throw new Error(`Unexpected rpc method: ${method}`)
		}, calls)
		const client = createPublicClient({
			chain: mainnet,
			transport: custom(provider),
		})

		const receipt = await client.waitForTransactionReceipt({
			hash: originalHash,
			onReplaced: replacement => {
				replacements.push({
					reason: replacement.reason,
					transactionHash: replacement.transaction.hash,
				})
			},
			pollingInterval: 0,
			timeout: 50,
		})

		expect(receipt.transactionHash).toBe(replacementHash)
		expect(replacements).toEqual([
			{
				reason: 'repriced',
				transactionHash: replacementHash,
			},
		])
		expect(calls.map(call => call.method)).toEqual(['eth_getTransactionByHash', 'eth_getTransactionReceipt', 'eth_blockNumber', 'eth_getBlockByNumber', 'eth_getTransactionReceipt'])
	})

	test('waitForTransactionReceipt finds private-transaction replacements from supplied metadata', async () => {
		const originalHash = `0x${'57'.repeat(32)}` satisfies Hash
		const replacementHash = `0x${'68'.repeat(32)}` satisfies Hash
		const originalTransaction = {
			from: getAddress(OWNER_ADDRESS),
			gas: 21_000n,
			hash: originalHash,
			input: '0x1234',
			nonce: 9n,
			to: getAddress(RECIPIENT_ADDRESS),
			type: 'eip1559',
			value: 5n,
		} satisfies BlockTransaction
		const replacementTransaction = {
			from: OWNER_ADDRESS,
			gas: '0x5208',
			hash: replacementHash,
			input: '0x1234',
			nonce: '0x9',
			to: RECIPIENT_ADDRESS,
			transactionIndex: '0x0',
			type: '0x2',
			value: '0x5',
		}
		const calls: { method: string; params: unknown }[] = []
		const provider = createProvider(({ method, params }) => {
			if (method === 'eth_getTransactionByHash') throw new Error('Private transaction must not require public RPC visibility')
			if (method === 'eth_getTransactionReceipt') {
				const requestedHash = getArrayEntry(params, 0, 'receipt params')
				if (requestedHash === originalHash) return null
				if (requestedHash === replacementHash) {
					return {
						blockHash: BLOCK_HASH,
						blockNumber: '0xa',
						cumulativeGasUsed: '0x5208',
						effectiveGasPrice: '0x9',
						from: OWNER_ADDRESS,
						gasUsed: '0x5208',
						logs: [],
						status: '0x1',
						to: RECIPIENT_ADDRESS,
						transactionHash: replacementHash,
						transactionIndex: '0x0',
						type: '0x2',
					}
				}
			}
			if (method === 'eth_blockNumber') return '0x0'
			if (method === 'eth_getBlockByNumber') {
				return {
					hash: BLOCK_HASH,
					number: '0x0',
					parentHash: `0x${'44'.repeat(32)}`,
					timestamp: '0x5',
					transactions: [replacementTransaction],
				}
			}
			throw new Error(`Unexpected rpc method: ${method}`)
		}, calls)
		const client = createPublicClient({
			chain: mainnet,
			transport: custom(provider),
		})
		const replacements: string[] = []
		const receipt = await client.waitForTransactionReceipt({
			hash: originalHash,
			onReplaced: replacement => {
				replacements.push(replacement.reason)
			},
			pollingInterval: 0,
			timeout: 50,
			transaction: originalTransaction,
		})
		expect(receipt.transactionHash).toBe(replacementHash)
		expect(replacements).toEqual(['repriced'])
		expect(calls.map(call => call.method)).not.toContain('eth_getTransactionByHash')
	})

	test('public client rejects malformed fixed-width rpc hashes', async () => {
		const calls: { method: string; params: unknown }[] = []
		const provider = createProvider(({ method }) => {
			if (method === 'eth_getBlockByNumber') {
				return {
					hash: '0x1',
					number: '0x1',
					parentHash: BLOCK_HASH,
					timestamp: '0x5',
					transactions: [],
				}
			}
			throw new Error(`Unexpected rpc method: ${method}`)
		}, calls)
		const client = createPublicClient({
			chain: mainnet,
			transport: custom(provider),
		})

		await expect(
			client.getBlock({
				blockNumber: 1n,
			}),
		).rejects.toThrow('RPC returned an invalid hash')
	})

	test('waitForTransactionReceipt keeps the viem-compatible default timeout window', async () => {
		const calls: { method: string; params: unknown }[] = []
		const clockValues = [0, 120_000, 180_000]
		const originalDateNow = Date.now
		const provider = createProvider(({ method }) => {
			if (method === 'eth_getTransactionReceipt') return null
			throw new Error(`Unexpected rpc method: ${method}`)
		}, calls)
		const client = createPublicClient({
			chain: mainnet,
			transport: custom(provider),
		})

		Date.now = () => clockValues.shift() ?? 180_000
		try {
			await expect(
				client.waitForTransactionReceipt({
					hash: RECEIPT_HASH,
					pollingInterval: 0,
				}),
			).rejects.toThrow(`Transaction receipt with hash "${RECEIPT_HASH}" could not be found.`)
		} finally {
			Date.now = originalDateNow
		}

		expect(calls.map(call => call.method)).toEqual(['eth_getTransactionReceipt', 'eth_getTransactionReceipt'])
	})

	test('waitForTransactionReceipt scans previous blocks for delayed replacement detection', async () => {
		const originalHash = `0x${'77'.repeat(32)}` satisfies Hash
		const replacementHash = `0x${'88'.repeat(32)}` satisfies Hash
		const replacements: Hash[] = []
		const calls: { method: string; params: unknown }[] = []
		const originalTransaction = {
			from: OWNER_ADDRESS,
			gas: '0x5208',
			hash: originalHash,
			input: '0xabcd',
			nonce: '0x9',
			to: RECIPIENT_ADDRESS,
			transactionIndex: null,
			type: '0x2',
			value: '0x7',
		}
		const replacementTransaction = {
			...originalTransaction,
			hash: replacementHash,
			transactionIndex: '0x0',
		}
		const provider = createProvider(({ method, params }) => {
			if (method === 'eth_getTransactionByHash') return originalTransaction
			if (method === 'eth_getTransactionReceipt') {
				const hash = getArrayEntry(params, 0, 'receipt params')
				if (hash === originalHash) return null
				if (hash === replacementHash) {
					return {
						blockHash: BLOCK_HASH,
						blockNumber: '0x1',
						cumulativeGasUsed: '0x5208',
						effectiveGasPrice: '0x9',
						from: OWNER_ADDRESS,
						gasUsed: '0x5208',
						logs: [],
						status: '0x1',
						to: RECIPIENT_ADDRESS,
						transactionHash: replacementHash,
						transactionIndex: '0x0',
						type: '0x2',
					}
				}
			}
			if (method === 'eth_blockNumber') return '0x2'
			if (method === 'eth_getBlockByNumber') {
				const blockNumber = getArrayEntry(params, 0, 'replacement block params')
				return {
					hash: BLOCK_HASH,
					number: blockNumber,
					parentHash: `0x${'44'.repeat(32)}`,
					timestamp: '0x5',
					transactions: blockNumber === '0x1' ? [replacementTransaction] : [],
				}
			}
			throw new Error(`Unexpected rpc method: ${method}`)
		}, calls)
		const client = createPublicClient({
			chain: mainnet,
			transport: custom(provider),
		})

		const receipt = await client.waitForTransactionReceipt({
			hash: originalHash,
			onReplaced: replacement => {
				replacements.push(replacement.transaction.hash)
			},
			pollingInterval: 0,
			timeout: 50,
		})

		expect(receipt.transactionHash).toBe(replacementHash)
		expect(replacements).toEqual([replacementHash])
		expect(calls.filter(call => call.method === 'eth_getBlockByNumber').map(call => getArrayEntry(call.params, 0, 'block params'))).toEqual(['0x0', '0x1'])
	})

	test('waitForTransactionReceipt retries original transaction lookup before replacement scanning', async () => {
		const originalHash = `0x${'99'.repeat(32)}` satisfies Hash
		const replacementHash = `0x${'aa'.repeat(32)}` satisfies Hash
		const replacements: Hash[] = []
		let transactionLookupCount = 0
		const calls: { method: string; params: unknown }[] = []
		const originalTransaction = {
			from: OWNER_ADDRESS,
			gas: '0x5208',
			hash: originalHash,
			input: '0xabcd',
			nonce: '0xa',
			to: RECIPIENT_ADDRESS,
			transactionIndex: null,
			type: '0x2',
			value: '0x7',
		}
		const replacementTransaction = {
			...originalTransaction,
			hash: replacementHash,
			transactionIndex: '0x0',
		}
		const provider = createProvider(({ method, params }) => {
			if (method === 'eth_getTransactionByHash') {
				transactionLookupCount += 1
				return transactionLookupCount === 1 ? null : originalTransaction
			}
			if (method === 'eth_getTransactionReceipt') {
				const hash = getArrayEntry(params, 0, 'receipt params')
				if (hash === originalHash) return null
				if (hash === replacementHash) {
					return {
						blockHash: BLOCK_HASH,
						blockNumber: '0x0',
						cumulativeGasUsed: '0x5208',
						effectiveGasPrice: '0x9',
						from: OWNER_ADDRESS,
						gasUsed: '0x5208',
						logs: [],
						status: '0x1',
						to: RECIPIENT_ADDRESS,
						transactionHash: replacementHash,
						transactionIndex: '0x0',
						type: '0x2',
					}
				}
			}
			if (method === 'eth_blockNumber') return '0x0'
			if (method === 'eth_getBlockByNumber') {
				return {
					hash: BLOCK_HASH,
					number: '0x0',
					parentHash: `0x${'44'.repeat(32)}`,
					timestamp: '0x5',
					transactions: [replacementTransaction],
				}
			}
			throw new Error(`Unexpected rpc method: ${method}`)
		}, calls)
		const client = createPublicClient({
			chain: mainnet,
			transport: custom(provider),
		})

		const receipt = await client.waitForTransactionReceipt({
			hash: originalHash,
			onReplaced: replacement => {
				replacements.push(replacement.transaction.hash)
			},
			pollingInterval: 0,
			timeout: 50,
		})

		expect(receipt.transactionHash).toBe(replacementHash)
		expect(replacements).toEqual([replacementHash])
		expect(calls.map(call => call.method)).toEqual(['eth_getTransactionByHash', 'eth_getTransactionReceipt', 'eth_getTransactionByHash', 'eth_blockNumber', 'eth_getBlockByNumber', 'eth_getTransactionReceipt'])
	})

	test('simulateContract forwards account and call overrides into eth_call', async () => {
		const calls: { method: string; params: unknown }[] = []
		const expectedData = encodeFunctionData({
			abi: OWNER_CHECK_ABI,
			functionName: 'ownerCheck',
			args: [RECIPIENT_ADDRESS],
		})
		const provider = createProvider(({ method, params }) => {
			if (method !== 'eth_call') throw new Error(`Unexpected rpc method: ${method}`)
			const transaction = getArrayEntry(params, 0, 'simulate params')
			expect(getObjectEntry(transaction, 'from', 'simulate transaction')).toBe(getAddress(OWNER_ADDRESS))
			expect(getObjectEntry(transaction, 'data', 'simulate transaction')).toBe(expectedData)
			expect(getObjectEntry(transaction, 'gas', 'simulate transaction')).toBe('0x5208')
			expect(getObjectEntry(transaction, 'value', 'simulate transaction')).toBe('0x7')
			return encodeAbiParameters([{ type: 'uint256' }], [1n])
		}, calls)
		const client = createPublicClient({
			chain: mainnet,
			transport: custom(provider),
		})

		expect(
			(
				await client.simulateContract({
					abi: OWNER_CHECK_ABI,
					account: OWNER_ADDRESS,
					address: TOKEN_ADDRESS,
					args: [RECIPIENT_ADDRESS],
					functionName: 'ownerCheck',
					gas: 21_000n,
					value: 7n,
				})
			).result,
		).toBe(1n)
		expect(calls).toHaveLength(1)
	})

	test('public client reads pending transaction counts', async () => {
		const calls: { method: string; params: unknown }[] = []
		const provider = createProvider(({ method, params }) => {
			expect(method).toBe('eth_getTransactionCount')
			expect(params).toEqual([getAddress(OWNER_ADDRESS), 'pending'])
			return '0x7'
		}, calls)
		const client = createPublicClient({
			chain: mainnet,
			transport: custom(provider),
		})
		expect(await client.getTransactionCount({ address: getAddress(OWNER_ADDRESS), blockTag: 'pending' })).toBe(7n)
		expect(calls).toHaveLength(1)
	})

	test('public client multicall decodes success and failure entries', async () => {
		const calls: { method: string; params: unknown }[] = []
		const firstBalanceCall = encodeFunctionData({
			abi: BALANCE_OF_ABI,
			functionName: 'balanceOf',
			args: [OWNER_ADDRESS],
		})
		const secondBalanceCall = encodeFunctionData({
			abi: BALANCE_OF_ABI,
			functionName: 'balanceOf',
			args: [RECIPIENT_ADDRESS],
		})
		const aggregateData = encodeFunctionData({
			abi: MULTICALL3_ABI,
			functionName: 'aggregate3',
			args: [
				[
					{
						allowFailure: true,
						callData: firstBalanceCall,
						target: TOKEN_ADDRESS,
					},
					{
						allowFailure: true,
						callData: secondBalanceCall,
						target: TOKEN_ADDRESS,
					},
				],
			],
		})
		const provider = createProvider(({ method, params }) => {
			if (method !== 'eth_call') throw new Error(`Unexpected rpc method: ${method}`)
			const tx = getArrayEntry(params, 0, 'multicall params')
			const data = getObjectEntry(tx, 'data', 'multicall transaction')
			expect(data).toBe(aggregateData)
			return encodeAbiParameters(
				[
					{
						components: [
							{ name: 'success', type: 'bool' },
							{ name: 'returnData', type: 'bytes' },
						],
						name: 'returnData',
						type: 'tuple[]',
					},
				],
				[
					[
						[true, encodeAbiParameters([{ type: 'uint256' }], [7n])],
						[false, '0x'],
					],
				],
			)
		}, calls)
		const client = createPublicClient({
			transport: custom(provider),
		})

		const result = await client.multicall({
			allowFailure: true,
			contracts: [
				{
					abi: BALANCE_OF_ABI,
					address: TOKEN_ADDRESS,
					args: [OWNER_ADDRESS],
					functionName: 'balanceOf',
				},
				{
					abi: BALANCE_OF_ABI,
					address: TOKEN_ADDRESS,
					args: [RECIPIENT_ADDRESS],
					functionName: 'balanceOf',
				},
			],
			multicallAddress: MULTICALL_ADDRESS,
		})

		expect(result).toHaveLength(2)
		expect(result[0]).toEqual({
			result: 7n,
			status: 'success',
		})
		expect(getObjectEntry(result[1], 'status', 'multicall failure')).toBe('failure')
		expect(calls).toHaveLength(1)
	})

	test('wallet client uses rpc sendTransaction for json-rpc accounts and raw signing for local accounts', async () => {
		const remoteCalls: { method: string; params: unknown }[] = []
		const remoteProvider = createProvider(({ method, params }) => {
			if (method !== 'eth_sendTransaction') throw new Error(`Unexpected rpc method: ${method}`)
			const tx = getArrayEntry(params, 0, 'remote send params')
			expect(getObjectEntry(tx, 'from', 'remote tx')).toBe(getAddress(OWNER_ADDRESS))
			expect(getObjectEntry(tx, 'to', 'remote tx')).toBe(RECIPIENT_ADDRESS)
			expect(getObjectEntry(tx, 'value', 'remote tx')).toBe('0x5')
			return TX_HASH
		}, remoteCalls)
		const remoteClient = createWalletClient({
			account: OWNER_ADDRESS,
			chain: mainnet,
			transport: custom(remoteProvider),
		})
		expect(
			await remoteClient.sendTransaction({
				amount: 5n,
				to: RECIPIENT_ADDRESS,
			}),
		).toBe(TX_HASH)
		expect(remoteCalls).toHaveLength(1)

		const localCalls: { method: string; params: unknown }[] = []
		let capturedRawTransaction: Hex | undefined
		const localProvider = createProvider(({ method, params }) => {
			if (method !== 'eth_sendRawTransaction') throw new Error(`Unexpected rpc method: ${method}`)
			capturedRawTransaction = requireHex(getArrayEntry(params, 0, 'raw send params'), 'serialized transaction')
			return RECEIPT_HASH
		}, localCalls)
		const localClient = createWalletClient({
			account: privateKeyToAccount(PRIVATE_KEY),
			chain: mainnet,
			transport: custom(localProvider),
		})
		expect(
			await localClient.sendTransaction({
				data: encodeFunctionData({
					abi: TRANSFER_ABI,
					functionName: 'transfer',
					args: [RECIPIENT_ADDRESS, 9n],
				}),
				gas: 100_000n,
				maxFeePerGas: 20n,
				maxPriorityFeePerGas: 3n,
				nonce: 0n,
				to: TOKEN_ADDRESS,
			}),
		).toBe(RECEIPT_HASH)
		if (capturedRawTransaction === undefined) throw new Error('raw transaction was not captured')

		const parsedRawTransaction = parseTransaction(capturedRawTransaction)
		expect(parsedRawTransaction.to).toBe(getAddress(TOKEN_ADDRESS))
		expect(parsedRawTransaction.value).toBe(0n)
		expect(parsedRawTransaction.data).toBe(
			encodeFunctionData({
				abi: TRANSFER_ABI,
				functionName: 'transfer',
				args: [RECIPIENT_ADDRESS, 9n],
			}),
		)
		expect(await recoverTransactionAddress({ serializedTransaction: capturedRawTransaction })).toBe(ACCOUNT_ADDRESS)
		expect(localCalls).toHaveLength(1)
	})

	test('wallet client defaults simulations and gas estimates to its configured account', async () => {
		const calls: { method: string; params: unknown }[] = []
		const walletClient = createWalletClient({
			account: OWNER_ADDRESS,
			chain: mainnet,
			transport: custom(
				createProvider(({ method, params }) => {
					if (method === 'eth_call') {
						const transaction = getArrayEntry(params, 0, 'wallet simulate params')
						expect(getObjectEntry(transaction, 'from', 'wallet simulate transaction')).toBe(getAddress(OWNER_ADDRESS))
						return encodeAbiParameters([{ type: 'uint256' }], [3n])
					}
					if (method === 'eth_estimateGas') {
						const transaction = getArrayEntry(params, 0, 'wallet estimate params')
						expect(getObjectEntry(transaction, 'from', 'wallet estimate transaction')).toBe(getAddress(OWNER_ADDRESS))
						return '0x5208'
					}
					throw new Error(`Unexpected rpc method: ${method}`)
				}, calls),
			),
		})

		expect(
			(
				await walletClient.simulateContract({
					abi: OWNER_CHECK_ABI,
					address: TOKEN_ADDRESS,
					args: [RECIPIENT_ADDRESS],
					functionName: 'ownerCheck',
				})
			).result,
		).toBe(3n)
		expect(
			await walletClient.estimateContractGas({
				abi: OWNER_CHECK_ABI,
				address: TOKEN_ADDRESS,
				args: [RECIPIENT_ADDRESS],
				functionName: 'ownerCheck',
			}),
		).toBe(21_000n)
		expect(calls.map(call => call.method)).toEqual(['eth_call', 'eth_estimateGas'])
	})

	test('publicActions extension preserves wallet default account behavior', async () => {
		const calls: { method: string; params: unknown }[] = []
		const walletClient = createWalletClient({
			account: OWNER_ADDRESS,
			chain: mainnet,
			transport: custom(
				createProvider(({ method, params }) => {
					if (method === 'eth_call') {
						const transaction = getArrayEntry(params, 0, 'extended wallet simulate params')
						expect(getObjectEntry(transaction, 'from', 'extended wallet simulate transaction')).toBe(getAddress(OWNER_ADDRESS))
						return encodeAbiParameters([{ type: 'uint256' }], [4n])
					}
					if (method === 'eth_estimateGas') {
						const transaction = getArrayEntry(params, 0, 'extended wallet estimate params')
						expect(getObjectEntry(transaction, 'from', 'extended wallet estimate transaction')).toBe(getAddress(OWNER_ADDRESS))
						return '0x5208'
					}
					throw new Error(`Unexpected rpc method: ${method}`)
				}, calls),
			),
		}).extend(publicActions)

		expect(
			(
				await walletClient.simulateContract({
					abi: OWNER_CHECK_ABI,
					address: TOKEN_ADDRESS,
					args: [RECIPIENT_ADDRESS],
					functionName: 'ownerCheck',
				})
			).result,
		).toBe(4n)
		expect(
			await walletClient.estimateContractGas({
				abi: OWNER_CHECK_ABI,
				address: TOKEN_ADDRESS,
				args: [RECIPIENT_ADDRESS],
				functionName: 'ownerCheck',
			}),
		).toBe(21_000n)
		expect(calls.map(call => call.method)).toEqual(['eth_call', 'eth_estimateGas'])
	})
})
