import { beforeAll, describe, expect, test } from 'bun:test'
import { encodeDeployData, encodeFunctionData, getAddress, type Address, type Hex } from '@zoltar/core-shared/evm/ethereum'
import { statoblast_SecurityPoolSettlementBook_SecurityPoolSettlementBook as bookArtifact, statoblast_SecurityPoolSettlement_SecurityPoolSettlement as custodyArtifact, test_statoblast_CollateralTestToken_CollateralTestToken as tokenArtifact } from '../types/contractArtifact'
import type { AnvilWindowEthereum } from '../testSupport/simulator/AnvilWindowEthereum'
import { useIsolatedAnvilNode } from '../testSupport/simulator/useIsolatedAnvilNode'
import { createWriteClient, type WriteClient } from '../testSupport/simulator/utils/clients'
import { TEST_ADDRESSES } from '../testSupport/simulator/utils/constants'
import { setupTestAccounts } from '../testSupport/simulator/utils/utilities'

// Custody fuzz of SecurityPoolSettlement around the settlement book, with real ERC20
// collateral and one recovery token per child universe. No reference model: after every accepted
// call the token balances held by the custody contract must equal the ledger's liabilities
// (book cash or unassigned fork cash, fee escrow, frozen books; live and frozen recovery REP),
// payouts must equal the ledger's figures, and no call may fail for lack of tokens or with a panic.
// The book's own arithmetic is checked by auditSettlementBookFuzz.test.ts.
// Long run: AUDIT_FUZZ_SEEDS=60 AUDIT_FUZZ_FIRST_SEED=1 AUDIT_FUZZ_STEPS=160 bun ./tooling/testing/bun-test.mts --timeout 3000000 solidity/ts/tests/auditSettlementCustodyFuzz.test.ts

const SEEDS = Number(process.env['AUDIT_FUZZ_SEEDS'] ?? '5')
const FIRST_SEED = Number(process.env['AUDIT_FUZZ_FIRST_SEED'] ?? '1')
const STEPS = Number(process.env['AUDIT_FUZZ_STEPS'] ?? '130')
const QUESTIONS = [1, 2, 3, 4] as const
const SCALE = 10n ** 18n
const START = 1_000
const RESPONSE = 259_200
const RECIPIENT: Address = '0x00000000000000000000000000000000000BeEF1'
const SUSPICIOUS = /SafeERC20Ops|Collateral transfer|Insufficient collateral|Insufficient allowance|[Pp]anic|arithmetic|division|0x11|0x12|0x32|predates|mismatch/

const makeRandom = (seed: number) => {
	let state = BigInt(seed) * 0x9e3779b97f4a7c15n + 1n
	const next = () => {
		state ^= (state << 13n) & 0xffffffffffffffffn
		state ^= state >> 7n
		state ^= (state << 17n) & 0xffffffffffffffffn
		return state & 0xffffffffffffffffn
	}
	return {
		int: (maxExclusive: number) => Number(next() % BigInt(maxExclusive)),
		big: (maxInclusive: bigint) => (maxInclusive <= 0n ? 0n : ((next() << 128n) | (next() << 64n) | next()) % (maxInclusive + 1n)),
		pick: <T>(items: readonly T[]): T => {
			const item = items[Number(next() % BigInt(items.length))]
			if (item === undefined) throw new Error('empty pick')
			return item
		},
	}
}

type Universe = { id: bigint; bookId: bigint; token: Address | undefined; isSealed: boolean; depth: number; children: number }

describe('audit fuzz: settlement custody holds exactly what the book owes', () => {
	const { getAnvilWindowEthereum } = useIsolatedAnvilNode()
	let client: WriteClient
	let ethereum: AnvilWindowEthereum
	let baseline = ''

	beforeAll(async () => {
		ethereum = getAnvilWindowEthereum()
		client = createWriteClient(ethereum, TEST_ADDRESSES[0])
	})

	const runSeed = async (seed: number): Promise<string | undefined> => {
		let accepted = 0
		await ethereum.anvilRevert(baseline)
		baseline = await ethereum.anvilSnapshot()
		const random = makeRandom(seed)
		const owner = client.account.address
		const history: string[] = []
		const transact = async (to: Address | undefined, data: Hex): Promise<Address | undefined> => {
			const request = { from: owner, ...(to === undefined ? {} : { to }), data, gas: '0x1000000', gasPrice: '0x0' }
			const hash = await ethereum.requestRaw({ method: 'eth_sendTransaction', params: [request] })
			for (let attempt = 0; attempt < 20_000; attempt++) {
				const mined = await ethereum.requestRaw({ method: 'eth_getTransactionReceipt', params: [hash] }).catch(() => undefined)
				if (typeof mined === 'object' && mined !== null && 'status' in mined) {
					if (mined.status === '0x1') return 'contractAddress' in mined && typeof mined.contractAddress === 'string' ? getAddress(mined.contractAddress) : undefined
					const reason = await ethereum.requestRaw({ method: 'eth_call', params: [request, 'latest'] }).then(
						() => 'reverted on chain (replay succeeds)',
						error => String(error instanceof Error ? error.message : error),
					)
					throw new Error(reason)
				}
				await new Promise(resolve => setTimeout(resolve, 1))
			}
			throw new Error('no receipt')
		}
		const deployToken = async () => {
			const address = await transact(undefined, encodeDeployData({ abi: tokenArtifact.abi, bytecode: `0x${tokenArtifact.evm.bytecode.object}`, args: [18, false] }))
			if (address === undefined) throw new Error('token deployment failed')
			return address
		}
		const minimum = random.pick([1n, SCALE / 2n, (SCALE * 9n) / 10n, 333_333_333_333_333_333n])
		const collateral = await deployToken()
		const custody = await transact(undefined, encodeDeployData({ abi: custodyArtifact.abi, bytecode: `0x${custodyArtifact.evm.bytecode.object}`, args: [owner, collateral] }))
		if (custody === undefined) throw new Error('custody deployment failed')
		const ledger = await transact(undefined, encodeDeployData({ abi: bookArtifact.abi, bytecode: `0x${bookArtifact.evm.bytecode.object}`, args: [custody, minimum, 1n] }))
		if (ledger === undefined) throw new Error('ledger deployment failed')
		const custodyTarget = { abi: custodyArtifact.abi, address: custody }
		const ledgerTarget = { abi: bookArtifact.abi, address: ledger }
		const call = (data: Hex) => transact(custody, data)
		await call(encodeFunctionData({ abi: custodyArtifact.abi, functionName: 'initialize', args: [ledger] }))
		// The owner acts as both security pool and Services: earned fees accrue as pending service income in custody.
		await call(encodeFunctionData({ abi: custodyArtifact.abi, functionName: 'authorizeServices', args: [owner] }))
		await transact(collateral, encodeFunctionData({ abi: tokenArtifact.abi, functionName: 'mint', args: [owner, 1n << 200n] }))
		await transact(collateral, encodeFunctionData({ abi: tokenArtifact.abi, functionName: 'approve', args: [custody, (1n << 256n) - 1n] }))
		await call(encodeFunctionData({ abi: custodyArtifact.abi, functionName: 'registerUniverse', args: [0n, START] }))
		const universes: Universe[] = [{ id: 0n, bookId: 1n, token: undefined, isSealed: false, depth: 0, children: 0 }]
		const pool = (universe: bigint, question: number): Address => `0x${(0x1000n + universe * 16n + BigInt(question)).toString(16).padStart(40, '0')}`
		for (const question of QUESTIONS) await call(encodeFunctionData({ abi: custodyArtifact.abi, functionName: 'registerQuestion', args: [pool(0n, question), 0n, BigInt(question)] }))

		const balance = (token: Address, holder: Address) => client.readContract({ abi: tokenArtifact.abi, address: token, functionName: 'balanceOf', args: [holder] })
		const readBook = async (bookId: bigint) => {
			const value = await client.readContract({ ...ledgerTarget, functionName: 'books', args: [bookId] })
			return { cash: value[0], units: value[1], feeCash: value[2], ts: Number(value[6]), isSealed: value[7], enabled: value[11], minimumFinalAfter: Number(value[12]), offset: Number(value[13]), rec: value[15] }
		}

		// Token balances held by custody must equal the ledger's liabilities.
		const checkCustody = async (): Promise<string | undefined> => {
			const frozenCount = Number(await client.readContract({ ...ledgerTarget, functionName: 'lastFrozenBookId' }))
			const frozen = await Promise.all(Array.from({ length: frozenCount }, (_unused, index) => client.readContract({ ...ledgerTarget, functionName: 'frozenBooks', args: [BigInt(index + 1)] })))
			let owedCash = await client.readContract({ ...custodyTarget, functionName: 'pendingServiceFees' })
			for (const entry of frozen) owedCash += entry[0]
			for (const universe of universes) {
				const book = await readBook(universe.bookId)
				if (book.feeCash !== 0n) return `universe ${universe.id}: fee escrow ${book.feeCash} was not forwarded`
				if (book.isSealed !== universe.isSealed) return `universe ${universe.id}: sealed flag differs`
				const available = (await client.readContract({ ...custodyTarget, functionName: 'universes', args: [universe.id] }))[2]
				if (book.isSealed && available > book.cash) return `universe ${universe.id}: unassigned fork cash ${available} exceeds sealed book cash ${book.cash}`
				owedCash += book.isSealed ? available : book.cash
				if (universe.token === undefined) {
					if (book.rec !== 0n) return `universe ${universe.id}: recovery REP ${book.rec} without a recovery token`
					continue
				}
				let owedRep = book.isSealed ? (await client.readContract({ ...custodyTarget, functionName: 'universes', args: [universe.id] }))[3] : book.rec
				for (const entry of frozen) if (entry[2] === universe.bookId) owedRep += entry[3]
				const heldRep = await balance(universe.token, custody)
				if (heldRep !== owedRep) return `universe ${universe.id}: REP CUSTODY holds ${heldRep} but owes ${owedRep}`
			}
			const held = await balance(collateral, custody)
			if (held !== owedCash) return `CASH CUSTODY holds ${held} but the ledger owes ${owedCash} (difference ${held - owedCash})`
			return undefined
		}

		// Sends one custody call; ledger rejections are fine, token shortfalls and panics are not.
		const attempt = async (description: string, data: Hex, after?: () => Promise<string | undefined>): Promise<string | undefined> => {
			history.push(description)
			try {
				await call(data)
			} catch (error) {
				const reason = String(error instanceof Error ? error.message : error).slice(0, 300)
				if (SUSPICIOUS.test(reason)) return `SUSPICIOUS REVERT in ${description}: ${reason}\n    ${history.slice(-25).join('\n    ')}`
				return undefined
			}
			accepted++
			const problem = (await after?.()) ?? (await checkCustody())
			return problem === undefined ? undefined : `${problem}\n  after ${description}\n    ${history.slice(-25).join('\n    ')}`
		}

		const redeem = async (universe: Universe, question: number, shares: bigint, ts: number): Promise<string | undefined> => {
			const token = universe.token
			const before = await Promise.all([
				balance(collateral, RECIPIENT),
				token === undefined ? 0n : balance(token, RECIPIENT),
				client.readContract({ ...custodyTarget, functionName: 'quoteRedemption', args: [pool(universe.id, question), shares] }).catch(() => undefined),
				client.readContract({ ...custodyTarget, functionName: 'quoteRecoveryRep', args: [pool(universe.id, question), shares] }).catch(() => undefined),
				readBook(universe.bookId),
			])
			const data = encodeFunctionData({ abi: custodyArtifact.abi, functionName: 'redeem', args: [pool(universe.id, question), RECIPIENT, shares, ts] })
			const simulated = await client.simulateContract({ ...custodyTarget, functionName: 'redeem', args: [pool(universe.id, question), RECIPIENT, shares, ts] }).then(
				value => value.result[0],
				() => undefined,
			)
			return attempt(`redeem u${universe.id} q${question} shares ${shares} ts ${ts}`, data, async () => {
				const paidCash = (await balance(collateral, RECIPIENT)) - before[0]
				const paidRep = token === undefined ? 0n : (await balance(token, RECIPIENT)) - before[1]
				if (simulated !== undefined && paidCash !== simulated) return `redeem paid ${paidCash} but returned ${simulated}`
				// Without a clock advance the public quotes must equal the executed payout.
				if (ts === before[4].ts && before[2] !== undefined && before[2] !== paidCash) return `quoteRedemption ${before[2]} != paid ${paidCash}`
				if (ts === before[4].ts && before[3] !== undefined && before[3] !== paidRep) return `quoteRecoveryRep ${before[3]} != paid ${paidRep}`
				return undefined
			})
		}

		for (let step = 0; step < STEPS; step++) {
			const universe = random.pick(universes)
			const book = await readBook(universe.bookId)
			const question = random.pick(QUESTIONS)
			const [state, frozenBookId] = await client.readContract({ ...ledgerTarget, functionName: 'question', args: [universe.bookId, BigInt(question)] })
			const supply = state.outcomeSupplyAttoShares
			const ts = book.ts + random.pick([0, 0, 0, 1, 1, 2, 5, 30, 1_000, 86_400, RESPONSE, RESPONSE + 1])
			const clock = ts + book.offset
			const poolAddress = pool(universe.id, question)
			let problem: string | undefined
			if (universe.isSealed) {
				const choice = random.int(20)
				const available = (await client.readContract({ ...custodyTarget, functionName: 'universes', args: [universe.id] }))[2]
				if (choice < 7 && universes.length < 7 && universe.children < 3) {
					const childId = BigInt(universes.length)
					const token = await deployToken()
					const contribution = random.pick([0n, available, available / 2n, random.big(available)])
					const room = book.units > contribution ? book.units - contribution : 0n
					const auction = random.pick([0n, room, room, room / 2n, random.big(room), room === 0n ? 0n : room - 1n])
					const recovery = book.rec + (book.units === 0n || random.int(2) === 0 ? 0n : random.pick([1n, 10n ** 18n + random.big(10n ** 18n), 7n * 10n ** 24n]))
					await transact(token, encodeFunctionData({ abi: tokenArtifact.abi, functionName: 'mint', args: [owner, recovery] }))
					await transact(token, encodeFunctionData({ abi: tokenArtifact.abi, functionName: 'approve', args: [custody, (1n << 256n) - 1n] }))
					const created = universes.length
					problem = await attempt(
						`createChildUniverse u${universe.id} -> u${childId} contribution ${contribution} auction ${auction} recovery ${recovery}`,
						encodeFunctionData({ abi: custodyArtifact.abi, functionName: 'createChildUniverse', args: [universe.id, childId, contribution, token, recovery, auction] }),
						async () => {
							const bookId = await client.readContract({ ...custodyTarget, functionName: 'bookIds', args: [childId] })
							universes.push({ id: childId, bookId, token, isSealed: false, depth: universe.depth + 1, children: 0 })
							universe.children++
							for (const id of QUESTIONS) await call(encodeFunctionData({ abi: custodyArtifact.abi, functionName: 'registerQuestion', args: [pool(childId, id), childId, BigInt(id)] }))
							return checkCustody()
						},
					)
					if (problem === undefined && universes.length > created && random.int(2) === 0) {
						const child = universes[created]
						if (child !== undefined) problem = await attempt(`fixInheritedQuestionFinality u${childId} q${question}`, encodeFunctionData({ abi: custodyArtifact.abi, functionName: 'fixInheritedQuestionFinality', args: [childId, BigInt(question), book.ts + RESPONSE] }))
					}
				} else if (choice < 10) {
					const amount = random.pick([available, random.big(available), available + 1n])
					const before = await balance(collateral, owner)
					problem = await attempt(`withdrawForkRecoveryCash u${universe.id} ${amount} of ${available}`, encodeFunctionData({ abi: custodyArtifact.abi, functionName: 'withdrawForkRecoveryCash', args: [universe.id, amount] }), async () =>
						(await balance(collateral, owner)) - before === amount ? checkCustody() : 'fork recovery cash not received',
					)
				} else if (choice < 12) problem = await attempt(`withdrawForkRecoveryRep u${universe.id}`, encodeFunctionData({ abi: custodyArtifact.abi, functionName: 'withdrawForkRecoveryRep', args: [universe.id] }))
				else if (choice < 18) problem = await redeem(universe, question, supply === 0n ? 1n : random.pick([supply, random.big(supply - 1n) + 1n]), book.ts)
				else if (choice < 19) problem = await attempt(`checkpointQuestion sealed u${universe.id} q${question}`, encodeFunctionData({ abi: custodyArtifact.abi, functionName: 'checkpointQuestion', args: [poolAddress, book.ts] }))
				else problem = await attempt(`checkpointUniverse sealed u${universe.id}`, encodeFunctionData({ abi: custodyArtifact.abi, functionName: 'checkpointUniverse', args: [universe.id, book.ts] }))
			} else {
				const choice = random.int(100)
				if (choice < 20) {
					const cash = random.pick([1n, 7n, 1000n, 10n ** 9n, 10n ** 18n, 3n * 10n ** 20n]) + random.big(1000n)
					// Services funds custody only for a mint the ledger accepts.
					const accepts = await client.simulateContract({ ...custodyTarget, functionName: 'mintWithRecoveryRep', args: [poolAddress, owner, cash, 0n, ts] }).then(
						() => true,
						() => false,
					)
					if (accepts) await transact(collateral, encodeFunctionData({ abi: tokenArtifact.abi, functionName: 'transfer', args: [custody, cash] }))
					problem = await attempt(`mint u${universe.id} q${question} ${cash} ts ${ts}`, encodeFunctionData({ abi: custodyArtifact.abi, functionName: 'mintWithRecoveryRep', args: [poolAddress, owner, cash, 0n, ts] }))
				} else if (choice < 38) problem = await redeem(universe, question, supply === 0n ? 1n : random.pick([supply, random.big(supply - 1n) + 1n, random.big(supply - 1n) + 1n, 1n]), random.int(3) === 0 ? book.ts : ts)
				else if (choice < 54) {
					const floor = (supply * minimum + SCALE - 1n) / SCALE
					const budget = state.units > floor ? state.units - floor : 0n
					let rate = random.pick([0n, 1n, budget / BigInt(random.pick([1, 3, 50, 1_000, 100_000])) + 1n, random.big(budget)])
					if (rate >= 1n << 96n) rate = (1n << 96n) - 1n
					problem = await attempt(`replaceFeeStream u${universe.id} q${question} rate ${rate} ts ${ts}`, encodeFunctionData({ abi: custodyArtifact.abi, functionName: 'replaceFeeStream', args: [poolAddress, rate, clock + random.pick([1, 5, 60, 5_000, 300_000]), ts] }))
				} else if (choice < 64) {
					const finalAfter = random.pick([0, 0, ts, ts + 1, ts + 5, ts + 1_000, ts + RESPONSE, ts + 300_000])
					problem = await attempt(`scheduleFinality u${universe.id} q${question} finalAfter ${finalAfter} ts ${ts} (frozen ${frozenBookId})`, encodeFunctionData({ abi: custodyArtifact.abi, functionName: 'scheduleFinality', args: [poolAddress, finalAfter, ts] }))
				} else if (choice < 74) problem = await attempt(`checkpointUniverse u${universe.id} ts ${ts}`, encodeFunctionData({ abi: custodyArtifact.abi, functionName: 'checkpointUniverse', args: [universe.id, ts] }))
				else if (choice < 80) problem = await attempt(`checkpointQuestion u${universe.id} q${question} ts ${ts}`, encodeFunctionData({ abi: custodyArtifact.abi, functionName: 'checkpointQuestion', args: [poolAddress, ts] }))
				else if (choice < 88) problem = await attempt(`setFeesEnabled u${universe.id} ${!book.enabled} ts ${ts}`, encodeFunctionData({ abi: custodyArtifact.abi, functionName: 'setFeesEnabled', args: [universe.id, !book.enabled || random.int(3) === 0, ts] }))
				else if (choice < 92) problem = await attempt(`setFeeClock u${universe.id}`, encodeFunctionData({ abi: custodyArtifact.abi, functionName: 'setFeeClock', args: [universe.id, book.ts + book.offset + random.pick([0, 1, 3_000])] }))
				else if (step >= 20 * (universe.depth + 1) && universe.depth <= 1 && universes.length <= 5)
					problem = await attempt(`sealUniverse u${universe.id} ts ${ts}`, encodeFunctionData({ abi: custodyArtifact.abi, functionName: 'sealUniverse', args: [universe.id, ts] }), async () => {
						universe.isSealed = true
						return checkCustody()
					})
			}
			if (problem !== undefined) return `seed ${seed} (minimum rate ${minimum}): ${problem}`
		}
		// Drain: every payable claim is redeemed; custody must then hold only unassigned fork cash and pending service fees.
		for (const universe of universes) {
			const book = await readBook(universe.bookId)
			let ts = book.ts
			if (!universe.isSealed) {
				ts = book.ts + 2_000_000
				const problem = await attempt(`drain checkpoint u${universe.id} ts ${ts}`, encodeFunctionData({ abi: custodyArtifact.abi, functionName: 'checkpointUniverse', args: [universe.id, ts] }))
				if (problem !== undefined) return `seed ${seed}: ${problem}`
			}
			for (const question of QUESTIONS) {
				const [state, frozenBookId] = await client.readContract({ ...ledgerTarget, functionName: 'question', args: [universe.bookId, BigInt(question)] })
				if (state.outcomeSupplyAttoShares === 0n) continue
				const source = frozenBookId === 0n ? undefined : (await client.readContract({ ...ledgerTarget, functionName: 'frozenBooks', args: [frozenBookId] }))[2]
				const payable = source === undefined ? !universe.isSealed : source === universe.bookId
				if (!payable) continue
				const acceptedBefore = accepted
				const problem = await redeem(universe, question, state.outcomeSupplyAttoShares, ts)
				if (problem !== undefined) return `seed ${seed}: ${problem}`
				if (accepted === acceptedBefore) return `seed ${seed}: LOCKED FUNDS: payable claim u${universe.id} q${question} could not be redeemed\n    ${history.slice(-25).join('\n    ')}`
			}
		}
		let unassigned = await client.readContract({ ...custodyTarget, functionName: 'pendingServiceFees' })
		for (const universe of universes) if (universe.isSealed) unassigned += (await client.readContract({ ...custodyTarget, functionName: 'universes', args: [universe.id] }))[2]
		const left = await balance(collateral, custody)
		if (left !== unassigned) return `seed ${seed}: after the drain custody holds ${left} but only ${unassigned} is unassigned fork cash or pending service fees`
		return undefined
	}

	test('custody balances equal ledger liabilities after every accepted call', async () => {
		await setupTestAccounts(ethereum)
		await ethereum.advanceTime(50_000_000n)
		baseline = await ethereum.anvilSnapshot()
		const failures: string[] = []
		for (let seed = FIRST_SEED; seed < FIRST_SEED + SEEDS; seed++) {
			const failure = await runSeed(seed).catch(error => `seed ${seed}: ${String(error instanceof Error ? error.message : error)}`)
			if (failure !== undefined) {
				failures.push(failure)
				console.log(failure)
				if (failures.length >= 2) break
			}
		}
		expect(failures).toEqual([])
	})
})
