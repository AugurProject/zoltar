import { describe, expect, test } from 'bun:test'
import {
	type Address,
	concatHex,
	encodeAbiParameters,
	encodeEventTopics,
	encodeFunctionData,
	getAddress,
	type Hex,
	parseAbi,
	toHex,
	zeroAddress,
} from '../src/ethereum.ts'
import { abiForKind, decodeAction, decodeLogRecord, discoveriesFrom, referencedAddressesFrom, tokenAddressesFrom } from '../src/metadata.ts'
import { projectionsFrom } from '../src/projections.ts'
import type { StoredLog, TokenMetadata } from '../src/types.ts'

const account = getAddress('0x1111111111111111111111111111111111111111')
const childToken = getAddress('0x2222222222222222222222222222222222222222')
const requireTopics = (topics: readonly (Hex | readonly Hex[] | null)[]): readonly Hex[] =>
	topics.map((topic) => {
		if (typeof topic !== 'string') throw new Error('Expected one encoded topic per event input')
		return topic
	})

describe('ABI metadata', () => {
	test('includes the merged liquidation approval registry contract', () => {
		expect(abiForKind('liquidationApprovalRegistry')).toBeDefined()
	})

	test('formats semantic REP amounts exactly and labels addresses', () => {
		const abi = parseAbi(['event RepBurned(address indexed burner,uint248 indexed universeId,uint256 amountAttoRep,uint256 universeTheoreticalSupplyAttoRep)'])
		const topics = encodeEventTopics({ abi, eventName: 'RepBurned', args: { burner: account, universeId: 4n } })
		const data = encodeAbiParameters([{ type: 'uint256' }, { type: 'uint256' }], [4_250_750_000_000_000_000n, 10_000_000_000_000_000_000n])
		const decoded = decodeLogRecord('zoltar', requireTopics(topics), data, new Map([[account.toLowerCase(), 'Alice']]))

		expect(decoded.status).toBe('decoded')
		expect(decoded.name).toBe('RepBurned')
		expect(decoded.arguments?.['amountAttoRep']).toBe('4250750000000000000')
		expect(decoded.displayArguments?.['amountAttoRep']).toBe('4.25075 REP')
		expect(decoded.displayArguments?.['burner']).toContain('Alice')
		expect(decoded.argumentSchema?.slice(0, 3)).toMatchObject([
			{ index: 0, name: 'burner', indexed: true },
			{ index: 1, name: 'universeId', indexed: true },
			{ index: 2, name: 'amountAttoRep', type: 'uint256 amountAttoRep' },
		])
	})

	test('formats generic token transfer values using the emitter kind', () => {
		const abi = parseAbi(['event Transfer(address indexed from,address indexed to,uint256 value)'])
		const topics = encodeEventTopics({ abi, eventName: 'Transfer', args: { from: account, to: childToken } })
		const data = encodeAbiParameters([{ type: 'uint256' }], [1_500_000_000_000_000_000n])
		const decoded = decodeLogRecord('reputationToken', requireTopics(topics), data, new Map())

		expect(decoded.displayArguments?.['value']).toBe('1.5 REP')
	})

	test('formats native event and action values with the network currency symbol', () => {
		const eventAbi = parseAbi([
			'event CompleteSetCreated(address indexed creator,uint256 settlementCollateralProvidedAttoEth,uint256 completeSetsMintedAttoShares,uint256 resultingShareTokenSupplyAttoShares,uint256 resultingSettlementCollateralAttoEth)',
		])
		const topics = requireTopics(encodeEventTopics({ abi: eventAbi, eventName: 'CompleteSetCreated', args: { creator: account } }))
		const data = encodeAbiParameters(
			[{ type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }],
			[2_000_000_000_000_000_000n, 3_000_000_000_000_000_000n, 4_000_000_000_000_000_000n, 5_000_000_000_000_000_000n],
		)
		const context = { nativeSymbol: 'SepoliaETH' }
		const decodedEvent = decodeLogRecord('securityPool', topics, data, new Map(), new Map(), account, new Map(), context)
		expect(decodedEvent.displayArguments?.['settlementCollateralProvidedAttoEth']).toBe('2 SepoliaETH')

		const openOracleAbi = abiForKind('openOracle')
		if (openOracleAbi === undefined) throw new Error('OpenOracle ABI missing')
		const contract = { address: account as Address, label: 'OpenOracle', kind: 'openOracle', provenance: 'test' }
		const input = encodeFunctionData({ abi: openOracleAbi, functionName: 'deposit', args: [zeroAddress, 6_000_000_000_000_000_000n, childToken] })
		const decodedAction = decodeAction(contract, input, new Map(), new Map(), new Map(), context)
		expect(decodedAction.displayArguments?.['amount']).toBe('6 SepoliaETH')
	})

	test('enforces fixed WETH units over misleading metadata for transfer and approval logs', () => {
		const abi = abiForKind('weth')
		if (abi === undefined) throw new Error('WETH ABI missing')
		const misleading: TokenMetadata = { address: account, symbol: 'WRONG', decimals: 6, readBlock: 10n }
		for (const eventName of ['Transfer', 'Approval'] as const) {
			const topics = requireTopics(
				encodeEventTopics({ abi, eventName, args: eventName === 'Transfer' ? { src: account, dst: childToken } : { src: account, guy: childToken } }),
			)
			const data = encodeAbiParameters([{ type: 'uint256' }], [1_500_000_000_000_000_000n])
			const decoded = decodeLogRecord('weth', topics, data, new Map(), new Map([[account.toLowerCase(), misleading]]), account)
			expect(decoded.arguments?.['wad']).toBe('1500000000000000000')
			expect(decoded.displayArguments?.['wad']).toBe('1.5 WETH')
		}
	})

	test('formats ShareToken safe-transfer action values without changing raw evidence', () => {
		const abi = abiForKind('shareToken')
		if (abi === undefined) throw new Error('ShareToken ABI missing')
		const contract = { address: account as Address, label: 'Shares', kind: 'shareToken', provenance: 'test' }
		const singleInput = encodeFunctionData({ abi, functionName: 'safeTransferFrom', args: [account, childToken, 7n, 2_500_000_000_000_000_000n] })
		const single = decodeAction(contract, singleInput, new Map())
		expect(single.arguments?.['value']).toBe('2500000000000000000')
		expect(single.displayArguments?.['value']).toBe('2.5 shares')

		const batchInput = encodeFunctionData({
			abi,
			functionName: 'safeBatchTransferFrom',
			args: [account, childToken, [7n, 8n], [1_000_000_000_000_000_000n, 2_000_000_000_000_000_000n]],
		})
		const batch = decodeAction(contract, batchInput, new Map())
		expect(batch.arguments?.['values']).toEqual(['1000000000000000000', '2000000000000000000'])
		expect(batch.displayArguments?.['values']).toEqual(['1 shares', '2 shares'])
	})

	test('uses cached decimals for arbitrary InternalApproval tokens and explicit base-unit fallback', () => {
		const token = getAddress('0x3333333333333333333333333333333333333333')
		const abi = parseAbi(['event InternalApproval(address indexed owner,address indexed spender,address indexed token,uint256 amount)'])
		const topics = requireTopics(encodeEventTopics({ abi, eventName: 'InternalApproval', args: { owner: account, spender: childToken, token } }))
		const data = encodeAbiParameters([{ type: 'uint256' }], [1_500_001n])
		const metadata: TokenMetadata = { address: token, name: 'USD Coin', symbol: 'USDC', decimals: 6, readBlock: 10n }

		const decoded = decodeLogRecord('openOracle', topics, data, new Map(), new Map([[token.toLowerCase(), metadata]]), account)
		expect(decoded.displayArguments?.['amount']).toBe('1.500001 USDC')

		const unknown = decodeLogRecord('openOracle', topics, data, new Map(), new Map(), account)
		expect(unknown.displayArguments?.['amount']).toBe('1500001 base units')

		const knownRep = decodeLogRecord('openOracle', topics, data, new Map(), new Map(), account, new Map([[token.toLowerCase(), 'reputationToken']]))
		expect(knownRep.arguments?.['amount']).toBe('1500001')
		expect(knownRep.displayArguments?.['amount']).toBe('0.000000000001500001 REP')
	})

	test('formats and discovers calldata-only OpenOracle tokens including the ETH sentinel', () => {
		const abi = abiForKind('openOracle')
		if (abi === undefined) throw new Error('OpenOracle ABI missing')
		const token = getAddress('0x3333333333333333333333333333333333333333')
		const contract = { address: account as Address, label: 'OpenOracle', kind: 'openOracle', provenance: 'test' }
		const metadata: TokenMetadata = { address: token, name: 'USD Coin', symbol: 'USDC', decimals: 6, readBlock: 10n }
		const deposit = encodeFunctionData({ abi, functionName: 'deposit', args: [token, 1_500_001n, childToken] })
		const decoded = decodeAction(contract, deposit, new Map(), new Map([[token.toLowerCase(), metadata]]))
		expect(decoded.displayArguments?.['amount']).toBe('1.500001 USDC')
		expect(tokenAddressesFrom('openOracle', decoded, account)).toEqual([token])
		expect(decoded.argumentSchema?.map(({ index, name }) => [index, name])).toEqual([
			[0, 'token'],
			[1, 'amount'],
			[2, 'beneficiary'],
		])

		const ethDeposit = encodeFunctionData({ abi, functionName: 'deposit', args: [zeroAddress, 1_500_000_000_000_000_001n, childToken] })
		const decodedEth = decodeAction(contract, ethDeposit, new Map())
		expect(decodedEth.displayArguments?.['amount']).toBe('1.500000000000000001 ETH')
		expect(tokenAddressesFrom('openOracle', decodedEth, account)).toEqual([])

		const permitDeposit = encodeFunctionData({
			abi,
			functionName: 'depositFromPermit2',
			args: [1_500_001n, childToken, account, `0x${'11'.repeat(32)}`, { permitted: { token, amount: 9_000_000n }, nonce: 7n, deadline: 99n }, '0x1234'],
		})
		const decodedPermit = decodeAction(contract, permitDeposit, new Map(), new Map([[token.toLowerCase(), metadata]]))
		expect(decodedPermit.arguments).toMatchObject({ amount: '1500001', permit: { permitted: { amount: '9000000' } } })
		expect(decodedPermit.displayArguments).toMatchObject({ amount: '1.500001 USDC', permit: { permitted: { amount: '9 USDC' } } })
	})

	test('formats all nested OpenOracle report and dispute quantities without changing raw evidence', () => {
		const abi = abiForKind('openOracle')
		if (abi === undefined) throw new Error('OpenOracle ABI missing')
		const token = getAddress('0x3333333333333333333333333333333333333333')
		const contract = { address: account as Address, label: 'OpenOracle', kind: 'openOracle', provenance: 'test' }
		const metadata: TokenMetadata = { address: token, symbol: 'USDC', decimals: 6, readBlock: 10n }
		const params = {
			currentAmount1: 1_500_001n,
			currentAmount2: 2_000_000_000_000_000_000n,
			currentReporter: account,
			reportTimestamp: 1n,
			settlementTimestamp: 2n,
			token1: token,
			lastReportOppoTime: 3n,
			settlementTime: 4n,
			escalationHalt: 5n,
			protocolFeeRecipient: childToken,
			settlerReward: 1_250_000_000_000_000_000n,
			token2: zeroAddress,
			numReports: 6,
			disputeDelay: 7,
			feePercentage: 8,
			multiplier: 9,
			callbackContract: childToken,
			callbackGasLimit: 10,
			protocolFee: 11,
			flags: 12,
		}
		const timing = { blockNumber: 13n, blockNumberBound: 14n, blockTimestamp: 15n, blockTimestampBound: 16n }
		const metadataByAddress = new Map([[token.toLowerCase(), metadata]])
		const reportInput = encodeFunctionData({ abi, functionName: 'report', args: [params, false, false, timing] })
		const report = decodeAction(contract, reportInput, new Map(), metadataByAddress)
		expect(report.arguments).toMatchObject({
			params: { currentAmount1: '1500001', currentAmount2: '2000000000000000000', settlerReward: '1250000000000000000' },
		})
		expect(report.displayArguments).toMatchObject({
			params: { currentAmount1: '1.500001 USDC', currentAmount2: '2 ETH', settlerReward: '1.25 ETH' },
		})
		const sepoliaReport = decodeAction(contract, reportInput, new Map(), metadataByAddress, new Map(), { nativeSymbol: 'SepoliaETH' })
		expect(sepoliaReport.displayArguments).toMatchObject({
			params: { currentAmount1: '1.500001 USDC', currentAmount2: '2 SepoliaETH', settlerReward: '1.25 SepoliaETH' },
		})

		const disputeInput = encodeFunctionData({
			abi,
			functionName: 'dispute',
			args: [
				17n,
				3_000_001n,
				4_000_000_000_000_000_000n,
				account,
				false,
				false,
				params,
				{ reportId: 17n, creator: account, blockTimestamp: 15n, blockNumber: 13n },
				timing,
			],
		})
		const dispute = decodeAction(contract, disputeInput, new Map(), metadataByAddress)
		expect(dispute.arguments).toMatchObject({
			newAmount1: '3000001',
			newAmount2: '4000000000000000000',
			params: { currentAmount1: '1500001', currentAmount2: '2000000000000000000', settlerReward: '1250000000000000000' },
		})
		expect(dispute.displayArguments).toMatchObject({
			newAmount1: '3.000001 USDC',
			newAmount2: '4 ETH',
			params: { currentAmount1: '1.500001 USDC', currentAmount2: '2 ETH', settlerReward: '1.25 ETH' },
		})
	})

	test('decodes the canonical 235-byte OpenOracle packed report and rejects malformed payloads', () => {
		const abi = parseAbi(['event ReportSubmitted(uint256 indexed reportId,bytes packed)'])
		const topics = requireTopics(encodeEventTopics({ abi, eventName: 'ReportSubmitted', args: { reportId: 42n } }))
		const token1 = getAddress('0x4444444444444444444444444444444444444444')
		const token2 = getAddress('0x5555555555555555555555555555555555555555')
		const payload = concatHex([
			toHex(11n, { size: 16 }),
			toHex(22n, { size: 16 }),
			account,
			toHex(1_700_000_000n, { size: 6 }),
			toHex(0n, { size: 6 }),
			token1,
			toHex(99n, { size: 6 }),
			toHex(3600n, { size: 6 }),
			toHex(1_000_000n, { size: 16 }),
			childToken,
			toHex(123_000_000_000_000n, { size: 12 }),
			token2,
			toHex(3n, { size: 3 }),
			toHex(60n, { size: 3 }),
			toHex(1000n, { size: 3 }),
			toHex(140n, { size: 2 }),
			zeroAddress,
			toHex(500_000n, { size: 4 }),
			toHex(250n, { size: 3 }),
			toHex(5n, { size: 1 }),
			account,
			toHex(1_700_000_001n, { size: 6 }),
			toHex(19_000_000n, { size: 6 }),
		])

		const decoded = decodeLogRecord(
			'openOracle',
			topics,
			payload,
			new Map([[account.toLowerCase(), 'Reporter']]),
			new Map([
				[token1.toLowerCase(), { address: token1, symbol: 'USDC', decimals: 6, readBlock: 19_000_000n }],
				[token2.toLowerCase(), { address: token2, symbol: 'WETH', decimals: 18, readBlock: 19_000_000n }],
			]),
		)
		expect(decoded.status).toBe('decoded')
		expect(decoded.arguments).toMatchObject({ reportId: '42', currentAmount1: '11', token1, token2, blockNumber: '19000000' })
		expect(decoded.displayArguments?.['settlerRewardAttoEth']).toBe('0.000123 ETH')
		expect(decoded.displayArguments?.['currentAmount1']).toBe('0.000011 USDC')
		expect(decoded.displayArguments?.['currentAmount2']).toBe('0.000000000000000022 WETH')
		expect(decoded.displayArguments?.['currentReporter']).toContain('Reporter')
		const ethPayload = `${payload.slice(0, 2 + 64 * 2)}${zeroAddress.slice(2)}${payload.slice(2 + (64 + 20) * 2)}` as Hex
		const ethDecoded = decodeLogRecord('openOracle', topics, ethPayload, new Map(), new Map(), undefined, new Map(), { nativeSymbol: 'SepoliaETH' })
		expect(ethDecoded.displayArguments?.['currentAmount1']).toBe('0.000000000000000011 SepoliaETH')
		expect(ethDecoded.displayArguments?.['settlerRewardAttoEth']).toBe('0.000123 SepoliaETH')

		const malformed = decodeLogRecord('openOracle', topics, '0x1234', new Map())
		expect(malformed).toMatchObject({ name: 'ReportSubmitted', status: 'failed', summary: 'Malformed ReportSubmitted' })
	})

	test('discovers a child REP contract from a decoded Zoltar event', () => {
		const abi = parseAbi([
			'event DeployChild(address deployer,uint248 indexed universeId,uint256 indexed outcomeIndex,uint248 indexed childUniverseId,address childReputationToken,uint256 childUniverseTheoreticalSupplyAttoRep)',
		])
		const topics = encodeEventTopics({ abi, eventName: 'DeployChild', args: { universeId: 2n, outcomeIndex: 3n, childUniverseId: 7n } })
		const data = encodeAbiParameters([{ type: 'address' }, { type: 'address' }, { type: 'uint256' }], [account, childToken, 99_000_000_000_000_000_000n])
		const decoded = decodeLogRecord('zoltar', requireTopics(topics), data, new Map())

		expect(discoveriesFrom(decoded)).toEqual([{ address: childToken, kind: 'reputationToken', label: 'Child REP' }])
	})

	test('decodes Augur AMM pair creation and discovers the pair activity source', () => {
		const abi = abiForKind('ammFactory')
		if (abi === undefined) throw new Error('Augur AMM factory ABI missing')
		const pair = getAddress('0x3333333333333333333333333333333333333333')
		const topics = requireTopics(
			encodeEventTopics({
				abi,
				eventName: 'PairCreated',
				args: { securityPool: account, shareToken: childToken, universeId: 7n },
			}),
		)
		const data = encodeAbiParameters([{ type: 'address' }, { type: 'uint256' }], [pair, 30n])
		const decoded = decodeLogRecord('ammFactory', topics, data, new Map())
		expect(decoded).toMatchObject({
			name: 'PairCreated',
			status: 'decoded',
			arguments: { securityPool: account, shareToken: childToken, universeId: '7', pair, feeBps: '30' },
		})
		expect(discoveriesFrom(decoded)).toEqual([{ address: pair, kind: 'ammPair', label: 'Augur AMM Pair' }])
	})

	test('discovers only known REP/quote Uniswap V2 and V3 markets', () => {
		const pair = getAddress('0x3333333333333333333333333333333333333333')
		const unrelated = getAddress('0x4444444444444444444444444444444444444444')
		const usdc = getAddress('0x5555555555555555555555555555555555555555')
		const contracts = new Map([
			[account.toLowerCase(), { address: account, kind: 'reputationToken', label: 'REP', provenance: 'manifest' }],
			[childToken.toLowerCase(), { address: childToken, kind: 'weth', label: 'WETH', provenance: 'manifest' }],
			[usdc.toLowerCase(), { address: usdc, kind: 'usdc', label: 'USDC', provenance: 'manifest' }],
		])
		const v2Abi = abiForKind('uniswapV2Factory')
		const v3Abi = abiForKind('uniswapV3Factory')
		if (v2Abi === undefined || v3Abi === undefined) throw new Error('Uniswap factory ABI missing')
		const v2 = decodeLogRecord(
			'uniswapV2Factory',
			requireTopics(encodeEventTopics({ abi: v2Abi, eventName: 'PairCreated', args: { token0: account, token1: childToken } })),
			encodeAbiParameters([{ type: 'address' }, { type: 'uint256' }], [pair, 1n]),
			new Map(),
		)
		expect(discoveriesFrom(v2, contracts)).toEqual([{ address: pair, kind: 'uniswapV2Pair', label: 'Uniswap V2 REP / WETH Pair' }])

		const unrelatedV2 = decodeLogRecord(
			'uniswapV2Factory',
			requireTopics(encodeEventTopics({ abi: v2Abi, eventName: 'PairCreated', args: { token0: account, token1: unrelated } })),
			encodeAbiParameters([{ type: 'address' }, { type: 'uint256' }], [pair, 1n]),
			new Map(),
		)
		expect(discoveriesFrom(unrelatedV2, contracts)).toEqual([])

		const v3 = decodeLogRecord(
			'uniswapV3Factory',
			requireTopics(encodeEventTopics({ abi: v3Abi, eventName: 'PoolCreated', args: { token0: account, token1: childToken, fee: 500 } })),
			encodeAbiParameters([{ type: 'int24' }, { type: 'address' }], [10, pair]),
			new Map(),
		)
		expect(discoveriesFrom(v3, contracts)).toEqual([{ address: pair, kind: 'uniswapV3Pool', label: 'Uniswap V3 REP / WETH Pool' }])

		const usdcV3 = decodeLogRecord(
			'uniswapV3Factory',
			requireTopics(encodeEventTopics({ abi: v3Abi, eventName: 'PoolCreated', args: { token0: account, token1: usdc, fee: 3000 } })),
			encodeAbiParameters([{ type: 'int24' }, { type: 'address' }], [60, pair]),
			new Map(),
		)
		expect(discoveriesFrom(usdcV3, contracts)).toEqual([{ address: pair, kind: 'uniswapV3Pool', label: 'Uniswap V3 REP / USDC Pool' }])
	})

	test('retains unknown event evidence without throwing', () => {
		const decoded = decodeLogRecord('zoltar', [`0x${'ab'.repeat(32)}` as Hex], '0x', new Map())
		expect(decoded.status).toBe('unknown')
		expect(decoded.summary).toContain('Unknown event')
	})

	test('marks truncated known and projection events as failed evidence', () => {
		const transferAbi = parseAbi(['event Transfer(address indexed from,address indexed to,uint256 value)'])
		const transferTopics = requireTopics(encodeEventTopics({ abi: transferAbi, eventName: 'Transfer', args: { from: account, to: childToken } }))
		expect(decodeLogRecord('reputationToken', transferTopics, '0x', new Map()).status).toBe('failed')

		const checkpointAbi = parseAbi([
			'event PoolAccountingCheckpoint(uint8 reason,address indexed vault,uint256 settlementCollateralAttoEth,uint256 totalCapacityOwnershipAttoRep,uint256 feeEligibleCapacityOwnershipAttoRep,uint256 totalClaimableVaultFeesAttoEth,uint256 unallocatedAccruedFeesAttoEth,uint256 feeIndex,uint256 feeIndexRemainder,uint256 totalFeesOwedRemainder,uint256 uncheckpointedFeeEligibleCapacityOwnershipAttoRep,uint256 lastUpdatedFeeAccumulator,uint256 currentRetentionRate)',
		])
		const checkpointTopics = requireTopics(encodeEventTopics({ abi: checkpointAbi, eventName: 'PoolAccountingCheckpoint', args: { vault: childToken } }))
		const decoded = decodeLogRecord('securityPool', checkpointTopics, '0x', new Map())
		expect(decoded.status).toBe('failed')
		const stored: StoredLog = {
			transactionHash: `0x${'11'.repeat(32)}`,
			blockHash: `0x${'22'.repeat(32)}`,
			blockNumber: 1n,
			transactionIndex: 0,
			logIndex: 0,
			address: account,
			topics: checkpointTopics,
			data: '0x',
			decoded,
		}
		expect(projectionsFrom(stored)).toEqual([])
	})

	test('decodes calldata with lossless integer arguments', () => {
		const abi = abiForKind('zoltar')
		if (abi === undefined) throw new Error('Zoltar ABI missing')
		const input = encodeFunctionData({ abi, functionName: 'getRepToken', args: [123n] })
		const decoded = decodeAction({ address: account as Address, label: 'Zoltar', kind: 'zoltar', provenance: 'test' }, input, new Map())
		expect(decoded.status).toBe('decoded')
		expect(decoded.name).toBe('getRepToken')
		expect(decoded.signature).toContain('getRepToken')
		expect(decoded.arguments?.['universeId']).toBe('123')
	})

	test('formats generic token amounts in decoded actions', () => {
		const abi = abiForKind('reputationToken')
		if (abi === undefined) throw new Error('ReputationToken ABI missing')
		const input = encodeFunctionData({ abi, functionName: 'transfer', args: [childToken, 1_500_000_000_000_000_000n] })
		const decoded = decodeAction({ address: account as Address, label: 'REP', kind: 'reputationToken', provenance: 'test' }, input, new Map())
		expect(decoded.status).toBe('decoded')
		expect(Object.values(decoded.displayArguments ?? {})).toContain('1.5 REP')
	})

	test('does not discover the zero address as a deployed contract', () => {
		expect(
			discoveriesFrom({
				name: 'DeploySecurityPool',
				arguments: { truthAuction: zeroAddress },
				status: 'decoded',
				summary: 'deployment',
			}),
		).toEqual([])
	})

	test('extracts only ABI-typed addresses from decoded evidence', () => {
		const nestedOwner = getAddress('0x3333333333333333333333333333333333333333')
		const [event] = parseAbi(['event Evidence(string title,address vault,(string note,address owner) nested)'])
		if (event?.type !== 'event' || event.inputs === undefined) throw new Error('Evidence event ABI missing')
		expect(
			referencedAddressesFrom(event.inputs, {
				title: account,
				vault: childToken,
				nested: { note: account, owner: nestedOwner },
			}),
		).toEqual([childToken, nestedOwner])
	})

	test('maps all supported manifest contract kinds to ABIs', () => {
		for (const kind of [
			'ammFactory',
			'ammPair',
			'proxyDeployer',
			'multicall3',
			'priceCoordinatorFactory',
			'scalarOutcomes',
			'securityPoolUtils',
			'shareTokenFactory',
			'truthAuctionFactory',
		]) {
			expect(abiForKind(kind)).toBeDefined()
		}
	})
})
