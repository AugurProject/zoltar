import { useEffect, useRef, useState } from 'preact/hooks'
import type { Address } from '@zoltar/shared/ethereum'
import { loadAllSecurityPools, loadForkAuctionDetails, loadForkOutcomeMigrationSeedStatus } from '../../../protocol/index.js'
import { sameAddress } from '../../../lib/address.js'
import { createConnectedReadClient } from '../../../lib/clients.js'
import { getErrorMessage } from '../../../lib/errors.js'
import { getCurrentSelectedPoolForkAuctionDetails, shouldReloadSelectedPoolDetails, type ForkWorkflowSelectionStage } from '../../security-pools/lib/securityPoolWorkflow.js'
import type { ForkAuctionSectionProps } from '../../types.js'
import type { ListedSecurityPool, ReadClient, ReportingOutcomeKey } from '../../../types/contracts.js'

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
	const [selectedAuctionErrorAddress, setSelectedAuctionErrorAddress] = useState<Address | undefined>(undefined)
	const [loadingSelectedAuctionDetails, setLoadingSelectedAuctionDetails] = useState(false)
	const [retryingSelectedAuctionDetails, setRetryingSelectedAuctionDetails] = useState(false)
	const [recoveredSelectedAuctionChildPool, setRecoveredSelectedAuctionChildPool] = useState<ListedSecurityPool | undefined>(undefined)
	const [selectedAuctionChildPoolRecoveryCompletedKey, setSelectedAuctionChildPoolRecoveryCompletedKey] = useState<string | undefined>(undefined)
	const [selectedAuctionChildPoolRecoveryError, setSelectedAuctionChildPoolRecoveryError] = useState<string | undefined>(undefined)
	const [selectedAuctionChildPoolRecoveryErrorKey, setSelectedAuctionChildPoolRecoveryErrorKey] = useState<string | undefined>(undefined)
	const [selectedAuctionChildPoolRecoveryRetryNonce, setSelectedAuctionChildPoolRecoveryRetryNonce] = useState(0)
	const lastHandledSelectedAuctionRefreshNonceRef = useRef(selectedPoolRefreshNonce)
	const selectedAuctionRequestGenerationRef = useRef(0)
	const [selectedOutcomeMigrationSeedStatus, setSelectedOutcomeMigrationSeedStatus] = useState<ForkOutcomeMigrationSeedStatus | undefined>(undefined)
	const [selectedOutcomeMigrationSeedStatusError, setSelectedOutcomeMigrationSeedStatusError] = useState<string | undefined>(undefined)
	const [loadingSelectedOutcomeMigrationSeedStatus, setLoadingSelectedOutcomeMigrationSeedStatus] = useState(false)
	const [selectedOutcomeMigrationSeedStatusRetryNonce, setSelectedOutcomeMigrationSeedStatusRetryNonce] = useState(0)
	const selectedAuctionChildPoolRecoveryKey = securityPoolAddress === undefined ? undefined : `${securityPoolAddress.toLowerCase()}:${selectedOutcome}`
	const scopedSelectedAuctionChildPoolRecoveryError = selectedAuctionChildPoolRecoveryErrorKey === selectedAuctionChildPoolRecoveryKey ? selectedAuctionChildPoolRecoveryError : undefined
	const currentRecoveredSelectedAuctionChildPool =
		recoveredSelectedAuctionChildPool !== undefined && securityPoolAddress !== undefined && sameAddress(recoveredSelectedAuctionChildPool.parent, securityPoolAddress) && recoveredSelectedAuctionChildPool.questionOutcome === selectedOutcome ? recoveredSelectedAuctionChildPool : undefined
	const selectedAuctionChildPool = selectedOutcomeMigrationChildPool ?? currentRecoveredSelectedAuctionChildPool ?? currentSelectedOutcomePool
	const selectedAuctionPoolAddress = selectedAuctionChildPool?.securityPoolAddress
	const scopedSelectedAuctionDetails = selectedAuctionPoolAddress !== undefined && sameAddress(selectedAuctionDetails?.securityPoolAddress, selectedAuctionPoolAddress) ? selectedAuctionDetails : undefined
	const scopedSelectedAuctionError = selectedAuctionPoolAddress !== undefined && sameAddress(selectedAuctionErrorAddress, selectedAuctionPoolAddress) ? selectedAuctionError : undefined
	const currentSelectedAuctionDetails = getCurrentSelectedPoolForkAuctionDetails({
		forkAuctionDetails: scopedSelectedAuctionDetails,
		selectedPool: selectedAuctionChildPool,
	})
	const retrySelectedAuctionDetails = () => {
		if (selectedAuctionPoolAddress === undefined) return
		const requestGeneration = ++selectedAuctionRequestGenerationRef.current
		setRetryingSelectedAuctionDetails(true)
		setLoadingSelectedAuctionDetails(true)
		setSelectedAuctionError(undefined)
		setSelectedAuctionErrorAddress(undefined)
		void loadForkAuctionDetails(fullTruthAuctionReadClient ?? createConnectedReadClient(), selectedAuctionPoolAddress)
			.then(details => {
				if (requestGeneration !== selectedAuctionRequestGenerationRef.current) return
				setSelectedAuctionDetails(details)
				setLoadingSelectedAuctionDetails(false)
				setRetryingSelectedAuctionDetails(false)
			})
			.catch(error => {
				if (requestGeneration !== selectedAuctionRequestGenerationRef.current) return
				setSelectedAuctionError(getErrorMessage(error, `Unable to load auction details for the ${selectedAuctionLabel} child universe.`))
				setSelectedAuctionErrorAddress(selectedAuctionPoolAddress)
				setLoadingSelectedAuctionDetails(false)
				setRetryingSelectedAuctionDetails(false)
			})
	}

	useEffect(() => {
		if (!retryingSelectedAuctionDetails || loadingSelectedAuctionDetails) return
		setRetryingSelectedAuctionDetails(false)
	}, [loadingSelectedAuctionDetails, retryingSelectedAuctionDetails])

	useEffect(() => {
		if (selectedStage === 'migration' || securityPoolAddress === undefined) {
			setRecoveredSelectedAuctionChildPool(undefined)
			setSelectedAuctionChildPoolRecoveryCompletedKey(undefined)
			setSelectedAuctionChildPoolRecoveryError(undefined)
			setSelectedAuctionChildPoolRecoveryErrorKey(undefined)
			return
		}
		if (selectedOutcomeMigrationChildPool !== undefined) {
			setRecoveredSelectedAuctionChildPool(currentPool => (currentPool?.securityPoolAddress === selectedOutcomeMigrationChildPool.securityPoolAddress ? currentPool : selectedOutcomeMigrationChildPool))
			setSelectedAuctionChildPoolRecoveryCompletedKey(selectedAuctionChildPoolRecoveryKey)
			return
		}
		let cancelled = false
		setSelectedAuctionChildPoolRecoveryCompletedKey(undefined)
		setSelectedAuctionChildPoolRecoveryError(undefined)
		setSelectedAuctionChildPoolRecoveryErrorKey(undefined)
		void loadAllSecurityPools(fullTruthAuctionReadClient ?? createConnectedReadClient(), {
			...(accountAddress === undefined ? {} : { accountAddress }),
			selectedSecurityPoolAddress: securityPoolAddress,
			vaultDetailMode: 'selected',
		})
			.then(allPools => {
				if (cancelled) return
				const recoveredPool = allPools.find(pool => sameAddress(pool.parent, securityPoolAddress) && pool.questionOutcome === selectedOutcome)
				setRecoveredSelectedAuctionChildPool(recoveredPool)
				setSelectedAuctionChildPoolRecoveryCompletedKey(selectedAuctionChildPoolRecoveryKey)
			})
			.catch(error => {
				if (cancelled) return
				setRecoveredSelectedAuctionChildPool(undefined)
				setSelectedAuctionChildPoolRecoveryError(getErrorMessage(error, `Unable to check whether the ${selectedAuctionLabel} child universe exists.`))
				setSelectedAuctionChildPoolRecoveryErrorKey(selectedAuctionChildPoolRecoveryKey)
				setSelectedAuctionChildPoolRecoveryCompletedKey(selectedAuctionChildPoolRecoveryKey)
			})
		return () => {
			cancelled = true
		}
	}, [accountAddress, forkAuctionResultHash, fullTruthAuctionReadClient, securityPoolAddress, selectedAuctionChildPoolRecoveryKey, selectedAuctionChildPoolRecoveryRetryNonce, selectedAuctionLabel, selectedOutcome, selectedOutcomeMigrationChildPool, selectedStage])

	useEffect(() => {
		if ((selectedStage !== 'auction' && selectedStage !== 'settlement') || selectedAuctionPoolAddress === undefined) {
			selectedAuctionRequestGenerationRef.current += 1
			setSelectedAuctionDetails(undefined)
			setSelectedAuctionError(undefined)
			setSelectedAuctionErrorAddress(undefined)
			setLoadingSelectedAuctionDetails(false)
			setRetryingSelectedAuctionDetails(false)
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
		const requestGeneration = ++selectedAuctionRequestGenerationRef.current
		setLoadingSelectedAuctionDetails(true)
		setSelectedAuctionError(undefined)
		setSelectedAuctionErrorAddress(undefined)
		lastHandledSelectedAuctionRefreshNonceRef.current = selectedPoolRefreshNonce
		void loadForkAuctionDetails(client, selectedAuctionPoolAddress)
			.then(details => {
				if (cancelled || requestGeneration !== selectedAuctionRequestGenerationRef.current) return
				setLoadingSelectedAuctionDetails(false)
				setRetryingSelectedAuctionDetails(false)
				setSelectedAuctionDetails(details)
			})
			.catch(error => {
				if (cancelled || requestGeneration !== selectedAuctionRequestGenerationRef.current) return
				setLoadingSelectedAuctionDetails(false)
				setRetryingSelectedAuctionDetails(false)
				setSelectedAuctionError(getErrorMessage(error, `Unable to load auction details for the ${selectedAuctionLabel} child universe.`))
				setSelectedAuctionErrorAddress(selectedAuctionPoolAddress)
			})
		return () => {
			cancelled = true
		}
	}, [currentSelectedAuctionDetails, fullTruthAuctionReadClient, scopedSelectedAuctionDetails?.systemState, selectedAuctionLabel, selectedAuctionPoolAddress, selectedPoolRefreshNonce, selectedStage])

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
	}, [forkAuctionResultHash, forkMigrationReadClient, securityPoolAddress, selectedAuctionLabel, selectedOutcome, selectedOutcomeMigrationChildPool?.securityPoolAddress, selectedOutcomeMigrationSeedStatusRetryNonce, selectedStage, universeId])

	return {
		loadingSelectedAuctionChildPoolRecovery:
			(selectedStage === 'auction' || selectedStage === 'settlement') && selectedAuctionChildPoolRecoveryKey !== undefined && selectedAuctionChildPool === undefined && scopedSelectedAuctionChildPoolRecoveryError === undefined && selectedAuctionChildPoolRecoveryCompletedKey !== selectedAuctionChildPoolRecoveryKey,
		loadingSelectedAuctionDetails: loadingSelectedAuctionDetails || ((selectedStage === 'auction' || selectedStage === 'settlement') && selectedAuctionPoolAddress !== undefined && currentSelectedAuctionDetails === undefined && scopedSelectedAuctionError === undefined),
		loadingSelectedOutcomeMigrationSeedStatus,
		retryingSelectedAuctionDetails: retryingSelectedAuctionDetails && loadingSelectedAuctionDetails && scopedSelectedAuctionDetails === undefined,
		retrySelectedAuctionChildPoolRecovery: () => setSelectedAuctionChildPoolRecoveryRetryNonce(currentNonce => currentNonce + 1),
		retrySelectedAuctionDetails,
		retrySelectedOutcomeMigrationSeedStatus: () => setSelectedOutcomeMigrationSeedStatusRetryNonce(currentNonce => currentNonce + 1),
		selectedAuctionChildPoolRecoveryError: scopedSelectedAuctionChildPoolRecoveryError,
		selectedAuctionChildPool,
		selectedAuctionPoolAddress,
		selectedAuctionDetails: scopedSelectedAuctionDetails,
		selectedAuctionError: scopedSelectedAuctionError,
		selectedOutcomeMigrationSeedStatus,
		selectedOutcomeMigrationSeedStatusError,
	}
}
