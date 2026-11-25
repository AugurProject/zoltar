import type { EIP1193Provider, Hash } from '@zoltar/core-shared/evm/ethereum'

export const OWNER_ADDRESS = '0x00000000000000000000000000000000000000BB'

export const RECIPIENT_ADDRESS = '0x00000000000000000000000000000000000000CC'

export const RECEIPT_HASH = `0x${'11'.repeat(32)}` satisfies Hash

export const BLOCK_HASH = `0x${'22'.repeat(32)}` satisfies Hash

export const TX_HASH = `0x${'33'.repeat(32)}` satisfies Hash

export function getArrayEntry(value: unknown, index: number, context: string) {
	if (!Array.isArray(value)) throw new Error(`${context} must be an array`)
	return value[index]
}

export function createProvider(handler: (request: { method: string; params: unknown }) => Promise<unknown> | unknown, calls: { method: string; params: unknown }[]): EIP1193Provider {
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
