import { encodeFunctionData, getAddress, isAddress, parseAbi, zeroAddress, type Address, type AbiValue, type Hex } from '@zoltar/core-shared/evm/ethereum'
import type { PortfolioReadClient } from './securityPoolPortfolioRead.js'

const abi = parseAbi([
	'function deposit(uint256 amountAttoRep,uint256 minimumShares) returns (uint256)',
	'function withdraw(uint256 shares,uint256 minimumIdleAttoRep) returns (uint256)',
	'function claimFees()',
	'function rebalancePosition(uint256 positionId)',
	'function claimPosition(uint256 positionId,address owner)',
	'function balanceOf(address owner) view returns (uint256)',
	'function totalSupply() view returns (uint256)',
	'function totalAssets() view returns (uint256)',
	'function claimableFees(address owner) view returns (uint256)',
	'function originUniverseId() view returns (uint248)',
	'function repToken() view returns (address)',
	'function priceFeed(uint248 universeId) view returns (address)',
	'function configCoordinator() view returns (address)',
	'function securityPool() view returns (address)',
	'function zoltar() view returns (address)',
	'function getForkTime(uint248 universeId) view returns (uint256)',
	'function positionCount() view returns (uint256)',
	'function statoblastSecurityMultiplierBps() view returns (uint256)',
	'function lastPrice() view returns (uint256)',
	'function positions(uint256 positionId) view returns (uint256 questionId,uint256 totalShares,uint256 remainingShares,address custody)',
	'function isReusablePosition(uint256 positionId) view returns (bool)',
	'function questionCount() view returns (uint256)',
	'function getQuestions(uint256 start,uint256 count) view returns (uint256[])',
	'function getPool(uint256 questionId,uint248 universeId) view returns (address)',
	'function questionData() view returns (address)',
	'function getQuestionEndDate(uint256 questionId) view returns (uint256)',
	'function systemState() view returns (uint8)',
	'function getOwnerPositionShares(uint256 positionId,address owner) view returns (uint256)',
	'function quoteMint(uint256 questionId,uint256 mintAttoEth) view returns (uint256 depositAttoRep,uint256 reservationFeeAttoEth,uint256 availableAttoRep)',
	'function allowance(address owner,address spender) view returns (uint256)',
])

function uint(value: unknown, label: string): bigint {
	if (typeof value !== 'bigint' || value < 0n || value >= 1n << 256n) throw new Error(`${label} must fit uint256.`)
	return value
}

function address(value: unknown): Address {
	if (typeof value !== 'string' || !isAddress(value) || getAddress(value) === zeroAddress) throw new Error('Choose a nonzero address.')
	return getAddress(value)
}

function tuple(value: unknown, length: number): unknown[] {
	if (!Array.isArray(value) || value.length !== length) throw new Error('Invalid aggregate portfolio response.')
	return value
}

function request(owner: Address, portfolio: Address, functionName: string, args: readonly AbiValue[] = []) {
	return { account: address(owner), to: address(portfolio), value: 0n, data: encodeFunctionData({ abi, functionName, args }) }
}

/** Approve the portfolio REP token separately before depositing into its common underwriting fund. */
export function buildPortfolioDepositRequest(parameters: { owner: Address; portfolio: Address; amountAttoRep: bigint; minimumShares: bigint }) {
	const amount = uint(parameters.amountAttoRep, 'REP deposit')
	if (amount === 0n) throw new Error('Enter a positive REP deposit.')
	return request(parameters.owner, parameters.portfolio, 'deposit', [amount, uint(parameters.minimumShares, 'Minimum fund shares')])
}

/** Burns the owner's fund shares; native question positions remain subject to their existing locks. */
export function buildPortfolioFundWithdrawalRequest(parameters: { owner: Address; portfolio: Address; shares: bigint; minimumIdleAttoRep: bigint }) {
	const shares = uint(parameters.shares, 'Fund shares')
	if (shares === 0n) throw new Error('Enter a positive fund share amount.')
	return request(parameters.owner, parameters.portfolio, 'withdraw', [shares, uint(parameters.minimumIdleAttoRep, 'Minimum idle REP')])
}

export function buildPortfolioClaimFeesRequest(parameters: { owner: Address; portfolio: Address }) {
	return request(parameters.owner, parameters.portfolio, 'claimFees')
}

export function buildPortfolioPositionRebalanceRequest(parameters: { processor: Address; portfolio: Address; positionId: bigint }) {
	return request(parameters.processor, parameters.portfolio, 'rebalancePosition', [uint(parameters.positionId, 'Position id')])
}

/** Live reusable allocations require the entitled owner; closed, ended or forked claims may be processed by anyone for that owner. */
export function buildPortfolioPositionClaimRequest(parameters: { processor: Address; portfolio: Address; positionId: bigint; owner: Address }) {
	return request(parameters.processor, parameters.portfolio, 'claimPosition', [uint(parameters.positionId, 'Position id'), address(parameters.owner)])
}

export type PortfolioAggregateSnapshot = {
	portfolio: Address
	owner: Address
	chainId: number
	blockNumber: bigint
	blockHash: Hex
	timestamp: bigint
	originUniverseId: bigint
	forkTime: bigint
	repToken: Address
	shares: bigint
	totalShares: bigint
	assetsAttoRep: bigint
	ownerAssetsAttoRep: bigint
	claimableFeesAttoEth: bigint
	walletAttoRep: bigint
	allowanceAttoRep: bigint
	reserveAttoRep: bigint
	reserveCapacityAttoEth: bigint
	questionCount: bigint
	questionStart: bigint
	questions: bigint[]
	positionCount: bigint
	positionStart: bigint
	positions: { positionId: bigint; questionId: bigint; custody: Address; ownerShares: bigint; remainingShares: bigint; reusable: boolean; questionEndTime: bigint; operational: boolean }[]
}

/** Reserve balances and bounded allocation/question pages share one mined block. */
export async function loadPortfolioAggregateSnapshot(parameters: { client: PortfolioReadClient; portfolio: Address; owner: Address; positionStart?: bigint; questionStart?: bigint }): Promise<PortfolioAggregateSnapshot> {
	const { client } = parameters
	const portfolio = address(parameters.portfolio)
	const owner = address(parameters.owner)
	const positionStart = uint(parameters.positionStart ?? 0n, 'Position page start')
	const questionStart = uint(parameters.questionStart ?? 0n, 'Question page start')
	const [block, chainId] = await Promise.all([client.getBlock(), client.getChainId()])
	const { number: blockNumber, hash: blockHash, timestamp } = block
	if (blockNumber === undefined || blockHash === undefined) throw new Error('Portfolio snapshot requires a mined block.')
	const read = (target: Address, functionName: string, args: readonly AbiValue[] = []) => client.readContract({ address: target, abi, functionName, args, blockNumber })
	const values = await Promise.all([
		read(portfolio, 'originUniverseId'),
		read(portfolio, 'repToken'),
		read(portfolio, 'balanceOf', [owner]),
		read(portfolio, 'totalSupply'),
		read(portfolio, 'totalAssets'),
		read(portfolio, 'claimableFees', [owner]),
		read(portfolio, 'statoblastSecurityMultiplierBps'),
		read(portfolio, 'positionCount'),
		read(portfolio, 'questionCount'),
	])
	const originUniverseId = uint(values[0], 'Universe id')
	// The shared feed exists before any question is registered. Its configuration
	// coordinator identifies the seed pool even when genesis REP is an external token.
	const feed = address(await read(portfolio, 'priceFeed', [originUniverseId]))
	const price = uint(await read(feed, 'lastPrice'), 'REP price')
	const coordinator = address(await read(feed, 'configCoordinator'))
	const seedPool = address(await read(coordinator, 'securityPool'))
	const zoltar = address(await read(seedPool, 'zoltar'))
	const forkTime = uint(await read(zoltar, 'getForkTime', [originUniverseId]), 'Fork time')
	const repToken = address(values[1])
	const shares = uint(values[2], 'Owner fund shares')
	const totalShares = uint(values[3], 'Total fund shares')
	const assetsAttoRep = uint(values[4], 'Fund assets')
	const claimableFeesAttoEth = uint(values[5], 'Claimable fees')
	const multiplier = uint(values[6], 'Security multiplier')
	const reserveAttoRep = assetsAttoRep
	const reserveCapacityAttoEth = price === 0n ? 0n : (((reserveAttoRep * 10n ** 18n) / price) * 100_000_000n) / ((multiplier > 10_500n ? multiplier : 10_500n) * 12_000n)
	const positionCount = uint(values[7], 'Position count')
	const questionCount = uint(values[8], 'Question count')
	if (positionStart > positionCount) throw new Error('Position page is out of bounds.')
	if (questionStart > questionCount) throw new Error('Question page is out of bounds.')
	const count = positionCount - positionStart < 64n ? positionCount - positionStart : 64n
	const questionPageCount = questionCount - questionStart < 64n ? questionCount - questionStart : 64n
	const [wallet, allowance, questionPage] = await Promise.all([read(repToken, 'balanceOf', [owner]), read(repToken, 'allowance', [owner, portfolio]), read(portfolio, 'getQuestions', [questionStart, questionPageCount])])
	const questions = tuple(questionPage, Number(questionPageCount)).map(value => uint(value, 'Question id'))
	const questionStates = new Map<bigint, Promise<{ questionEndTime: bigint; operational: boolean }>>()
	const questionState = (questionId: bigint) => {
		const existing = questionStates.get(questionId)
		if (existing !== undefined) return existing
		const pending = (async () => {
			const pool = address(await read(portfolio, 'getPool', [questionId, originUniverseId]))
			const [data, state] = await Promise.all([read(pool, 'questionData'), read(pool, 'systemState')])
			if (typeof state !== 'bigint' && (typeof state !== 'number' || !Number.isInteger(state))) throw new Error('Invalid question state.')
			return { questionEndTime: uint(await read(address(data), 'getQuestionEndDate', [questionId]), 'Question end'), operational: state === 0n || state === 0 }
		})()
		questionStates.set(questionId, pending)
		return pending
	}
	const positions = await Promise.all(
		Array.from({ length: Number(count) }, async (_, index) => {
			const positionId = positionStart + BigInt(index) + 1n
			const [allocation, ownerShares, reusable] = await Promise.all([read(portfolio, 'positions', [positionId]), read(portfolio, 'getOwnerPositionShares', [positionId, owner]), read(portfolio, 'isReusablePosition', [positionId])])
			const position = tuple(allocation, 4)
			if (typeof reusable !== 'boolean') throw new Error('Invalid position reuse state.')
			const questionId = uint(position[0], 'Question id')
			return { positionId, questionId, custody: address(position[3]), ownerShares: uint(ownerShares, 'Position claim'), remainingShares: uint(position[2], 'Remaining position shares'), reusable, ...(await questionState(questionId)) }
		}),
	)
	const [latestBlock, latestChain] = await Promise.all([client.getBlock({ blockNumber }), client.getChainId()])
	if (latestBlock.hash !== blockHash || latestChain !== chainId) throw new Error('Chain changed while reading the portfolio. Refresh and try again.')
	return {
		portfolio,
		owner,
		chainId,
		blockNumber,
		blockHash,
		timestamp,
		originUniverseId,
		forkTime,
		repToken,
		shares,
		totalShares,
		assetsAttoRep,
		ownerAssetsAttoRep: totalShares === 0n ? 0n : (assetsAttoRep * shares) / totalShares,
		claimableFeesAttoEth,
		walletAttoRep: uint(wallet, 'Wallet REP'),
		allowanceAttoRep: uint(allowance, 'REP allowance'),
		reserveAttoRep,
		reserveCapacityAttoEth,
		questionCount,
		questionStart,
		questions,
		positionCount,
		positionStart,
		positions,
	}
}

export async function loadPortfolioMintQuote(parameters: { client: PortfolioReadClient; snapshot: Pick<PortfolioAggregateSnapshot, 'portfolio' | 'blockNumber' | 'blockHash' | 'chainId'>; questionId: bigint; mintAttoEth: bigint }) {
	const { client, snapshot } = parameters
	const questionId = uint(parameters.questionId, 'Question id')
	const amount = uint(parameters.mintAttoEth, 'Mint amount')
	if (amount === 0n) throw new Error('Enter a positive ETH mint amount.')
	const result = await client.readContract({ address: snapshot.portfolio, abi, functionName: 'quoteMint', args: [questionId, amount], blockNumber: snapshot.blockNumber })
	const values = tuple(result, 3)
	const [block, chainId] = await Promise.all([client.getBlock({ blockNumber: snapshot.blockNumber }), client.getChainId()])
	if (block.hash !== snapshot.blockHash || chainId !== snapshot.chainId) throw new Error('Chain changed while quoting the mint. Refresh and try again.')
	return { depositAttoRep: uint(values[0], 'Required REP'), reservationFeeAttoEth: uint(values[1], 'Reservation fee'), availableAttoRep: uint(values[2], 'Available REP') }
}
