import * as funtypes from 'funtypes'
import { isHexEncodedNumber } from '../utils/bigint'

const BigIntParser: funtypes.ParsedValue<funtypes.String, bigint>['config'] = {
	parse: value => {
		if (!/^0x([a-fA-F0-9]{1,64})$/.test(value)) return { success: false, message: `${ value } is not a hex string encoded number.` }
		return { success: true, value: BigInt(value) }
	},
	serialize: value => {
		if (typeof value !== 'bigint') return { success: false, message: `${ typeof value } is not a bigint.` }
		if (value < 0n) return { success: false, message: `${ value } must be non-negative.` }
		return { success: true, value: `0x${ value.toString(16) }` }
	},
}

const SmallIntParser: funtypes.ParsedValue<funtypes.String, bigint>['config'] = {
	parse: value => {
		if (!/^0x([a-fA-F0-9]{1,64})$/.test(value)) return { success: false, message: `${ value } is not a hex string encoded number.` }
		if (BigInt(value) >= 2n ** 64n) return { success: false, message: `${ value } must be smaller than 2^64.` }
		return { success: true, value: BigInt(value) }
	},
	serialize: value => {
		if (typeof value !== 'bigint') return { success: false, message: `${ typeof value } is not a bigint.` }
		if (value >= 2n ** 64n) return { success: false, message: `${ value } must be smaller than 2^64.` }
		return { success: true, value: `0x${ value.toString(16) }` }
	},
}

const AddressParser: funtypes.ParsedValue<funtypes.String, bigint>['config'] = {
	parse: value => {
		if (!/^0x([a-fA-F0-9]{40})$/.test(value)) return { success: false, message: `${ value } is not a hex string encoded address.` }
		return { success: true, value: BigInt(value) }
	},
	serialize: value => {
		if (typeof value !== 'bigint') return { success: false, message: `${ typeof value } is not a bigint.` }
		if (value < 0n) return { success: false, message: `${ value } must be non-negative.` }
		if (value >= 2n ** 160n) return { success: false, message: `${ value } is too large for a 20-byte address.` }
		return { success: true, value: `0x${ value.toString(16).padStart(40, '0') }` }
	},
}

const Bytes32Parser: funtypes.ParsedValue<funtypes.String, bigint>['config'] = {
	parse: value => {
		if (!/^0x([a-fA-F0-9]{64})$/.test(value)) return { success: false, message: `${ value } is not a hex string encoded 32 byte value.` }
		return { success: true, value: BigInt(value) }
	},
	serialize: value => {
		if (typeof value !== 'bigint') return { success: false, message: `${ typeof value } is not a bigint.` }
		if (value < 0n) return { success: false, message: `${ value } must be non-negative.` }
		if (value >= 2n ** 256n) return { success: false, message: `${ value } is too large for a 32-byte value.` }
		return { success: true, value: `0x${ value.toString(16).padStart(64, '0') }` }
	},
}

const Bytes256Parser: funtypes.ParsedValue<funtypes.String, bigint>['config'] = {
	parse: value => {
		if (!/^0x([a-fA-F0-9]{512})$/.test(value)) return { success: false, message: `${ value } is not a hex string encoded 256 byte value.` }
		return { success: true, value: BigInt(value) }
	},
	serialize: value => {
		if (typeof value !== 'bigint') return { success: false, message: `${ typeof value } is not a bigint.` }
		if (value < 0n) return { success: false, message: `${ value } must be non-negative.` }
		if (value >= 2n ** 2048n) return { success: false, message: `${ value } is too large for a 256-byte value.` }
		return { success: true, value: `0x${ value.toString(16).padStart(512, '0') }` }
	},
}
const Bytes16Parser: funtypes.ParsedValue<funtypes.String, bigint>['config'] = {
	parse: value => {
		if (!/^0x([a-fA-F0-9]{16})$/.test(value)) return { success: false, message: `${ value } is not a hex string encoded 8 byte value.` }
		return { success: true, value: BigInt(value) }
	},
	serialize: value => {
		if (typeof value !== 'bigint') return { success: false, message: `${ typeof value } is not a bigint.` }
		if (value < 0n) return { success: false, message: `${ value } must be non-negative.` }
		if (value >= 2n ** 128n) return { success: false, message: `${ value } is too large for a 16-byte value.` }
		return { success: true, value: `0x${ value.toString(16).padStart(16, '0') }` }
	},
}

const BytesParser: funtypes.ParsedValue<funtypes.String, Uint8Array>['config'] = {
	parse: value => {
		const match = /^(?:0x)?([a-fA-F0-9]*)$/.exec(value)
		if (match === null) return { success: false, message: `Expected a hex string encoded byte array with an optional '0x' prefix but received ${ value }` }
		const normalized = match[1]
		if (normalized === undefined) return { success: false, message: `Expected a hex string encoded byte array with an optional '0x' prefix but received ${ value }` }
		if (normalized.length % 2) return { success: false, message: 'Hex string encoded byte array must be an even number of characters long.' }
		const bytes = new Uint8Array(normalized.length / 2)
		for (let i = 0; i < normalized.length; i += 2) {
			bytes[i / 2] = Number.parseInt(`${ normalized[i] }${ normalized[i + 1] }`, 16)
		}
		return { success: true, value: new Uint8Array(bytes) }
	},
	serialize: value => {
		if (!(value instanceof Uint8Array)) return { success: false, message: `${ typeof value } is not a Uint8Array.` }
		let result = ''
		for (let i = 0; i < value.length; ++i) {
			const val = value[i]
			if (val === undefined) return { success: false, message: `${ typeof value } is not a Uint8Array.` }
			result += ('0' + val.toString(16)).slice(-2)
		}
		return { success: true, value: `0x${ result }` }
	},
}

const TimestampParser: funtypes.ParsedValue<funtypes.String, Date>['config'] = {
	parse: value => {
		if (!/^0x([a-fA-F0-9]{0,8})$/.test(value)) return { success: false, message: `${ value } is not a hex string encoded timestamp.` }
		const seconds = BigInt(value)
		if (seconds < 0n || seconds > 0xffffffffn) return { success: false, message: `${ value } is out of 32-bit unsigned timestamp range.` }
		return { success: true, value: new Date(Number.parseInt(value, 16) * 1000) }
	},
	serialize: value => {
		if (!(value instanceof Date)) return { success: false, message: `${ typeof value } is not a Date.` }
		const seconds = Math.floor(value.valueOf() / 1000)
		if (seconds < 0 || seconds > 0xffffffff) return { success: false, message: `Timestamp ${ value } is out of 32-bit unsigned range.` }
		return { success: true, value: `0x${ seconds.toString(16) }` }
	},
}

const OptionalBytesParser: funtypes.ParsedValue<funtypes.Union<[funtypes.String, funtypes.Literal<undefined>]>, Uint8Array>['config'] = {
	parse: value => BytesParser.parse(value || '0x'),
	serialize: value => {
		const ser = BytesParser.serialize
		if (ser === undefined) throw new Error('BytesParser.serialize is undefined')
		return ser(value || new Uint8Array())
	},
}

const LiteralConverterParserFactory: <TInput, TOutput>(input: TInput, output: TOutput) => funtypes.ParsedValue<funtypes.Runtype<TInput>, TOutput>['config'] = (input, output) => ({
	parse: value => (value === input ? { success: true, value: output } : { success: false, message: `${ value } was expected to be literal.` }),
	serialize: value => (value === output ? { success: true, value: input } : { success: false, message: `${ value } was expected to be literal.` }),
})

//
// Ethereum
//

const EthereumQuantity = funtypes.String.withParser(BigIntParser)
export type EthereumQuantity = funtypes.Static<typeof EthereumQuantity>

const EthereumQuantitySmall = funtypes.String.withParser(SmallIntParser)
export type EthereumQuantitySmall = funtypes.Static<typeof EthereumQuantitySmall>

const EthereumData = funtypes.String.withParser(BytesParser)
export type EthereumData = funtypes.Static<typeof EthereumData>

const EthereumAddress = funtypes.String.withParser(AddressParser)
type EthereumAddress = funtypes.Static<typeof EthereumAddress>

export const EthereumBytes32 = funtypes.String.withParser(Bytes32Parser)
export type EthereumBytes32 = funtypes.Static<typeof EthereumBytes32>

const EthereumBytes256 = funtypes.String.withParser(Bytes256Parser)
type EthereumBytes256 = funtypes.Static<typeof EthereumBytes256>

const EthereumBytes16 = funtypes.String.withParser(Bytes16Parser)
type EthereumBytes16 = funtypes.Static<typeof EthereumBytes16>

const EthereumTimestamp = funtypes.String.withParser(TimestampParser)
type EthereumTimestamp = funtypes.Static<typeof EthereumTimestamp>

const EthereumInput = funtypes.Union(funtypes.String, funtypes.Undefined).withParser(OptionalBytesParser)
type EthereumInput = funtypes.Static<typeof EthereumInput>

const EthereumAccessList = funtypes.ReadonlyArray(
	funtypes
		.ReadonlyObject({
			address: EthereumAddress,
			storageKeys: funtypes.ReadonlyArray(EthereumBytes32),
		})
		.asReadonly(),
)
type EthereumAccessList = funtypes.Static<typeof EthereumAccessList>

type EthereumUnsignedTransactionLegacy = funtypes.Static<typeof EthereumUnsignedTransactionLegacy>
const EthereumUnsignedTransactionLegacy = funtypes.Intersect(
	funtypes
		.ReadonlyObject({
			type: funtypes.Union(funtypes.Literal('0x0').withParser(LiteralConverterParserFactory('0x0', 'legacy' as const)), funtypes.Literal(undefined).withParser(LiteralConverterParserFactory(undefined, 'legacy' as const))),
			from: EthereumAddress,
			nonce: EthereumQuantity,
			gasPrice: EthereumQuantity,
			gas: EthereumQuantity,
			to: funtypes.Union(EthereumAddress, funtypes.Null),
			value: EthereumQuantity,
			input: EthereumInput,
		})
		.asReadonly(),
	funtypes
		.Partial({
			chainId: EthereumQuantity,
		})
		.asReadonly(),
)

type EthereumUnsignedTransaction2930 = funtypes.Static<typeof EthereumUnsignedTransaction2930>
const EthereumUnsignedTransaction2930 = funtypes.Intersect(
	funtypes
		.ReadonlyObject({
			type: funtypes.Literal('0x1').withParser(LiteralConverterParserFactory('0x1', '2930' as const)),
			from: EthereumAddress,
			nonce: EthereumQuantity,
			gasPrice: EthereumQuantity,
			gas: EthereumQuantity,
			to: funtypes.Union(EthereumAddress, funtypes.Null),
			value: EthereumQuantity,
			input: EthereumInput,
			chainId: EthereumQuantity,
		})
		.asReadonly(),
	funtypes
		.Partial({
			accessList: EthereumAccessList,
		})
		.asReadonly(),
)

type EthereumUnsignedTransaction1559 = funtypes.Static<typeof EthereumUnsignedTransaction1559>
const EthereumUnsignedTransaction1559 = funtypes.Intersect(
	funtypes
		.ReadonlyObject({
			type: funtypes.Literal('0x2').withParser(LiteralConverterParserFactory('0x2', '1559' as const)),
			from: EthereumAddress,
			nonce: EthereumQuantity,
			maxFeePerGas: EthereumQuantity,
			maxPriorityFeePerGas: EthereumQuantity,
			gas: EthereumQuantity,
			to: funtypes.Union(EthereumAddress, funtypes.Null),
			value: EthereumQuantity,
			input: EthereumInput,
			chainId: EthereumQuantity,
		})
		.asReadonly(),
	funtypes
		.Partial({
			accessList: EthereumAccessList,
		})
		.asReadonly(),
)

type EthereumUnsignedTransaction4844 = funtypes.Static<typeof EthereumUnsignedTransaction4844>
const EthereumUnsignedTransaction4844 = funtypes.Intersect(
	funtypes
		.ReadonlyObject({
			type: funtypes.Literal('0x3').withParser(LiteralConverterParserFactory('0x3', '4844' as const)),
			from: EthereumAddress,
			nonce: EthereumQuantity,
			maxFeePerGas: EthereumQuantity,
			maxPriorityFeePerGas: EthereumQuantity,
			gas: EthereumQuantity,
			to: funtypes.Union(EthereumAddress, funtypes.Null),
			value: EthereumQuantity,
			input: EthereumInput,
			chainId: EthereumQuantity,
			maxFeePerBlobGas: EthereumQuantity,
			blobVersionedHashes: funtypes.ReadonlyArray(EthereumBytes32),
		})
		.asReadonly(),
	funtypes
		.Partial({
			accessList: EthereumAccessList,
		})
		.asReadonly(),
)

const EthereumTransaction2930And1559And4844Signature = funtypes.Intersect(
	funtypes.ReadonlyObject({
		r: EthereumQuantity,
		s: EthereumQuantity,
		hash: EthereumBytes32,
	}),
	funtypes.Union(funtypes.ReadonlyObject({ yParity: funtypes.Union(funtypes.Literal('0x0').withParser(LiteralConverterParserFactory('0x0', 'even' as const)), funtypes.Literal('0x1').withParser(LiteralConverterParserFactory('0x1', 'odd' as const))) }), funtypes.ReadonlyObject({ v: EthereumQuantity })),
)

type MessageSignature = funtypes.Static<typeof MessageSignature>
const MessageSignature = funtypes.ReadonlyObject({
	r: EthereumQuantity,
	s: EthereumQuantity,
	hash: EthereumBytes32,
	v: EthereumQuantity,
})

type EthereumTransactionLegacySignature = funtypes.Static<typeof EthereumTransactionLegacySignature>
const EthereumTransactionLegacySignature = MessageSignature

type EthereumSignedTransactionOptimismDeposit = funtypes.Static<typeof EthereumSignedTransactionOptimismDeposit>
const EthereumSignedTransactionOptimismDeposit = funtypes.ReadonlyObject({
	type: funtypes.Literal('0x7e').withParser(LiteralConverterParserFactory('0x7e', 'optimismDeposit' as const)),
	sourceHash: EthereumBytes32,
	from: EthereumAddress,
	to: funtypes.Union(EthereumAddress, funtypes.Null),
	mint: funtypes.Union(EthereumQuantity, funtypes.Null, funtypes.Undefined),
	value: EthereumQuantity,
	gas: EthereumQuantity,
	data: EthereumInput,
	hash: EthereumBytes32,
	gasPrice: EthereumQuantity,
	nonce: EthereumQuantity,
})

type EthereumSignedTransactionLegacy = funtypes.Static<typeof EthereumSignedTransactionLegacy>
const EthereumSignedTransactionLegacy = funtypes.Intersect(EthereumUnsignedTransactionLegacy, EthereumTransactionLegacySignature)

type EthereumSignedTransaction2930 = funtypes.Static<typeof EthereumSignedTransaction2930>
const EthereumSignedTransaction2930 = funtypes.Intersect(EthereumUnsignedTransaction2930, EthereumTransaction2930And1559And4844Signature)

type EthereumSignedTransaction7702 = funtypes.Static<typeof EthereumSignedTransaction7702>
const EthereumSignedTransaction7702 = funtypes.Intersect(
	funtypes
		.ReadonlyObject({
			type: funtypes.Literal('0x4').withParser(LiteralConverterParserFactory('0x4', '7702' as const)),
			from: EthereumAddress,
			nonce: EthereumQuantity,
			maxFeePerGas: EthereumQuantity,
			maxPriorityFeePerGas: EthereumQuantity,
			gas: EthereumQuantity,
			to: funtypes.Union(EthereumAddress, funtypes.Null),
			value: EthereumQuantity,
			input: EthereumInput,
			chainId: EthereumQuantity,
			authorizationList: funtypes.ReadonlyArray(
				funtypes.ReadonlyObject({
					chainId: EthereumQuantity,
					address: EthereumAddress,
					nonce: EthereumQuantity,
				}),
			),
		})
		.asReadonly(),
	funtypes
		.Partial({
			accessList: EthereumAccessList,
		})
		.asReadonly(),
	EthereumTransaction2930And1559And4844Signature,
)

type EthereumSignedTransaction1559 = funtypes.Static<typeof EthereumSignedTransaction1559>
const EthereumSignedTransaction1559 = funtypes.Intersect(EthereumUnsignedTransaction1559, EthereumTransaction2930And1559And4844Signature)

type EthereumSignedTransaction4844 = funtypes.Static<typeof EthereumSignedTransaction4844>
const EthereumSignedTransaction4844 = funtypes.Intersect(EthereumUnsignedTransaction4844, EthereumTransaction2930And1559And4844Signature)

type EthereumSendableSignedTransaction = funtypes.Static<typeof EthereumSendableSignedTransaction>
const EthereumSendableSignedTransaction = funtypes.Union(EthereumSignedTransactionLegacy, EthereumSignedTransaction2930, EthereumSignedTransaction1559, EthereumSignedTransaction4844, EthereumSignedTransaction7702)

type EthereumSignedTransaction = funtypes.Static<typeof EthereumSignedTransaction>
const EthereumSignedTransaction = funtypes.Union(EthereumSendableSignedTransaction, EthereumSignedTransactionOptimismDeposit)

type EthereumWithdrawal = funtypes.Static<typeof EthereumWithdrawal>
const EthereumWithdrawal = funtypes.ReadonlyObject({
	index: EthereumQuantity,
	validatorIndex: EthereumQuantity,
	address: EthereumAddress,
	amount: EthereumQuantity,
})

type EthereumBlockHeaderWithoutTransactions = funtypes.Static<typeof EthereumBlockHeaderWithoutTransactions>
const EthereumBlockHeaderWithoutTransactions = funtypes.Intersect(
	funtypes.ReadonlyPartial({
		author: EthereumAddress,
	}),
	funtypes.Intersect(
		funtypes.ReadonlyObject({
			difficulty: EthereumQuantity,
			extraData: EthereumData,
			gasLimit: EthereumQuantity,
			gasUsed: EthereumQuantity,
			hash: EthereumBytes32,
			logsBloom: EthereumBytes256,
			miner: EthereumAddress,
			mixHash: EthereumBytes32,
			nonce: EthereumBytes16,
			number: EthereumQuantity,
			parentHash: EthereumBytes32,
			receiptsRoot: EthereumBytes32,
			sha3Uncles: EthereumBytes32,
			stateRoot: EthereumBytes32,
			timestamp: EthereumTimestamp,
			size: EthereumQuantity,
			uncles: funtypes.ReadonlyArray(EthereumBytes32),
			baseFeePerGas: funtypes.Union(EthereumQuantity, funtypes.Undefined),
			transactionsRoot: EthereumBytes32,
		}),
		funtypes.ReadonlyPartial({
			excessBlobGas: EthereumQuantity,
			blobGasUsed: EthereumQuantity,
			parentBeaconBlockRoot: EthereumBytes32,
			withdrawalsRoot: EthereumBytes32, // missing from old block
			withdrawals: funtypes.ReadonlyArray(EthereumWithdrawal), // missing from old block
			totalDifficulty: EthereumQuantity, // missing from new blocks
		}),
	),
)

export type EthereumBlockHeaderWithTransactionHashes = funtypes.Static<typeof EthereumBlockHeaderWithTransactionHashes>
export const EthereumBlockHeaderWithTransactionHashes = funtypes.Union(funtypes.Null, funtypes.Intersect(EthereumBlockHeaderWithoutTransactions, funtypes.ReadonlyObject({ transactions: funtypes.ReadonlyArray(EthereumBytes32) })))

type EthereumUnknownTransactionType = funtypes.Static<typeof EthereumUnknownTransactionType>
const EthereumUnknownTransactionType = funtypes.ReadonlyObject({
	hash: EthereumBytes32,
	type: funtypes.String.withConstraint(txType => {
		if (!isHexEncodedNumber(txType)) return false
		const alreadyHandled = ['0x0', '0x1', '0x2', '0x3', '0x4', '0x7e']
		if (alreadyHandled.includes(txType)) return false
		return true
	}),
})

type EthereumBlockHeaderTransaction = funtypes.Static<typeof EthereumBlockHeaderTransaction>
const EthereumBlockHeaderTransaction = funtypes.Union(EthereumSignedTransaction, EthereumUnknownTransactionType)

export type EthereumBlockHeader = funtypes.Static<typeof EthereumBlockHeader>
export const EthereumBlockHeader = funtypes.Union(funtypes.Null, funtypes.Intersect(EthereumBlockHeaderWithoutTransactions, funtypes.ReadonlyObject({ transactions: funtypes.ReadonlyArray(EthereumBlockHeaderTransaction) })))
