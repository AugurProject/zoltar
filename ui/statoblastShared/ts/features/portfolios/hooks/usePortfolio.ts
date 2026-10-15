import { useSignal } from '@preact/signals'
import { useEffect, useRef } from 'preact/hooks'
import { getAddress, isAddress, parseAbi, zeroAddress, type Address } from '@zoltar/core-shared/evm/ethereum'
import { loadPortfolioSnapshot, type PortfolioSnapshot, type PortfolioOperationStatus } from '@zoltar/statoblast-shared/statoblast/securityPoolPortfolio'
import { createActiveEnvironmentGuard, getActiveBackend } from '@zoltar/ui-core-shared/lib/activeEnvironment.js'
import { createConnectedReadClient } from '@zoltar/ui-core-shared/wallet/clients.js'
import { useBlockRefresh } from '@zoltar/ui-core-shared/hooks/useDataRefresh.js'
import { getErrorMessage } from '@zoltar/ui-core-shared/lib/errors.js'
import { discoverSimulationPortfolio, loadPortfolioOwnerVault, portfolioReadClient } from '../../../protocol/securityPoolPortfolio.js'
import { isPortfolioPositionVisible, isVaultAuthorizedPortfolioOperation, mergeTrackedPortfolioOperations, parsePortfolioPreferences, parseTrackedPortfolioOperations, portfolioOperationKey, portfolioStorageKey, type PortfolioPreferences, type PortfolioScope, type TrackedPortfolioOperation } from '../lib/preferences.js'
import { currentPortfolioOperationStatus, getCanonicalPortfolioObservationKeys, loadTrackedPortfolioOperationStatus } from '../lib/history.js'
import * as copy from '../../../copy/portfolio.js'

const positionPageSize = 64n
const registrySeedAbi = parseAbi(['function getQuestions(uint256,uint256) view returns (uint256[])'])

export type PortfolioHistoryEntry = TrackedPortfolioOperation & { result: PortfolioOperationStatus }
export type PortfolioSelection = { portfolio: Address; owner: Address; vault: Address; originUniverseId: bigint }

function readLocal(key: string) {
	try {
		return window.localStorage.getItem(key)
	} catch (failure) {
		if (!(failure instanceof DOMException) || failure.name !== 'SecurityError') throw failure
		return null
	}
}
export function usePortfolio({ accountAddress, enabled, environmentKey, activeUniverseId }: { accountAddress: Address | undefined; enabled: boolean; environmentKey: number; activeUniverseId: bigint }) {
	const initial = new URLSearchParams(window.location.hash.split('?')[1])
	const managerInput = useSignal(initial.get('portfolio') ?? '')
	const ownerInput = useSignal(initial.get('owner') ?? accountAddress ?? '')
	const branchInput = useSignal('')
	const questionFilter = useSignal('')
	const watchlistOnly = useSignal(false)
	const positionPage = useSignal(0n)
	const positionPageCount = useSignal(1n)
	const snapshot = useSignal<PortfolioSnapshot | undefined>(undefined)
	const selection = useSignal<PortfolioSelection | undefined>(undefined)
	const preferences = useSignal<PortfolioPreferences>(parsePortfolioPreferences(null))
	const scope = useSignal<PortfolioScope | undefined>(undefined)
	const history = useSignal<PortfolioHistoryEntry[]>([])
	const historyWarning = useSignal<string | undefined>(undefined)
	const loading = useSignal(false)
	const error = useSignal<string | undefined>(undefined)
	const generation = useRef(0)
	const active = useRef(true)
	const refreshing = useRef<number | undefined>(undefined)
	const historyRefreshing = useRef(false)
	const unsavedPreferences = useRef<{ key: string; value: PortfolioPreferences } | undefined>(undefined)
	const cachedHistory = useRef<{ key: string; entries: TrackedPortfolioOperation[] } | undefined>(undefined)
	const writeLocal = (key: string, value: unknown) => {
		try {
			window.localStorage.setItem(key, JSON.stringify(value))
			return true
		} catch (failure) {
			if (!(failure instanceof DOMException) || !['QuotaExceededError', 'SecurityError'].includes(failure.name)) throw failure
			historyWarning.value = copy.historyStorageUnavailable
			return false
		}
	}
	const readPreferences = (key: string) => (unsavedPreferences.current?.key === key ? unsavedPreferences.current.value : parsePortfolioPreferences(readLocal(key)))
	const rememberPreferences = (key: string, value: PortfolioPreferences) => {
		preferences.value = value
		unsavedPreferences.current = writeLocal(key, value) ? undefined : { key, value }
	}
	useEffect(
		() => () => {
			active.current = false
			generation.current += 1
		},
		[],
	)

	const load = async (managerOverride?: string, ownerOverride?: string, universeOverride?: bigint[], pageOverride?: bigint) => {
		const requestedQuestions = questionFilter.value.trim()
		const previousScope = scope.value
		const requestedPage = pageOverride ?? positionPage.value
		const requestId = ++generation.current
		refreshing.current = requestId
		const environment = createActiveEnvironmentGuard()
		const current = () => active.current && requestId === generation.current && environment.isCurrent()
		loading.value = true
		error.value = undefined
		historyWarning.value = undefined
		try {
			const portfolio = getAddress((managerOverride ?? managerInput.value).trim())
			const owner = getAddress((ownerOverride ?? ownerInput.value).trim())
			const client = createConnectedReadClient()
			const chainId = await client.getChainId()
			const nextScope = { backend: getActiveBackend().id, chainId: String(chainId), portfolio, owner }
			const preferencesKey = portfolioStorageKey(nextScope, 'preferences')
			const nextPreferences = readPreferences(preferencesKey)
			const details = await loadPortfolioOwnerVault(client, portfolio, owner)
			if (!current()) return
			const nextSelection = { portfolio, owner, ...details }
			selection.value = nextSelection
			scope.value = nextScope
			managerInput.value = portfolio
			ownerInput.value = owner
			writeLocal(`statoblast:portfolio:last:${nextScope.backend}:${chainId}`, portfolio)
			if (details.vault === zeroAddress) {
				snapshot.value = undefined
				history.value = []
				return
			}
			const universeIds = [...new Set([details.originUniverseId, activeUniverseId, ...(universeOverride ?? nextPreferences.universeIds.map(id => BigInt(id)))])]
			const historyKey = portfolioStorageKey(nextScope, 'operations')
			const savedHistory = parseTrackedPortfolioOperations(readLocal(historyKey))
			const stored = cachedHistory.current?.key === historyKey ? mergeTrackedPortfolioOperations(savedHistory, cachedHistory.current.entries) : savedHistory
			const sameScope = previousScope === undefined || portfolioStorageKey(previousScope, 'preferences') === portfolioStorageKey(nextScope, 'preferences')
			let selected = sameScope && requestedQuestions !== '' ? requestedQuestions.split(',').map(id => String(BigInt(id.trim()))) : nextPreferences.selectedQuestionIds
			let scopedQuestions = [...new Set([...selected, ...nextPreferences.watchedQuestionIds, ...nextPreferences.knownPositionQuestionIds, ...stored.map(operation => operation.questionId)])].map(id => BigInt(id))
			if (scopedQuestions.length === 0) {
				// The first entry is fixed at construction; permissionless additions cannot change this bootstrap read.
				const seed = await client.readContract({ address: portfolio, abi: registrySeedAbi, functionName: 'getQuestions', args: [0n, 1n] })
				if (!current()) return
				if (Array.isArray(seed) && seed.length === 0) {
					snapshot.value = undefined
					history.value = []
					return
				}
				if (!Array.isArray(seed) || seed.length !== 1 || typeof seed[0] !== 'bigint') throw new Error('Portfolio is missing its initial question.')
				scopedQuestions = [seed[0]]
				selected = [String(seed[0])]
			}
			const page = sameScope ? requestedPage : 0n
			const start = page * positionPageSize
			const questionIds = scopedQuestions.slice(Number(start), Number(start + positionPageSize))
			const next = await loadPortfolioSnapshot({ client: portfolioReadClient(client), portfolio, vault: details.vault, universeIds, questionIds, allocatedQuestionStart: start, maximumAllocatedQuestions: Number(positionPageSize) })
			if (scopedQuestions.length > Number(positionPageSize)) next.coverage.complete = false

			if (!current()) return
			positionPage.value = page
			const allocatedCount = next.allocatedQuestionPage?.total ?? 0n
			const questionCount = BigInt(scopedQuestions.length) > allocatedCount ? BigInt(scopedQuestions.length) : allocatedCount
			positionPageCount.value = (questionCount + positionPageSize - 1n) / positionPageSize || 1n
			const knownPositions = next.branches.flatMap(branch => branch.positions.filter(position => isPortfolioPositionVisible(false, { ...position, disputeStakedAttoRep: position.disputeStakeAttoRep, pendingCount: position.queuedOperations.length })).map(position => String(position.questionId)))
			const latestPreferences = readPreferences(preferencesKey)
			const savedPreferences = { ...latestPreferences, selectedQuestionIds: selected, knownPositionQuestionIds: [...new Set([...latestPreferences.knownPositionQuestionIds, ...knownPositions])] }
			rememberPreferences(preferencesKey, savedPreferences)
			questionFilter.value = selected.join(', ')

			const discovered = next.branches.flatMap(branch =>
				branch.positions.flatMap(position =>
					position.queuedOperations.map(operation => ({
						coordinator: position.coordinator,
						operationId: String(operation.operationId),
						operation: String(operation.operationType),
						fromBlock: String(next.blockNumber),
						observation: { blockNumber: String(next.blockNumber), blockHash: next.blockHash, vault: next.vault, operator: operation.operator, receiverVault: operation.receiverVault, targetVault: operation.targetVault, queuedAt: String(operation.queuedAt), validForSeconds: String(operation.validForSeconds) },
						pool: position.pool,
						universeId: String(branch.universeId),
						questionId: String(position.questionId),
					})),
				),
			)
			const positions = next.branches.flatMap(branch => branch.positions)
			const positionFor = (entry: TrackedPortfolioOperation) => positions.find(position => position.coordinator.toLowerCase() === entry.coordinator.toLowerCase())
			const liveAuthorized = discovered.filter(isVaultAuthorizedPortfolioOperation)
			const includeLiveAuthorized = (entries: TrackedPortfolioOperation[]) => [...entries, ...liveAuthorized.filter(live => !entries.some(entry => entry.coordinator.toLowerCase() === live.coordinator.toLowerCase() && entry.operationId === live.operationId))]
			history.value = includeLiveAuthorized(mergeTrackedPortfolioOperations([], discovered)).map(entry => ({ ...entry, result: currentPortfolioOperationStatus(entry, next, positionFor(entry)) ?? { status: 'unknown' } }))
			snapshot.value = next
			loading.value = false
			// History is optional enrichment. A stalled provider must not block balances or their next refresh.
			if (!historyRefreshing.current) {
				historyRefreshing.current = true
				void (async () => {
					const canonicalObservationKeys = await getCanonicalPortfolioObservationKeys(client, stored)
					if (!current()) return
					const tracked = mergeTrackedPortfolioOperations(stored, discovered, canonicalObservationKeys)
					cachedHistory.current = { key: historyKey, entries: tracked }
					writeLocal(historyKey, tracked)
					const nextHistory = await Promise.all(includeLiveAuthorized(tracked).map(async entry => ({ ...entry, result: await loadTrackedPortfolioOperationStatus(client, entry, next, positionFor(entry)) })))
					if (current()) history.value = nextHistory
				})()
					.catch(failure => {
						if (current()) historyWarning.value = getErrorMessage(failure, copy.historyFailed)
					})
					.finally(() => {
						historyRefreshing.current = false
					})
			}
		} catch (failure) {
			if (current()) {
				error.value = getErrorMessage(failure, copy.snapshotFailed)
				if (pageOverride === undefined) snapshot.value = undefined
			}
		} finally {
			if (current()) loading.value = false
			if (refreshing.current === requestId) refreshing.current = undefined
		}
	}
	const changePositionPage = async (page: bigint) => {
		if (loading.value || page < 0n || page >= positionPageCount.value) return
		await load(undefined, undefined, undefined, page)
	}
	const refresh = async () => {
		if (!enabled || refreshing.current === generation.current || !isAddress(managerInput.value) || !isAddress(ownerInput.value)) return
		await load()
	}
	useBlockRefresh(() => {
		void refresh()
	}, enabled)
	useEffect(() => {
		generation.current += 1
		snapshot.value = undefined
		selection.value = undefined
		positionPage.value = 0n
		positionPageCount.value = 1n
		history.value = []
		historyWarning.value = undefined
		loading.value = false
		if (!enabled) return
		const backend = getActiveBackend()
		if (managerInput.value === '') {
			const previous: unknown = (() => {
				try {
					return JSON.parse(readLocal(`statoblast:portfolio:last:${backend.id}:${backend.profile.chain.id}`) ?? 'null')
				} catch (failure) {
					if (!(failure instanceof SyntaxError)) throw failure
					return undefined
				}
			})()
			if (typeof previous === 'string' && isAddress(previous)) managerInput.value = previous
		}
		if (ownerInput.value === '' && accountAddress !== undefined) ownerInput.value = accountAddress
		let current = true
		const discoverAndRefresh = async () => {
			const selectedOwner = ownerInput.value
			if (managerInput.value === '' && backend.id === 'simulation' && isAddress(selectedOwner)) {
				const portfolio = await discoverSimulationPortfolio(createConnectedReadClient(), backend.id, getAddress(selectedOwner))
				if (!current || managerInput.value !== '' || ownerInput.value !== selectedOwner) return
				if (portfolio !== undefined) managerInput.value = portfolio
			}
			if (current) await refresh()
		}
		void discoverAndRefresh().catch(failure => {
			if (current) error.value = getErrorMessage(failure, copy.snapshotFailed)
		})
		return () => {
			current = false
		}
	}, [enabled, environmentKey, activeUniverseId, accountAddress])
	useEffect(() => {
		if (ownerInput.value === '' && accountAddress !== undefined) {
			ownerInput.value = accountAddress
			void refresh()
		}
	}, [accountAddress])
	useEffect(() => {
		if (!enabled || !isAddress(managerInput.value) || !isAddress(ownerInput.value)) return
		const timer = setTimeout(() => {
			void refresh()
		}, 250)
		return () => clearTimeout(timer)
	}, [enabled, managerInput.value, ownerInput.value, questionFilter.value])
	const changeInput = (kind: 'manager' | 'owner', value: string) => {
		generation.current += 1
		snapshot.value = undefined
		selection.value = undefined
		positionPage.value = 0n
		positionPageCount.value = 1n
		history.value = []
		loading.value = false
		questionFilter.value = ''
		preferences.value = parsePortfolioPreferences(null)
		if (kind === 'manager') managerInput.value = value
		else ownerInput.value = value
	}
	useEffect(() => {
		const updateRouteSelection = () => {
			const query = new URLSearchParams(window.location.hash.split('?')[1])
			const portfolio = query.get('portfolio')
			const owner = query.get('owner')
			if (portfolio !== null && portfolio !== managerInput.value) changeInput('manager', portfolio)
			if (owner !== null && owner !== ownerInput.value) changeInput('owner', owner)
		}
		window.addEventListener('hashchange', updateRouteSelection)
		return () => window.removeEventListener('hashchange', updateRouteSelection)
	}, [])
	const savePreferences = (next: PortfolioPreferences) => {
		if (scope.value === undefined) return
		rememberPreferences(portfolioStorageKey(scope.value, 'preferences'), next)
	}
	const toggleWatch = (questionId: bigint) => {
		const id = String(questionId)
		const watched = preferences.value.watchedQuestionIds
		savePreferences({ ...preferences.value, watchedQuestionIds: watched.includes(id) ? watched.filter(value => value !== id) : [...watched, id] })
	}
	const addBranch = async () => {
		try {
			if (!/^\d+$/.test(branchInput.value)) throw new Error('Enter a valid universe ID.')
			const id = BigInt(branchInput.value)
			if (id >= 1n << 248n) throw new Error('Universe ID is too large.')
			const ids = [...new Set([...preferences.value.universeIds, String(id)])]
			if (ids.length > 16) throw new Error('Track at most 16 additional universes.')
			savePreferences({ ...preferences.value, universeIds: ids })
			await load(
				undefined,
				undefined,
				ids.map(value => BigInt(value)),
			)
		} catch (failure) {
			error.value = getErrorMessage(failure, copy.failure)
		}
	}
	return {
		positionPage: positionPage.value,
		positionPageCount: positionPageCount.value,
		nextPositionPage: () => changePositionPage(positionPage.value + 1n),
		previousPositionPage: () => changePositionPage(positionPage.value - 1n),
		watchlistOnly: watchlistOnly.value,
		setWatchlistOnly: (value: boolean) => {
			watchlistOnly.value = value
		},
		questionFilter: questionFilter.value,
		setQuestionFilter: (value: string) => {
			questionFilter.value = value
			positionPage.value = 0n
			generation.current += 1
			snapshot.value = undefined
			loading.value = false
		},
		managerInput: managerInput.value,
		ownerInput: ownerInput.value,
		branchInput: branchInput.value,
		setBranchInput: (value: string) => {
			branchInput.value = value
		},
		setManagerInput: (value: string) => changeInput('manager', value),
		setOwnerInput: (value: string) => changeInput('owner', value),
		snapshot: snapshot.value,
		selection: selection.value,
		preferences: preferences.value,
		history: history.value.map(entry => ({ ...entry, key: portfolioOperationKey(entry) })),
		historyWarning: historyWarning.value,
		loading: loading.value,
		error: error.value,
		load,
		refresh,
		toggleWatch,
		addBranch,
	}
}
