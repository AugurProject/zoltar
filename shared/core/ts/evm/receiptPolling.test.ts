import { describe, expect, test } from 'bun:test'
import { createPublicClient, custom, getAddress, mainnet, type BlockTransaction, type Hash } from '@zoltar/core-shared/evm/ethereum'
import { OWNER_ADDRESS, RECIPIENT_ADDRESS, RECEIPT_HASH, BLOCK_HASH, TX_HASH, getArrayEntry, createProvider } from '../../tests/ethereumFixtures'

describe('shared ethereum compatibility layer', () => {
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
			blockHash: BLOCK_HASH,
			blockNumber: '0x0',
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
				expect(typeof getArrayEntry(params, 1, 'replacement block params')).toBe('boolean')
				return {
					hash: BLOCK_HASH,
					number: '0x0',
					parentHash: `0x${'44'.repeat(32)}`,
					timestamp: '0x5',
					transactions: getArrayEntry(params, 1, 'block params') === true ? [replacementTransaction] : [replacementHash],
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
		expect(calls.map(call => call.method)).toEqual(['eth_getTransactionByHash', 'eth_getTransactionReceipt', 'eth_blockNumber', 'eth_getBlockByNumber', 'eth_getBlockByNumber', 'eth_getTransactionReceipt'])
	})

	test('waitForTransactionReceipt uses a supplied transaction when its hash is no longer available', async () => {
		const originalHash = `0x${'77'.repeat(32)}` satisfies Hash
		const replacementHash = `0x${'78'.repeat(32)}` satisfies Hash
		const replacements: Hash[] = []
		const calls: { method: string; params: unknown }[] = []
		const originalTransaction = {
			from: getAddress(OWNER_ADDRESS),
			gas: 21_000n,
			hash: originalHash,
			input: '0x1234',
			nonce: 7n,
			to: getAddress(RECIPIENT_ADDRESS),
			type: '0x2',
			value: 5n,
		} satisfies BlockTransaction
		const provider = createProvider(({ method, params }) => {
			if (method === 'eth_getTransactionByHash') return null
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
					transactions:
						getArrayEntry(params, 1, 'block params') === true
							? [
									{
										blockHash: BLOCK_HASH,
										blockNumber: '0x0',
										from: OWNER_ADDRESS,
										gas: '0x5208',
										hash: replacementHash,
										input: '0x1234',
										nonce: '0x7',
										to: RECIPIENT_ADDRESS,
										transactionIndex: '0x0',
										type: '0x2',
										value: '0x5',
									},
								]
							: [replacementHash],
				}
			}
			throw new Error(`Unexpected rpc method: ${method}`)
		}, calls)
		const client = createPublicClient({ chain: mainnet, transport: custom(provider) })

		const receipt = await client.waitForTransactionReceipt({
			hash: originalHash,
			onReplaced: replacement => replacements.push(replacement.transaction.hash),
			pollingInterval: 0,
			transaction: originalTransaction,
			timeout: 20,
		})

		expect(receipt.transactionHash).toBe(replacementHash)
		expect(replacements).toEqual([replacementHash])
		expect(calls.map(call => call.method)).toEqual(['eth_getTransactionReceipt', 'eth_blockNumber', 'eth_getBlockByNumber', 'eth_getBlockByNumber', 'eth_getTransactionReceipt'])
	})

	test('replacement scans reject blocks from a different height', async () => {
		const replacementHash = `0x${'55'.repeat(32)}` satisfies Hash
		const originalTransaction = {
			from: getAddress(OWNER_ADDRESS),
			gas: 21_000n,
			hash: TX_HASH,
			input: '0x1234',
			nonce: 7n,
			to: getAddress(RECIPIENT_ADDRESS),
			value: 5n,
		} satisfies BlockTransaction
		const provider = createProvider(({ method, params }) => {
			if (method === 'eth_getTransactionReceipt') {
				if (getArrayEntry(params, 0, 'receipt params') === TX_HASH) return null
				return {
					blockHash: BLOCK_HASH,
					blockNumber: '0x1',
					cumulativeGasUsed: '0x5208',
					from: OWNER_ADDRESS,
					gasUsed: '0x5208',
					logs: [],
					status: '0x1',
					to: RECIPIENT_ADDRESS,
					transactionHash: replacementHash,
					transactionIndex: '0x0',
				}
			}
			if (method === 'eth_blockNumber') return '0x0'
			if (method === 'eth_getBlockByNumber') {
				return {
					hash: BLOCK_HASH,
					number: '0x1',
					parentHash: `0x${'44'.repeat(32)}`,
					timestamp: '0x5',
					transactions: [{ ...originalTransaction, blockHash: BLOCK_HASH, blockNumber: '0x1', hash: replacementHash, transactionIndex: '0x0' }],
				}
			}
			throw new Error(`Unexpected rpc method: ${method}`)
		}, [])
		const client = createPublicClient({ chain: mainnet, transport: custom(provider) })

		await expect(
			client.waitForTransactionReceipt({
				hash: TX_HASH,
				onReplaced: () => undefined,
				pollingInterval: 0,
				transaction: originalTransaction,
				timeout: 0,
			}),
		).rejects.toThrow('does not match requested block 0')
	})

	test('replacement scans reject missing block transactions instead of advancing past them', async () => {
		const originalTransaction = {
			from: getAddress(OWNER_ADDRESS),
			gas: 21_000n,
			hash: TX_HASH,
			input: '0x1234',
			nonce: 7n,
			to: getAddress(RECIPIENT_ADDRESS),
			value: 5n,
		} satisfies BlockTransaction
		const calls: { method: string; params: unknown }[] = []
		const provider = createProvider(({ method }) => {
			if (method === 'eth_getTransactionReceipt') return null
			if (method === 'eth_blockNumber') return '0x0'
			if (method === 'eth_getBlockByNumber') {
				return {
					hash: BLOCK_HASH,
					number: '0x0',
					parentHash: `0x${'44'.repeat(32)}`,
					timestamp: '0x5',
				}
			}
			throw new Error(`Unexpected rpc method: ${method}`)
		}, calls)
		const client = createPublicClient({ chain: mainnet, transport: custom(provider) })

		await expect(
			client.waitForTransactionReceipt({
				hash: TX_HASH,
				onReplaced: () => undefined,
				pollingInterval: 0,
				transaction: originalTransaction,
				timeout: 0,
			}),
		).rejects.toThrow('without transactions')
		expect(calls.map(call => call.method)).toEqual(['eth_getTransactionReceipt', 'eth_blockNumber', 'eth_getBlockByNumber'])
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

	test('waitForTransactionReceipt enforces its deadline while a request or polling delay is pending', async () => {
		const settleBeforeWatchdog = async (operation: Promise<unknown>) => {
			let watchdog: ReturnType<typeof setTimeout> | undefined
			try {
				return await Promise.race([
					operation.then(
						() => new Error('Receipt wait unexpectedly resolved'),
						error => (error instanceof Error ? error : new Error(String(error))),
					),
					new Promise<Error>(resolve => {
						watchdog = setTimeout(() => resolve(new Error('Receipt wait exceeded its watchdog')), 100)
					}),
				])
			} finally {
				if (watchdog !== undefined) clearTimeout(watchdog)
			}
		}
		const hungClient = createPublicClient({
			chain: mainnet,
			transport: custom(
				createProvider(
					async () =>
						await new Promise(() => {
							// Deliberately never settles.
						}),
					[],
				),
			),
		})

		const hungRequestError = await settleBeforeWatchdog(hungClient.waitForTransactionReceipt({ hash: RECEIPT_HASH, timeout: 5 }))
		expect(hungRequestError.message).toBe(`Timed out while waiting for transaction receipt "${RECEIPT_HASH}".`)

		const pollingClient = createPublicClient({
			chain: mainnet,
			transport: custom(createProvider(() => null, [])),
		})
		const pollingError = await settleBeforeWatchdog(pollingClient.waitForTransactionReceipt({ hash: RECEIPT_HASH, pollingInterval: 1_000, timeout: 5 }))
		expect(pollingError.message).toBe(`Transaction receipt with hash "${RECEIPT_HASH}" could not be found.`)
	})

	test('waitForTransactionReceipt retries rate-limited receipt requests', async () => {
		let receiptRequests = 0
		const calls: { method: string; params: unknown }[] = []
		const provider = createProvider(({ method }) => {
			if (method !== 'eth_getTransactionReceipt') throw new Error(`Unexpected rpc method: ${method}`)
			receiptRequests += 1
			if (receiptRequests === 1) throw { code: 429, message: 'HTTP 429 while calling eth_getTransactionReceipt' }
			return {
				blockHash: BLOCK_HASH,
				blockNumber: '0x1',
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
		}, calls)
		const client = createPublicClient({
			chain: mainnet,
			transport: custom(provider, { retryCount: 0, retryDelay: 0 }),
		})

		const receipt = await client.waitForTransactionReceipt({
			hash: RECEIPT_HASH,
			pollingInterval: 0,
			timeout: 50,
		})

		expect(receipt.transactionHash).toBe(RECEIPT_HASH)
		expect(calls.map(call => call.method)).toEqual(['eth_getTransactionReceipt', 'eth_getTransactionReceipt'])
	})

	test('waitForTransactionReceipt does not retry a rate-limited request after its deadline', async () => {
		let receiptRequests = 0
		const clockValues = [0, 0, 1]
		const originalDateNow = Date.now
		const provider = createProvider(({ method }) => {
			if (method !== 'eth_getTransactionReceipt') throw new Error(`Unexpected rpc method: ${method}`)
			receiptRequests += 1
			if (receiptRequests === 1) throw { code: 429, message: 'rate limit exceeded' }
			throw new Error('Receipt request ran after the deadline')
		}, [])
		const client = createPublicClient({ chain: mainnet, transport: custom(provider, { retryCount: 0, retryDelay: 0 }) })

		Date.now = () => clockValues.shift() ?? 1
		try {
			await expect(client.waitForTransactionReceipt({ hash: RECEIPT_HASH, pollingInterval: 2, timeout: 1 })).rejects.toThrow('rate limit exceeded')
		} finally {
			Date.now = originalDateNow
		}

		expect(receiptRequests).toBe(1)
	})

	test('waitForTransactionReceipt preserves replacement scan rate limits at its deadline', async () => {
		const originalTransaction = {
			from: getAddress(OWNER_ADDRESS),
			gas: 21_000n,
			hash: RECEIPT_HASH,
			input: '0x',
			nonce: 7n,
			to: getAddress(RECIPIENT_ADDRESS),
			type: '0x2',
			value: 0n,
		} satisfies BlockTransaction
		const provider = createProvider(({ method }) => {
			if (method === 'eth_getTransactionReceipt') return null
			if (method === 'eth_blockNumber') throw { code: 429, message: 'replacement scan rate limit' }
			throw new Error(`Unexpected rpc method: ${method}`)
		}, [])
		const client = createPublicClient({ chain: mainnet, transport: custom(provider, { retryDelay: 50 }) })
		const originalDateNow = Date.now

		Date.now = () => 0
		try {
			await expect(client.waitForTransactionReceipt({ hash: RECEIPT_HASH, onReplaced: () => undefined, pollingInterval: 0, timeout: 5, transaction: originalTransaction })).rejects.toThrow('replacement scan rate limit')
		} finally {
			Date.now = originalDateNow
		}
	})

	test('waitForTransactionReceipt clears a stale rate limit when its retry request hangs', async () => {
		let receiptRequests = 0
		const provider = createProvider(({ method }) => {
			if (method !== 'eth_getTransactionReceipt') throw new Error(`Unexpected rpc method: ${method}`)
			receiptRequests += 1
			if (receiptRequests === 1) throw { code: 429, message: 'stale rate limit' }
			return new Promise(() => {
				// Deliberately never settles.
			})
		}, [])
		const client = createPublicClient({ chain: mainnet, transport: custom(provider, { retryDelay: 0 }) })

		await expect(client.waitForTransactionReceipt({ hash: RECEIPT_HASH, timeout: 50 })).rejects.toThrow(`Timed out while waiting for transaction receipt "${RECEIPT_HASH}".`)
		expect(receiptRequests).toBe(2)
	})

	test('waitForTransactionReceipt preserves replacement scan progress across rate limits', async () => {
		const originalHash = `0x${'77'.repeat(32)}` satisfies Hash
		const replacementHash = `0x${'88'.repeat(32)}` satisfies Hash
		const calls: { method: string; params: unknown }[] = []
		let secondBlockRequests = 0
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
			blockHash: BLOCK_HASH,
			blockNumber: '0x1',
			hash: replacementHash,
			transactionIndex: '0x0',
		}
		const provider = createProvider(({ method, params }) => {
			if (method === 'eth_getTransactionByHash') return originalTransaction
			if (method === 'eth_getTransactionReceipt') {
				const hash = getArrayEntry(params, 0, 'receipt params')
				if (hash === originalHash) return null
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
			if (method === 'eth_blockNumber') return '0x1'
			if (method === 'eth_getBlockByNumber') {
				const blockNumber = getArrayEntry(params, 0, 'replacement block params')
				if (blockNumber === '0x1') {
					secondBlockRequests += 1
					if (secondBlockRequests === 1) throw { code: 429, message: 'rate limit exceeded' }
				}
				const transactions = getArrayEntry(params, 1, 'block params') === true ? [replacementTransaction] : [replacementHash]
				return {
					hash: BLOCK_HASH,
					number: blockNumber,
					parentHash: BLOCK_HASH,
					timestamp: '0x5',
					transactions: blockNumber === '0x1' ? transactions : [],
				}
			}
			throw new Error(`Unexpected rpc method: ${method}`)
		}, calls)
		const client = createPublicClient({ chain: mainnet, transport: custom(provider, { retryCount: 0, retryDelay: 0 }) })

		const receipt = await client.waitForTransactionReceipt({ hash: originalHash, onReplaced: () => undefined, pollingInterval: 0, timeout: 50 })

		expect(receipt.transactionHash).toBe(replacementHash)
		expect(calls.filter(call => call.method === 'eth_getBlockByNumber').map(call => getArrayEntry(call.params, 0, 'block params'))).toEqual(['0x0', '0x1', '0x1', '0x1'])
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
			blockHash: BLOCK_HASH,
			blockNumber: '0x1',
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
				const transactions = getArrayEntry(params, 1, 'block params') === true ? [replacementTransaction] : [replacementHash]
				return {
					hash: BLOCK_HASH,
					number: blockNumber,
					parentHash: BLOCK_HASH,
					timestamp: '0x5',
					transactions: blockNumber === '0x1' ? transactions : [],
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
		expect(calls.filter(call => call.method === 'eth_getBlockByNumber').map(call => getArrayEntry(call.params, 0, 'block params'))).toEqual(['0x0', '0x1', '0x1'])
	})

	test('waitForTransactionReceipt bounds replacement reads without historical nonce access', async () => {
		const originalHash = `0x${'77'.repeat(32)}` satisfies Hash
		const calls: { method: string; params: unknown }[] = []
		const provider = createProvider(({ method, params }) => {
			if (method === 'eth_getTransactionByHash') return { from: OWNER_ADDRESS, gas: '0x5208', hash: originalHash, input: '0xabcd', nonce: '0x9', to: RECIPIENT_ADDRESS, transactionIndex: null, type: '0x2', value: '0x7' }
			if (method === 'eth_getTransactionReceipt') return null
			if (method === 'eth_blockNumber') return '0x100000'
			if (method === 'eth_getTransactionCount') throw new Error('Historical state unavailable')
			if (method === 'eth_getBlockByNumber') {
				const number = getArrayEntry(params, 0, 'block params')
				return { hash: BLOCK_HASH, number, parentHash: BLOCK_HASH, timestamp: '0x5', transactions: [] }
			}
			throw new Error(`Unexpected rpc method: ${method}`)
		}, calls)
		const client = createPublicClient({ chain: mainnet, transport: custom(provider) })
		await expect(client.waitForTransactionReceipt({ hash: originalHash, onReplaced: () => undefined, pollingInterval: 0, timeout: 0 })).rejects.toThrow()
		expect(calls.filter(call => call.method === 'eth_getTransactionCount')).toHaveLength(0)
		const blocks = calls.filter(call => call.method === 'eth_getBlockByNumber')
		expect(blocks.filter(call => getArrayEntry(call.params, 1, 'block params') === true).length).toBeLessThanOrEqual(13)
		expect(blocks.filter(call => getArrayEntry(call.params, 1, 'block params') === false)).toHaveLength(1)
		expect(blocks.every(call => BigInt(String(getArrayEntry(call.params, 0, 'block params'))) >= 0x100000n - 12n)).toBe(true)
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
			blockHash: BLOCK_HASH,
			blockNumber: '0x0',
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
					transactions: getArrayEntry(params, 1, 'block params') === true ? [replacementTransaction] : [replacementHash],
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
		expect(calls.map(call => call.method)).toEqual(['eth_getTransactionByHash', 'eth_getTransactionReceipt', 'eth_getTransactionByHash', 'eth_blockNumber', 'eth_getBlockByNumber', 'eth_getBlockByNumber', 'eth_getTransactionReceipt'])
	})
})
