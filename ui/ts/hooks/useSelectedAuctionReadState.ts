import { useEffect, useRef, useState } from 'preact/hooks'
import type { Address } from '@zoltar/shared/ethereum'
import { loadAllSecurityPools, loadForkAuctionDetails, loadForkOutcomeMigrationSeedStatus } from '../contracts.js'
import { sameAddress } from '../lib/address.js'
import { createConnectedReadClient } from '../lib/clients.js'
import { getErrorMessage } from '../lib/errors.js'
import { getCurrentSelectedPoolForkAuctionDetails, shouldReloadSelectedPoolDetails, type ForkWorkflowSelectionStage } from '../lib/securityPoolWorkflow.js'
import type { ForkAuctionSectionProps } from '../types/components.js'
import type { ListedSecurityPool, ReadClient, ReportingOutcomeKey } from '../types/contracts.js'

type ForkOutcomeMigrationSeedStatus = Awaited<ReturnType<typeof loadForkOutcomeMigrationSeedStatus>>

type UseSelectedAuctionReadStateParameters = {
	accountAddress: Address | undefined
	currentSelectedOutcomePool: ListedSecurityPool | undefined
	forkAuctionResultHash: string | undefined
	forkMigrationReadClient: Pick<ReadClient, 'readContract'> | undefined
	fullTruthAuctionReadClient: ReadClient | undefined
	securityPoolAddress: Address | undefined
	selectedAuctionLabel: string
	selectedOutcome: ReportingOutcomeKey
	selectedOutcomeMigrationChildPool: ListedSecurityPool | undefined
	selectedPoolRefreshNonce: number
	selectedStage: ForkWorkflowSelectionStage
	universeId: bigint | undefined
}

export function useSelectedAuctionReadState({
	accountAddress,
	currentSelectedOutcomePool,
	forkAuctionResultHash,
	forkMigrationReadClient,
	fullTruthAuctionReadClient,
	securityPoolAddress,
	selectedAuctionLabel,
	selectedOutcome,
	selectedOutcomeMigrationChildPool,
	selectedPoolRefreshNonce,
	selectedStage,
	universeId,
}: UseSelectedAuctionReadStateParameters) {
	const [selectedAuctionDetails, setSelectedAuctionDetails] = useState<ForkAuctionSectionProps['forkAuctionDetails']>(undefined)
	const [selectedAuctionError, setSelectedAuctionError] = useState<string | undefined>(undefined)
	const [loadingSelectedAuctionDetails, setLoadingSelectedAuctionDetails] = useState(false)
	const [recoveredSelectedAuctionChildPool, setRecoveredSelectedAuctionChildPool] = useState<ListedSecurityPool | undefined>(undefined)
	const lastHandledSelectedAuctionRefreshNonceRef = useRef(selectedPoolRefreshNonce)
	const [selectedOutcomeMigrationSeedStatus, setSelectedOutcomeMigrationSeedStatus] = useState<ForkOutcomeMigrationSeedStatus | undefined>(undefined)
	const [selectedOutcomeMigrationSeedStatusError, setSelectedOutcomeMigrationSeedStatusError] = useState<string | undefined>(undefined)
	const [loadingSelectedOutcomeMigrationSeedStatus, setLoadingSelectedOutcomeMigrationSeedStatus] = useState(false)
	const selectedAuctionChildPool = selectedOutcomeMigrationChildPool ?? recoveredSelectedAuctionChildPool ?? currentSelectedOutcomePool
	const selectedAuctionPoolAddress = selectedAuctionChildPool?.securityPoolAddress
	const currentSelectedAuctionDetails = getCurrentSelectedPoolForkAuctionDetails({
		forkAuctionDetails: selectedAuctionDetails,
		selectedPool: selectedAuctionChildPool,
	})

	useEffect(() => {
		if (selectedStage === 'migration' || securityPoolAddress === undefined) {
			setRecoveredSelectedAuctionChildPool(undefined)
			return
		}
		if (selectedOutcomeMigrationChildPool !== undefined) {
			setRecoveredSelectedAuctionChildPool(currentPool => (currentPool?.securityPoolAddress === selectedOutcomeMigrationChildPool.securityPoolAddress ? currentPool : selectedOutcomeMigrationChildPool))
			return
		}
		let cancelled = false
		void loadAllSecurityPools(fullTruthAuctionReadClient ?? createConnectedReadClient(), {
			...(accountAddress === undefined ? {} : { accountAddress }),
			selectedSecurityPoolAddress: securityPoolAddress,
			vaultDetailMode: 'selected',
		})
			.then(allPools => {
				if (cancelled) return
				const recoveredPool = allPools.find(pool => sameAddress(pool.parent, securityPoolAddress) && pool.questionOutcome === selectedOutcome)
				setRecoveredSelectedAuctionChildPool(recoveredPool)
			})
			.catch(() => {
				if (cancelled) return
				setRecoveredSelectedAuctionChildPool(undefined)
			})
		return () => {
			cancelled = true
		}
	}, [accountAddress, forkAuctionResultHash, fullTruthAuctionReadClient, securityPoolAddress, selectedOutcome, selectedOutcomeMigrationChildPool, selectedStage])

	useEffect(() => {
		if ((selectedStage !== 'auction' && selectedStage !== 'settlement') || selectedAuctionPoolAddress === undefined) {
			setSelectedAuctionDetails(undefined)
			setSelectedAuctionError(undefined)
			setLoadingSelectedAuctionDetails(false)
			return
		}
		const shouldReloadSelectedAuction = shouldReloadSelectedPoolDetails({
			currentDetailsAvailable: currentSelectedAuctionDetails !== undefined,
			lastHandledRefreshNonce: lastHandledSelectedAuctionRefreshNonceRef.current,
			loadedDetailsAddress: selectedAuctionDetails?.securityPoolAddress,
			refreshNonce: selectedPoolRefreshNonce,
			selectedPoolAddress: selectedAuctionPoolAddress,
		})
		if (!shouldReloadSelectedAuction && sameAddress(selectedAuctionDetails?.securityPoolAddress, selectedAuctionPoolAddress) && currentSelectedAuctionDetails !== undefined) {
			return
		}
		const client = fullTruthAuctionReadClient ?? createConnectedReadClient()
		let cancelled = false
		setLoadingSelectedAuctionDetails(true)
		setSelectedAuctionError(undefined)
		lastHandledSelectedAuctionRefreshNonceRef.current = selectedPoolRefreshNonce
		void loadForkAuctionDetails(client, selectedAuctionPoolAddress)
			.then(details => {
				if (cancelled) return
				setSelectedAuctionDetails(details)
			})
			.catch(error => {
				if (cancelled) return
				setSelectedAuctionDetails(undefined)
				setSelectedAuctionError(getErrorMessage(error, `Unable to load auction details for the ${selectedAuctionLabel} child universe.`))
			})
			.finally(() => {
				if (cancelled) return
				setLoadingSelectedAuctionDetails(false)
			})
		return () => {
			cancelled = true
		}
	}, [currentSelectedAuctionDetails, fullTruthAuctionReadClient, selectedAuctionDetails?.securityPoolAddress, selectedAuctionLabel, selectedAuctionPoolAddress, selectedPoolRefreshNonce, selectedStage])

	useEffect(() => {
		if (selectedStage !== 'migration' || securityPoolAddress === undefined || universeId === undefined) {
			setSelectedOutcomeMigrationSeedStatus(undefined)
			setSelectedOutcomeMigrationSeedStatusError(undefined)
			setLoadingSelectedOutcomeMigrationSeedStatus(false)
			return
		}
		const client = forkMigrationReadClient ?? createConnectedReadClient()
		let cancelled = false
		setLoadingSelectedOutcomeMigrationSeedStatus(true)
		setSelectedOutcomeMigrationSeedStatusError(undefined)
		void loadForkOutcomeMigrationSeedStatus(client, {
			childSecurityPoolAddress: selectedOutcomeMigrationChildPool?.securityPoolAddress,
			outcome: selectedOutcome,
			securityPoolAddress,
			universeId,
		})
			.then(status => {
				if (cancelled) return
				setSelectedOutcomeMigrationSeedStatus(status)
			})
			.catch(error => {
				if (cancelled) return
				setSelectedOutcomeMigrationSeedStatus(undefined)
				setSelectedOutcomeMigrationSeedStatusError(getErrorMessage(error, `Unable to verify whether pool REP is ready for the ${selectedAuctionLabel} child pool.`))
			})
			.finally(() => {
				if (cancelled) return
				setLoadingSelectedOutcomeMigrationSeedStatus(false)
			})
		return () => {
			cancelled = true
		}
	}, [forkAuctionResultHash, forkMigrationReadClient, securityPoolAddress, selectedAuctionLabel, selectedOutcome, selectedOutcomeMigrationChildPool?.securityPoolAddress, selectedStage, universeId])

	return {
		loadingSelectedAuctionDetails,
		loadingSelectedOutcomeMigrationSeedStatus,
		selectedAuctionChildPool,
		selectedAuctionPoolAddress,
		selectedAuctionDetails,
		selectedAuctionError,
		selectedOutcomeMigrationSeedStatus,
		selectedOutcomeMigrationSeedStatusError,
	}
}
