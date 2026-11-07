import { useSignal } from '@preact/signals'
import { useEffect, useRef } from 'preact/hooks'
import { getAddress, isAddress, type Address } from '@zoltar/core-shared/evm/ethereum'
import { createActiveEnvironmentGuard, getActiveBackend } from '@zoltar/ui-core-shared/lib/activeEnvironment.js'
import { createConnectedReadClient } from '@zoltar/ui-core-shared/wallet/clients.js'
import { useBlockRefresh } from '@zoltar/ui-core-shared/hooks/useDataRefresh.js'
import { getErrorMessage } from '@zoltar/ui-core-shared/lib/errors.js'
import { discoverSimulationPortfolio, loadPortfolioAccount, loadPortfolioSetup, type PortfolioSetupSnapshot, type PortfolioAccountSnapshot } from '../../../protocol/securityPoolPortfolio.js'
import { portfolioUnsignedId } from '../lib/draft.js'

function portfolioStorageKey(chainId: number) {
	const backend = getActiveBackend()
	return `statoblast:portfolio:last:${backend.id}:${chainId}:${backend.profile.genesisRepTokenAddress.toLowerCase()}`
}

function portfolioBackendReady(backend: ReturnType<typeof getActiveBackend>) {
	return backend.isBootstrapped !== false && backend.isBootstrapping !== true && backend.bootstrapError === undefined
}

export function usePortfolio({ accountAddress, enabled, environmentKey, activeUniverseId }: { accountAddress: Address | undefined; enabled: boolean; environmentKey: number; activeUniverseId: bigint }) {
	const initial = new URLSearchParams(window.location.hash.split('?')[1])
	const managerInput = useSignal(initial.get('portfolio') ?? '')
	const ownerInput = useSignal(initial.get('owner') ?? accountAddress ?? '')
	const universeInput = useSignal(String(activeUniverseId))
	const previousActiveUniverse = useRef(activeUniverseId)
	const questionStart = useSignal(0n)
	const admissionStart = useSignal(0n)
	const snapshot = useSignal<PortfolioAccountSnapshot | undefined>(undefined)
	const presentationSnapshot = useSignal<PortfolioAccountSnapshot | undefined>(undefined)
	const presentationContext = useRef<{ environmentKey: number; backend: ReturnType<typeof getActiveBackend>; guard: ReturnType<typeof createActiveEnvironmentGuard> }>()
	const renderedBackend = getActiveBackend()
	const backendReady = portfolioBackendReady(renderedBackend)
	const presentationEnvironmentCurrent = presentationContext.current?.guard.isCurrent() ?? true
	const setup = useSignal<PortfolioSetupSnapshot | undefined>(undefined)
	const loading = useSignal(false)
	const discovering = useSignal(false)
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
		if (!portfolioBackendReady(getActiveBackend())) return
		const id = ++generation.current
		inFlight.current = id
		const environment = createActiveEnvironmentGuard()
		const current = () => active.current && id === generation.current && environment.isCurrent() && portfolioBackendReady(getActiveBackend())
		loading.value = true
		error.value = undefined
		try {
			const portfolio = getAddress(managerOverride.trim())
			const owner = getAddress(ownerOverride.trim())
			const universeId = portfolioUnsignedId(universeOverride, 248)
			if (universeId === undefined) throw new Error('Enter a valid universe ID.')
			const client = createConnectedReadClient()
			const preparation = await loadPortfolioSetup(client, portfolio, owner)
			const next = preparation.stage === 4 ? await loadPortfolioAccount(client, portfolio, owner, universeId, questionStart.value, admissionStart.value) : undefined
			if (!current()) return
			setup.value = preparation
			snapshot.value = next
			presentationSnapshot.value = next
			presentationContext.current = { environmentKey, backend: renderedBackend, guard: environment }
			universeInput.value = String(universeId)
			managerInput.value = portfolio
			ownerInput.value = owner
			try {
				window.localStorage.setItem(portfolioStorageKey(preparation.chainId), portfolio)
			} catch (failure) {
				if (!(failure instanceof DOMException)) throw failure
			}
		} catch (failure) {
			if (current()) {
				snapshot.value = undefined
				presentationSnapshot.value = undefined
				setup.value = undefined
				error.value = getErrorMessage(failure, 'Unable to load the portfolio account.')
			}
		} finally {
			if (current()) loading.value = false
			if (inFlight.current === id) inFlight.current = undefined
		}
	}
	const refresh = async () => {
		if (!enabled || !portfolioBackendReady(getActiveBackend()) || inFlight.current === generation.current || !isAddress(managerInput.value) || !isAddress(ownerInput.value)) return
		await load()
	}
	const invalidate = (preservePresentation = false) => {
		generation.current++
		snapshot.value = undefined
		if (!preservePresentation) presentationSnapshot.value = undefined
		setup.value = undefined
		error.value = undefined
		loading.value = false
		discovering.value = false
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
			previous?.portfolio.toLowerCase() === managerInput.value.toLowerCase() &&
			previous?.owner.toLowerCase() === ownerInput.value.toLowerCase() &&
			previous?.universeId === portfolioUnsignedId(universeInput.value, 248)
		invalidate(preservePresentation)
		questionStart.value = 0n
		admissionStart.value = 0n
		if (!enabled || !backendReady) return
		const backend = getActiveBackend()
		const storageKey = portfolioStorageKey(backend.profile.chain.id)
		if (selectedNetwork.current !== undefined && selectedNetwork.current !== storageKey) managerInput.value = ''
		selectedNetwork.current = storageKey
		if (ownerInput.value === '' && accountAddress !== undefined) ownerInput.value = accountAddress
		let current = true
		void (async () => {
			if (managerInput.value === '') {
				try {
					const saved = window.localStorage.getItem(storageKey)
					if (saved !== null && isAddress(saved)) managerInput.value = saved
				} catch (failure) {
					if (!(failure instanceof DOMException)) throw failure
				}
			}
			if (managerInput.value === '' && isAddress(ownerInput.value)) {
				discovering.value = true
				try {
					const portfolio = await discoverSimulationPortfolio(createConnectedReadClient(), backend.id, getAddress(ownerInput.value))
					if (!current) return
					if (portfolio !== undefined && managerInput.value === '') managerInput.value = portfolio
				} finally {
					if (current) discovering.value = false
				}
			}
			if (current) await refresh()
		})().catch(failure => {
			if (current) error.value = getErrorMessage(failure, 'Unable to discover the portfolio.')
		})
		return () => {
			current = false
			generation.current++
		}
	}, [enabled, environmentKey, activeUniverseId, renderedBackend, backendReady, presentationEnvironmentCurrent])
	useEffect(() => {
		if (ownerInput.value === '' && accountAddress !== undefined) ownerInput.value = accountAddress
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
			const portfolio = query.get('portfolio')
			const owner = query.get('owner')
			if (portfolio !== null && portfolio !== managerInput.value) {
				invalidate()
				managerInput.value = portfolio
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
		setup: setup.value,
		loading: loading.value,
		discovering: discovering.value,
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
