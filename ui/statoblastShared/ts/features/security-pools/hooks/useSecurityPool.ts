import { statoblastPageCache } from '../../../protocol/statoblastPageCache.js'
import { getMulticall3Address } from '@zoltar/ui-zoltar-shared/protocol/zoltarDeploymentHelpers.js'
import { useSignal } from '@preact/signals'
import { useEffect, useRef } from 'preact/hooks'
import { getAddress, isAddress, zeroAddress, type Address } from '@zoltar/core-shared/evm/ethereum'
import { createActiveEnvironmentGuard, getActiveBackend } from '@zoltar/ui-core-shared/lib/activeEnvironment.js'
import { createConnectedReadClient } from '@zoltar/ui-core-shared/wallet/clients.js'
import { useBlockRefresh } from '@zoltar/ui-core-shared/hooks/useDataRefresh.js'
import { withTimeout } from '@zoltar/ui-core-shared/lib/promise.js'
import { getErrorMessage } from '@zoltar/ui-core-shared/lib/errors.js'
import { loadSecurityPoolAccount, loadSecurityPoolSetup, type SecurityPoolSetupSnapshot, type SecurityPoolAccountSnapshot } from '../../../protocol/securityPool.js'
import { securityPoolUnsignedId } from '../lib/draft.js'

function securityPoolStorageKey(chainId: number) {
	const backend = getActiveBackend()
	return `statoblast:securityPool:last:${backend.id}:${chainId}:${backend.profile.genesisRepTokenAddress.toLowerCase()}`
}

/** The security pool last opened on this network in this browser. */
function rememberedSecurityPool(chainId: number, pendingSetup = false) {
	try {
		const saved = window.localStorage.getItem(securityPoolStorageKey(chainId) + (pendingSetup ? ':pending-setup' : ''))
		return saved !== null && isAddress(saved) ? saved : undefined
	} catch (failure) {
		if (!(failure instanceof DOMException)) throw failure
		return undefined
	}
}

function securityPoolBackendReady(backend: ReturnType<typeof getActiveBackend>) {
	return backend.isBootstrapped !== false && backend.isBootstrapping !== true && backend.bootstrapError === undefined
}

export function useSecurityPool({
	accountAddress,
	enabled,
	environmentKey,
	activeUniverseId,
	cacheReads = false,
	resumeSetup = false,
	securityPoolAddress,
}: {
	accountAddress: Address | undefined
	enabled: boolean
	environmentKey: number
	activeUniverseId: bigint
	cacheReads?: boolean
	resumeSetup?: boolean
	securityPoolAddress?: Address | undefined
}) {
	const initial = new URLSearchParams(window.location.hash.split('?')[1])
	const managerInput = useSignal(securityPoolAddress ?? initial.get('securityPool') ?? '')
	const ownerInput = useSignal(initial.get('owner') ?? accountAddress ?? (securityPoolAddress === undefined ? '' : zeroAddress))
	const followsWallet = useRef(!initial.has('owner'))
	const universeInput = useSignal(String(activeUniverseId))
	const previousActiveUniverse = useRef(activeUniverseId)
	const questionStart = useSignal(0n)
	const admissionStart = useSignal(0n)
	const snapshot = useSignal<SecurityPoolAccountSnapshot | undefined>(undefined)
	const presentationSnapshot = useSignal<SecurityPoolAccountSnapshot | undefined>(undefined)
	const presentationContext = useRef<{ environmentKey: number; backend: ReturnType<typeof getActiveBackend>; guard: ReturnType<typeof createActiveEnvironmentGuard> }>()
	const renderedBackend = getActiveBackend()
	const backendReady = securityPoolBackendReady(renderedBackend)
	const presentationEnvironmentCurrent = presentationContext.current?.guard.isCurrent() ?? true
	const setup = useSignal<SecurityPoolSetupSnapshot | undefined>(undefined)
	const pageCache = useRef<{ key: string; storage: ReturnType<typeof statoblastPageCache> }>()
	const displayedAt = useSignal<number | undefined>(undefined)
	const loading = useSignal(false)
	const error = useSignal<string | undefined>(undefined)
	const generation = useRef(0)
	const active = useRef(true)
	const inFlight = useRef<number | undefined>(undefined)
	const selectedNetwork = useRef<string | undefined>(undefined)
	useEffect(
		() => () => {
			active.current = false
			generation.current++
		},
		[],
	)
	const load = async (managerOverride = managerInput.value, ownerOverride = ownerInput.value, universeOverride = universeInput.value) => {
		if (!securityPoolBackendReady(getActiveBackend())) return
		const id = ++generation.current
		inFlight.current = id
		const environment = createActiveEnvironmentGuard()
		const current = () => active.current && id === generation.current && environment.isCurrent() && securityPoolBackendReady(getActiveBackend())
		loading.value = true
		error.value = undefined
		// Setup reads only security pool state, so a failed read of one owner's account keeps the shared setup visible.
		let loadedSetup: SecurityPoolSetupSnapshot | undefined
		try {
			const securityPool = getAddress(managerOverride.trim())
			const owner = getAddress(ownerOverride.trim())
			const universeId = securityPoolUnsignedId(universeOverride, 248)
			if (universeId === undefined) throw new Error('Enter a valid universe ID.')
			const client = createConnectedReadClient()
			const questionPage = questionStart.value
			const admissionPage = admissionStart.value
			const readPage = async (readClient: typeof client) => {
				const preparation = await loadSecurityPoolSetup(readClient, securityPool, owner)
				if (!cacheReads && current()) loadedSetup = preparation
				const next = preparation.stage === 4 ? await loadSecurityPoolAccount(readClient, securityPool, owner, universeId, questionPage, admissionPage, securityPoolAddress === undefined) : undefined
				return { preparation, next }
			}
			const read = async () => {
				if (!cacheReads) return await readPage(client)
				const cacheKey = `${environmentKey}:${securityPool}:${owner}:${universeId}:${questionPage}:${admissionPage}`
				if (pageCache.current?.key !== cacheKey) {
					pageCache.current = {
						key: cacheKey,
						storage: statoblastPageCache(renderedBackend.profile, { pool: securityPool, owner, universeId, page: `capital:${questionPage}:${admissionPage}` }),
					}
				}
				const cache = pageCache.current.storage
				if (presentationSnapshot.value === undefined) {
					void cache
						.loadCached(client, async cachedClient => {
							const preparation = await loadSecurityPoolSetup(cachedClient, securityPool, owner)
							return preparation.stage === 4 ? await loadSecurityPoolAccount(cachedClient, securityPool, owner, universeId, questionPage, admissionPage, securityPoolAddress === undefined) : undefined
						})
						.then(cached => {
							if (cached === undefined || !current() || snapshot.value !== undefined || presentationSnapshot.value !== undefined) return
							presentationSnapshot.value = cached.value
							displayedAt.value = cached.savedAt
							presentationContext.current = { environmentKey, backend: renderedBackend, guard: environment }
						})
						.catch(() => undefined)
				}
				return await cache.refresh(client, getMulticall3Address(), readPage, () => inFlight.current === id && current())
			}
			const result = read()
			const { preparation, next } = cacheReads ? await result : await withTimeout(result, 15_000, 'Security pool read timed out.')
			if (!current()) return
			setup.value = preparation
			snapshot.value = next
			presentationSnapshot.value = next
			displayedAt.value = Date.now()
			presentationContext.current = { environmentKey, backend: renderedBackend, guard: environment }
			universeInput.value = String(universeId)
			managerInput.value = securityPool
			ownerInput.value = owner
			try {
				const key = securityPoolStorageKey(preparation.chainId)
				window.localStorage.setItem(key, securityPool)
				if (resumeSetup) {
					if (preparation.stage < 4) window.localStorage.setItem(key + ':pending-setup', securityPool)
					else window.localStorage.removeItem(key + ':pending-setup')
				}
			} catch (failure) {
				if (!(failure instanceof DOMException)) throw failure
			}
		} catch (failure) {
			if (current()) {
				snapshot.value = undefined
				setup.value = loadedSetup ?? setup.value
				error.value = getErrorMessage(failure, 'Unable to load the security pool account.')
			}
		} finally {
			if (current()) loading.value = false
			if (inFlight.current === id) inFlight.current = undefined
		}
	}
	const refresh = async () => {
		if (!enabled || !securityPoolBackendReady(getActiveBackend()) || inFlight.current === generation.current || !isAddress(managerInput.value) || !isAddress(ownerInput.value)) return
		await load()
	}
	const invalidate = (preservePresentation = false) => {
		generation.current++
		snapshot.value = undefined
		if (!preservePresentation) {
			presentationSnapshot.value = undefined
			displayedAt.value = undefined
		}
		setup.value = undefined
		error.value = undefined
		loading.value = false
	}
	useBlockRefresh(() => {
		void refresh()
	}, enabled)
	useEffect(() => {
		if (previousActiveUniverse.current !== activeUniverseId) universeInput.value = String(activeUniverseId)
		previousActiveUniverse.current = activeUniverseId
		const previous = presentationSnapshot.value
		const context = presentationContext.current
		const preservePresentation =
			backendReady &&
			context?.environmentKey === environmentKey &&
			context.backend === renderedBackend &&
			context.guard.isCurrent() &&
			previous?.securityPool.toLowerCase() === managerInput.value.toLowerCase() &&
			previous?.owner.toLowerCase() === ownerInput.value.toLowerCase() &&
			previous?.universeId === securityPoolUnsignedId(universeInput.value, 248)
		invalidate(preservePresentation)
		questionStart.value = 0n
		admissionStart.value = 0n
		if (!enabled || !backendReady) return
		const backend = getActiveBackend()
		const storageKey = securityPoolStorageKey(backend.profile.chain.id)
		if (selectedNetwork.current !== undefined && selectedNetwork.current !== storageKey) managerInput.value = ''
		selectedNetwork.current = storageKey
		if (managerInput.value === '') managerInput.value = resumeSetup ? (rememberedSecurityPool(backend.profile.chain.id, true) ?? '') : (securityPoolAddress ?? backend.seededSecurityPool?.address ?? rememberedSecurityPool(backend.profile.chain.id) ?? '')
		void refresh()
		return () => {
			generation.current++
		}
	}, [enabled, environmentKey, activeUniverseId, renderedBackend, backendReady, presentationEnvironmentCurrent])
	useEffect(() => {
		const walletOwner = accountAddress ?? (securityPoolAddress === undefined ? '' : zeroAddress)
		if (!followsWallet.current || ownerInput.value === walletOwner) return
		invalidate()
		ownerInput.value = walletOwner
	}, [accountAddress])
	useEffect(() => {
		if (!enabled) return
		const timer = setTimeout(() => {
			void refresh()
		}, 250)
		return () => clearTimeout(timer)
	}, [enabled, managerInput.value, ownerInput.value, universeInput.value])
	useEffect(() => {
		const update = () => {
			const query = new URLSearchParams(window.location.hash.split('?')[1])
			const securityPool = query.get('securityPool')
			const owner = query.get('owner')
			if (owner !== null) followsWallet.current = false
			if (securityPool !== null && securityPool !== managerInput.value) {
				invalidate()
				managerInput.value = securityPool
			}
			if (owner !== null && owner !== ownerInput.value) {
				invalidate()
				ownerInput.value = owner
			}
		}
		window.addEventListener('hashchange', update)
		return () => window.removeEventListener('hashchange', update)
	}, [])
	const page = async (kind: 'questions' | 'admission', direction: -1 | 1) => {
		if (loading.value || snapshot.value === undefined) return
		const position = kind === 'questions' ? questionStart : admissionStart
		const approvedCount = snapshot.value.admission.mode === 'fixed' ? snapshot.value.admission.questionCount : 0n
		const count = kind === 'questions' ? snapshot.value.questionCount : approvedCount
		const next = position.value + BigInt(direction) * 64n
		if (next < 0n || next >= count) return
		position.value = next
		await load()
	}
	return {
		snapshot: snapshot.value,
		presentationSnapshot: presentationSnapshot.value,
		displayedAt: displayedAt.value,
		setup: setup.value,
		loading: loading.value,
		error: error.value,
		managerInput: managerInput.value,
		ownerInput: ownerInput.value,
		universeInput: universeInput.value,
		setManagerInput: (value: string) => {
			if (value === managerInput.value) return
			invalidate()
			questionStart.value = 0n
			admissionStart.value = 0n
			managerInput.value = value
		},
		setOwnerInput: (value: string) => {
			followsWallet.current = false
			if (value === ownerInput.value) return
			invalidate()
			ownerInput.value = value
		},
		setUniverseInput: (value: string) => {
			if (value === universeInput.value) return
			invalidate()
			universeInput.value = value
		},
		load,
		refresh,
		previousQuestionPage: () => page('questions', -1),
		nextQuestionPage: () => page('questions', 1),
		previousApprovedQuestionPage: () => page('admission', -1),
		nextApprovedQuestionPage: () => page('admission', 1),
	}
}
