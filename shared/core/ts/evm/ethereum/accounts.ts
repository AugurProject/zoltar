import { concatBytes, hexToBytes as nobleHexToBytes } from '@noble/hashes/utils.js'

import { bigintToBytes, checksumAddressFromBytes, ensure0x, getAddress, hexToBytes, normalizeHexData, normalizeQuantityValue, stripHexPrefix } from './encoding.js'

import { type Account, type Address, type Hex, type ParsedTransaction } from './types.js'

import { Transaction as MicroTransaction, addr, eip191Signer } from 'micro-eth-signer'

import { keccak_256 } from '@noble/hashes/sha3.js'

function rlpEncodeBytes(value: Uint8Array): Uint8Array {
	if (value.length === 1 && value[0] !== undefined && value[0] < 0x80) return value
	if (value.length <= 55) return concatBytes(Uint8Array.of(0x80 + value.length), value)
	const lengthBytes = bigintToBytes(BigInt(value.length))
	return concatBytes(Uint8Array.of(0xb7 + lengthBytes.length), lengthBytes, value)
}

function rlpEncodeList(items: readonly Uint8Array[]) {
	const payload = concatBytes(...items)
	if (payload.length <= 55) return concatBytes(Uint8Array.of(0xc0 + payload.length), payload)
	const lengthBytes = bigintToBytes(BigInt(payload.length))
	return concatBytes(Uint8Array.of(0xf7 + lengthBytes.length), lengthBytes, payload)
}

export function parseTransaction(serializedTransaction: Hex) {
	const transaction = MicroTransaction.fromHex(serializedTransaction)
	return {
		chainId: 'chainId' in transaction.raw && typeof transaction.raw.chainId === 'bigint' ? transaction.raw.chainId : undefined,
		data: normalizeHexData(transaction.raw.data),
		gas: 'gasLimit' in transaction.raw ? transaction.raw.gasLimit : undefined,
		gasPrice: 'gasPrice' in transaction.raw && typeof transaction.raw.gasPrice === 'bigint' ? transaction.raw.gasPrice : undefined,
		maxFeePerGas: 'maxFeePerGas' in transaction.raw && typeof transaction.raw.maxFeePerGas === 'bigint' ? transaction.raw.maxFeePerGas : undefined,
		maxPriorityFeePerGas: 'maxPriorityFeePerGas' in transaction.raw && typeof transaction.raw.maxPriorityFeePerGas === 'bigint' ? transaction.raw.maxPriorityFeePerGas : undefined,
		nonce: 'nonce' in transaction.raw ? transaction.raw.nonce : undefined,
		to: transaction.raw.to === '0x' ? undefined : getAddress(transaction.raw.to),
		type: transaction.type,
		value: 'value' in transaction.raw ? transaction.raw.value : undefined,
	} satisfies ParsedTransaction
}

export async function recoverTransactionAddress(parameters: { serializedTransaction: Hex }) {
	return getAddress(MicroTransaction.fromHex(parameters.serializedTransaction).sender)
}

export function privateKeyToAccount(privateKey: Hex) {
	return {
		address: getAddress(addr.fromPrivateKey(privateKey)),
		signMessage: async message => ensure0x(eip191Signer.sign(message, privateKey)),
		signTransaction: async parameters => {
			if (parameters.gasPrice !== undefined && (parameters.maxFeePerGas !== undefined || parameters.maxPriorityFeePerGas !== undefined)) {
				throw new Error('Transaction fee fields must use either gasPrice or EIP-1559 fee caps, not both.')
			}
			if (parameters.chainId === undefined || parameters.gas === undefined || parameters.nonce === undefined) {
				throw new Error('Local transaction signing requires chainId, gas, and nonce to be prepared')
			}
			if (parameters.gasPrice === undefined && (parameters.maxFeePerGas === undefined || parameters.maxPriorityFeePerGas === undefined)) {
				throw new Error('Local EIP-1559 transaction signing requires maxFeePerGas and maxPriorityFeePerGas to be prepared')
			}
			const type = parameters.gasPrice !== undefined ? 'legacy' : 'eip1559'
			const transaction = MicroTransaction.prepare({
				chainId: normalizeQuantityValue(parameters.chainId),
				data: parameters.data ?? '0x',
				gasLimit: normalizeQuantityValue(parameters.gas),
				...(type === 'legacy'
					? {
							gasPrice: parameters.gasPrice ?? 0n,
							type,
						}
					: {
							maxFeePerGas: parameters.maxFeePerGas ?? parameters.maxPriorityFeePerGas ?? 0n,
							maxPriorityFeePerGas: parameters.maxPriorityFeePerGas ?? 0n,
							type,
						}),
				nonce: normalizeQuantityValue(parameters.nonce),
				to: parameters.to ?? '0x',
				value: parameters.value ?? 0n,
			})
			return transaction.signBy(privateKey).toHex() as Hex
		},
		type: 'local',
	} satisfies Account
}

export function getCreateAddress(parameters: { from: Address; nonce: bigint }) {
	const fromBytes = nobleHexToBytes(stripHexPrefix(parameters.from))
	const nonceBytes = parameters.nonce === 0n ? new Uint8Array([]) : bigintToBytes(parameters.nonce)
	const encoded = rlpEncodeList([rlpEncodeBytes(fromBytes), rlpEncodeBytes(nonceBytes)])
	return checksumAddressFromBytes(keccak_256(encoded).slice(-20))
}

export function getCreate2Address(parameters: { bytecode?: Hex | undefined; bytecodeHash?: Hex | undefined; from: Address; salt: Hex | Uint8Array }) {
	const fromBytes = nobleHexToBytes(stripHexPrefix(parameters.from))
	const saltBytes = parameters.salt instanceof Uint8Array ? parameters.salt : hexToBytes(parameters.salt)
	if (saltBytes.length !== 32) throw new Error('CREATE2 salt must be 32 bytes')
	const bytecodeHashBytes = (() => {
		if (parameters.bytecodeHash !== undefined) return hexToBytes(parameters.bytecodeHash)
		if (parameters.bytecode === undefined) return undefined
		return keccak_256(hexToBytes(parameters.bytecode))
	})()
	if (bytecodeHashBytes === undefined) throw new Error('CREATE2 address derivation requires bytecode or bytecodeHash')
	const encoded = concatBytes(Uint8Array.of(0xff), fromBytes, saltBytes, bytecodeHashBytes)
	return checksumAddressFromBytes(keccak_256(encoded).slice(-20))
}
