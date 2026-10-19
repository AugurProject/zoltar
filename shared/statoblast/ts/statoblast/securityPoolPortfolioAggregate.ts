import { encodeFunctionData, getAddress, isAddress, parseAbi, zeroAddress, type Address, type AbiValue, type Hex } from '@zoltar/core-shared/evm/ethereum'
import type { PortfolioEconomicsConfig } from './securityPoolPortfolio.js'
import type { PortfolioReadClient } from './securityPoolPortfolioRead.js'

const abi = parseAbi([
	'function deposit(uint256 amountAttoRep,uint256 minimumShares) payable returns (uint256)',
	'function withdraw(uint256 shares,uint256 minimumIdleAttoRep) payable returns (uint256)',
	'function claimRecovered(uint256[] intervalIds,uint256[] positionIds)',
	'function claimRecoveredAndDeposit(uint256[] intervalIds,uint256[] positionIds,uint256 minimumShares) payable',
	'function recyclePosition(uint256 positionId)',
	'function targetHealthFactorBps() view returns (uint256)',
	'function purchaseFeeBps() view returns (uint256)',
	'function minimumPurchaseFeeAttoEth() view returns (uint256)',
	'function completionRewardAttoEth() view returns (uint256)',
	'function ownershipChangeFeeAttoEth() view returns (uint256)',
	'function quoteOwnershipChangeFee() view returns (uint256)',
	'function maintenanceBudgetAttoEth() view returns (uint256)',
	'function questionAdmissionPolicy() view returns (address)',
	'function rebalancePosition(uint256 positionId)',
	'function claimPosition(uint256 positionId,uint256 intervalId)',
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
	'function positionRecoveryComplete(uint256 positionId) view returns (bool)',
	'function recoveryLedger() view returns (address)',
	'function forkController() view returns (address)',
	'function isIntervalSelected(uint256 contextId,address owner,uint256 intervalId) view returns (bool)',
	'function recoveryBounties(uint256 positionId) view returns (uint256)',
	'function processingRewards(address owner) view returns (uint256)',
	'function canRetireOwnerInterval(address owner,uint256 intervalId) view returns (bool)',
	'function getOwnerActiveIntervalCount(address owner) view returns (uint256)',
	'function getOwnerActiveIntervals(address owner,uint256 cursor,uint256 count) view returns (uint256[] intervalIds,uint256 nextCursor)',
	'function getOwnerInterval(address owner,uint256 intervalId) view returns ((uint256 generation,uint256 startPosition,uint256 endPosition,uint256 shares,uint256 repIndex,uint256 feeIndex,bool open,bool active))',
	'function previewClaim(address owner,uint256[] intervalIds) view returns (uint256 rep,uint256 eth)',
	'function questionCount() view returns (uint256)',
	'function getQuestions(uint256 start,uint256 count) view returns (uint256[])',
	'function getPool(uint256 questionId,uint248 universeId) view returns (address)',
	'function questionData() view returns (address)',
	'function getQuestionEndDate(uint256 questionId) view returns (uint256)',
	'function systemState() view returns (uint8)',
	'function isEscalationResolved() view returns (bool)',
	'function getOwnerPositionShares(uint256 positionId,address owner) view returns (uint256)',
	'function quoteMint(uint256 questionId,uint256 mintAttoEth) view returns (uint256 depositAttoRep,uint256 purchaseFeeAttoEth,uint256 availableAttoRep)',
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
export function buildPortfolioDepositRequest(parameters: { owner: Address; portfolio: Address; amountAttoRep: bigint; minimumShares: bigint; maximumOwnershipFeeAttoEth: bigint }) {
	const amount = uint(parameters.amountAttoRep, 'REP deposit')
	if (amount === 0n) throw new Error('Enter a positive REP deposit.')
	return { ...request(parameters.owner, parameters.portfolio, 'deposit', [amount, uint(parameters.minimumShares, 'Minimum fund shares')]), value: uint(parameters.maximumOwnershipFeeAttoEth, 'Ownership fee budget') }
}

/** Burns the owner's fund shares; native question positions remain subject to their existing locks. */
export function buildPortfolioFundWithdrawalRequest(parameters: { owner: Address; portfolio: Address; shares: bigint; minimumIdleAttoRep: bigint; maximumOwnershipFeeAttoEth: bigint }) {
	const shares = uint(parameters.shares, 'Fund shares')
	if (shares === 0n) throw new Error('Enter a positive fund share amount.')
	return { ...request(parameters.owner, parameters.portfolio, 'withdraw', [shares, uint(parameters.minimumIdleAttoRep, 'Minimum idle REP')]), value: uint(parameters.maximumOwnershipFeeAttoEth, 'Ownership fee budget') }
}

function orderedIds(values: readonly bigint[], label: string) {
	return [...new Set(values.map(id => uint(id, label)))].sort((left, right) => {
		if (left < right) return -1
		if (left > right) return 1
		return 0
	})
}

export function buildPortfolioClaimRecoveredRequest(parameters: { owner: Address; portfolio: Address; intervalIds: readonly bigint[]; positionIds?: readonly bigint[] }) {
	return request(parameters.owner, parameters.portfolio, 'claimRecovered', [orderedIds(parameters.intervalIds, 'Owner interval id'), orderedIds(parameters.positionIds ?? [], 'Position id')])
}

export function buildPortfolioClaimAndDepositRequest(parameters: { owner: Address; portfolio: Address; intervalIds: readonly bigint[]; positionIds?: readonly bigint[]; minimumShares: bigint; maximumOwnershipFeeAttoEth: bigint }) {
	return {
		...request(parameters.owner, parameters.portfolio, 'claimRecoveredAndDeposit', [orderedIds(parameters.intervalIds, 'Owner interval id'), orderedIds(parameters.positionIds ?? [], 'Position id'), uint(parameters.minimumShares, 'Minimum fund shares')]),
		value: uint(parameters.maximumOwnershipFeeAttoEth, 'Ownership fee budget'),
	}
}

export function buildPortfolioRecyclePositionRequest(parameters: { processor: Address; portfolio: Address; positionId: bigint }) {
	const positionId = uint(parameters.positionId, 'Position id')
	if (positionId === 0n) throw new Error('Choose an allocation position.')
	return request(parameters.processor, parameters.portfolio, 'recyclePosition', [positionId])
}

export function buildPortfolioPositionRebalanceRequest(parameters: { processor: Address; portfolio: Address; positionId: bigint }) {
	return request(parameters.processor, parameters.portfolio, 'rebalancePosition', [uint(parameters.positionId, 'Position id')])
}

// Individual in-kind recovery is an owner-authorized exception to shared cash collection.
export function buildPortfolioPositionClaimRequest(parameters: { owner: Address; portfolio: Address; positionId: bigint; intervalId: bigint }) {
	return request(parameters.owner, parameters.portfolio, 'claimPosition', [uint(parameters.positionId, 'Position id'), uint(parameters.intervalId, 'Owner interval id')])
}

export type PortfolioAggregateSnapshot = {
	portfolio: Address
	economics: PortfolioEconomicsConfig
	questionAdmissionPolicy: Address
	ownershipChangeFeeAttoEth: bigint
	maintenanceBudgetAttoEth: bigint
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
	recoveryLedger: Address
	intervalCount: bigint
	intervalCursor: bigint
	nextIntervalCursor: bigint
	intervals: { intervalId: bigint; generation: bigint; startPosition: bigint; endPosition: bigint; shares: bigint; open: boolean; active: boolean; canRetire: boolean; sharedForkSelected?: boolean }[]
	recoverableRepAttoRep: bigint
	recoverableFeesAttoEth: bigint
	processingRewardsAttoEth: bigint
	walletAttoRep: bigint
	allowanceAttoRep: bigint
	reserveAttoRep: bigint
	reserveCapacityAttoEth: bigint
	questionCount: bigint
	questionStart: bigint
	questions: bigint[]
	positionCount: bigint
	positionStart: bigint
	positions: { positionId: bigint; questionId: bigint; custody: Address; ownerShares: bigint; remainingShares: bigint; reusable: boolean; recoveryComplete: boolean; recoveryBountyAttoEth: bigint; questionEndTime: bigint; operational: boolean; resolved: boolean }[]
}

/** Reserve balances and bounded allocation/question pages share one mined block. */
export async function loadPortfolioAggregateSnapshot(parameters: { client: PortfolioReadClient; portfolio: Address; owner: Address; positionStart?: bigint; questionStart?: bigint; intervalCursor?: bigint }): Promise<PortfolioAggregateSnapshot> {
	const { client } = parameters
	const portfolio = address(parameters.portfolio)
	const owner = address(parameters.owner)
	const positionStart = uint(parameters.positionStart ?? 0n, 'Position page start')
	const questionStart = uint(parameters.questionStart ?? 0n, 'Question page start')
	const intervalCursor = uint(parameters.intervalCursor ?? 0n, 'Recovery history page start')
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
		read(portfolio, 'recoveryLedger'),
		read(portfolio, 'processingRewards', [owner]),
		read(portfolio, 'forkController'),
		read(portfolio, 'targetHealthFactorBps'),
		read(portfolio, 'purchaseFeeBps'),
		read(portfolio, 'minimumPurchaseFeeAttoEth'),
		read(portfolio, 'completionRewardAttoEth'),
		read(portfolio, 'ownershipChangeFeeAttoEth'),
		read(portfolio, 'quoteOwnershipChangeFee'),
		read(portfolio, 'maintenanceBudgetAttoEth'),
		read(portfolio, 'questionAdmissionPolicy'),
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
	const economics = {
		targetHealthFactorBps: uint(values[12], 'Target health'),
		purchaseFeeBps: uint(values[13], 'Purchase fee'),
		minimumPurchaseFeeAttoEth: uint(values[14], 'Minimum purchase fee'),
		completionRewardAttoEth: uint(values[15], 'Completion reward'),
		ownershipChangeFeeAttoEth: uint(values[16], 'Ownership change fee'),
	}
	const ownershipChangeFeeAttoEth = uint(values[17], 'Quoted ownership fee')
	const maintenanceBudgetAttoEth = uint(values[18], 'Maintenance budget')
	const questionAdmissionPolicy = address(values[19])
	const reserveAttoRep = assetsAttoRep
	const reserveCapacityAttoEth = price === 0n ? 0n : (((reserveAttoRep * 10n ** 18n) / price) * 100_000_000n) / ((multiplier > 10_500n ? multiplier : 10_500n) * economics.targetHealthFactorBps)
	const positionCount = uint(values[7], 'Position count')
	const questionCount = uint(values[8], 'Question count')
	const recoveryLedger = address(values[9])
	const processingRewardsAttoEth = uint(values[10], 'Processing rewards')
	const forkController = address(values[11])
	const [intervalCountValue, intervalPageValue] = await Promise.all([read(recoveryLedger, 'getOwnerActiveIntervalCount', [owner]), read(recoveryLedger, 'getOwnerActiveIntervals', [owner, intervalCursor, 64n])])
	const intervalCount = uint(intervalCountValue, 'Active recovery history count')
	const intervalPage = tuple(intervalPageValue, 2)
	if (!Array.isArray(intervalPage[0]) || intervalPage[0].length > 64) throw new Error('Invalid active ownership history page.')
	const intervalIds = intervalPage[0].map(value => uint(value, 'Owner interval id'))
	const nextIntervalCursor = uint(intervalPage[1], 'Next ownership cursor')
	if (intervalIds.some((id, index) => id + 1n < intervalCursor || (index > 0 && id <= (intervalIds[index - 1] ?? id)))) throw new Error('Invalid active ownership history order.')
	const lastId = intervalIds.at(-1)
	if (nextIntervalCursor !== 0n && (lastId === undefined || nextIntervalCursor <= lastId + 1n)) throw new Error('Invalid active ownership continuation.')
	const intervals = await Promise.all(
		intervalIds.map(async intervalId => {
			const [value, canRetire, sharedForkSelected] = await Promise.all([read(recoveryLedger, 'getOwnerInterval', [owner, intervalId]), read(recoveryLedger, 'canRetireOwnerInterval', [owner, intervalId]), forkTime > 0n ? read(forkController, 'isIntervalSelected', [0n, owner, intervalId]) : Promise.resolve(false)])
			const fields = ['generation', 'startPosition', 'endPosition', 'shares', 'repIndex', 'feeIndex', 'open', 'active']
			const entry = Array.isArray(value) ? tuple(value, fields.length) : fields.map(field => (value !== null && typeof value === 'object' ? Reflect.get(value, field) : undefined))
			const open = entry[6]
			const active = entry[7]
			if (typeof open !== 'boolean' || typeof active !== 'boolean' || typeof canRetire !== 'boolean' || typeof sharedForkSelected !== 'boolean') throw new Error('Invalid recovery interval state.')
			return { intervalId, generation: uint(entry[0], 'Recovery generation'), startPosition: uint(entry[1], 'First allocation'), endPosition: uint(entry[2], 'Last allocation'), shares: uint(entry[3], 'Recovery shares'), open, active, canRetire, sharedForkSelected }
		}),
	)
	const proceeds = tuple(await read(recoveryLedger, 'previewClaim', [owner, intervals.filter(interval => interval.active).map(interval => interval.intervalId)]), 2)
	const recoverableRepAttoRep = uint(proceeds[0], 'Recovered REP')
	const recoverableFeesAttoEth = claimableFeesAttoEth + processingRewardsAttoEth + uint(proceeds[1], 'Recovered fees')

	if (positionStart > positionCount) throw new Error('Position page is out of bounds.')
	if (questionStart > questionCount) throw new Error('Question page is out of bounds.')
	const count = positionCount - positionStart < 64n ? positionCount - positionStart : 64n
	const questionPageCount = questionCount - questionStart < 64n ? questionCount - questionStart : 64n
	const [wallet, allowance, questionPage] = await Promise.all([read(repToken, 'balanceOf', [owner]), read(repToken, 'allowance', [owner, portfolio]), read(portfolio, 'getQuestions', [questionStart, questionPageCount])])
	const questions = tuple(questionPage, Number(questionPageCount)).map(value => uint(value, 'Question id'))
	const questionStates = new Map<bigint, Promise<{ questionEndTime: bigint; operational: boolean; resolved: boolean }>>()
	const questionState = (questionId: bigint) => {
		const existing = questionStates.get(questionId)
		if (existing !== undefined) return existing
		const pending = (async () => {
			const pool = address(await read(portfolio, 'getPool', [questionId, originUniverseId]))
			const [data, state, resolved] = await Promise.all([read(pool, 'questionData'), read(pool, 'systemState'), read(pool, 'isEscalationResolved')])
			if (typeof state !== 'bigint' && (typeof state !== 'number' || !Number.isInteger(state))) throw new Error('Invalid question state.')
			if (typeof resolved !== 'boolean') throw new Error('Invalid question resolution.')
			return { questionEndTime: uint(await read(address(data), 'getQuestionEndDate', [questionId]), 'Question end'), operational: state === 0n || state === 0, resolved }
		})()
		questionStates.set(questionId, pending)
		return pending
	}
	const positions = await Promise.all(
		Array.from({ length: Number(count) }, async (_, index) => {
			const positionId = positionStart + BigInt(index) + 1n
			const [allocation, ownerShares, reusable, recoveryComplete, recoveryBounty] = await Promise.all([
				read(portfolio, 'positions', [positionId]),
				read(portfolio, 'getOwnerPositionShares', [positionId, owner]),
				read(portfolio, 'isReusablePosition', [positionId]),
				read(portfolio, 'positionRecoveryComplete', [positionId]),
				read(portfolio, 'recoveryBounties', [positionId]),
			])
			const position = tuple(allocation, 4)
			if (typeof reusable !== 'boolean' || typeof recoveryComplete !== 'boolean') throw new Error('Invalid position reuse state.')
			const questionId = uint(position[0], 'Question id')
			return { positionId, questionId, custody: address(position[3]), ownerShares: uint(ownerShares, 'Position claim'), remainingShares: uint(position[2], 'Remaining position shares'), reusable, recoveryComplete, recoveryBountyAttoEth: uint(recoveryBounty, 'Recovery reward'), ...(await questionState(questionId)) }
		}),
	)
	const [latestBlock, latestChain] = await Promise.all([client.getBlock({ blockNumber }), client.getChainId()])
	if (latestBlock.hash !== blockHash || latestChain !== chainId) throw new Error('Chain changed while reading the portfolio. Refresh and try again.')
	return {
		portfolio,
		economics,
		questionAdmissionPolicy,
		ownershipChangeFeeAttoEth,
		maintenanceBudgetAttoEth,
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
		recoveryLedger,
		intervalCount,
		intervalCursor,
		nextIntervalCursor,
		intervals,
		recoverableRepAttoRep,
		recoverableFeesAttoEth,
		processingRewardsAttoEth,
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
	return { depositAttoRep: uint(values[0], 'Required REP'), purchaseFeeAttoEth: uint(values[1], 'Purchase fee'), availableAttoRep: uint(values[2], 'Available REP') }
}
