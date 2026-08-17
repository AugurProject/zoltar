import { useEffect, useRef, useState } from 'preact/hooks'
import { normalizeAddress } from '../../../lib/address.js'
import type { ForkWorkflowSelectionStage, SelectedPoolView } from '../../security-pools/lib/securityPoolWorkflow.js'

type UseForkWorkflowSelectionStateParameters = {
	currentForkWorkflowSelectionStage: ForkWorkflowSelectionStage
	legacyForkWorkflowSelectionStage: ForkWorkflowSelectionStage | undefined
	onSelectedStageViewChange: (stage: ForkWorkflowSelectionStage) => void
	selectedPoolAddress: string | undefined
	view: SelectedPoolView
}

export function useForkWorkflowSelectionState({ currentForkWorkflowSelectionStage, legacyForkWorkflowSelectionStage, onSelectedStageViewChange, selectedPoolAddress, view }: UseForkWorkflowSelectionStateParameters) {
	const previousSelectedPoolViewRef = useRef<SelectedPoolView | undefined>(undefined)
	const previousForkWorkflowPoolKeyRef = useRef<string | undefined>(undefined)
	const previousLegacyForkWorkflowSelectionStageRef = useRef<ForkWorkflowSelectionStage | undefined>(legacyForkWorkflowSelectionStage)
	const pendingLegacyForkWorkflowSelectionStageRef = useRef<ForkWorkflowSelectionStage | undefined>(legacyForkWorkflowSelectionStage)
	const pendingGenericRouteManualSelectionRef = useRef(false)
	const hasManualForkWorkflowSelectionRef = useRef(false)
	const [forkWorkflowSelectionStage, setForkWorkflowSelectionStage] = useState<ForkWorkflowSelectionStage>(legacyForkWorkflowSelectionStage ?? currentForkWorkflowSelectionStage)

	useEffect(() => {
		const previousLegacyForkWorkflowSelectionStage = previousLegacyForkWorkflowSelectionStageRef.current
		previousLegacyForkWorkflowSelectionStageRef.current = legacyForkWorkflowSelectionStage
		if (legacyForkWorkflowSelectionStage === undefined) {
			if (previousLegacyForkWorkflowSelectionStage === undefined) return
			pendingLegacyForkWorkflowSelectionStageRef.current = undefined
			if (pendingGenericRouteManualSelectionRef.current) {
				pendingGenericRouteManualSelectionRef.current = false
				hasManualForkWorkflowSelectionRef.current = true
				return
			}
			hasManualForkWorkflowSelectionRef.current = false
			if (view === 'fork-workflow') setForkWorkflowSelectionStage(currentForkWorkflowSelectionStage)
			return
		}
		pendingGenericRouteManualSelectionRef.current = false
		pendingLegacyForkWorkflowSelectionStageRef.current = legacyForkWorkflowSelectionStage
		hasManualForkWorkflowSelectionRef.current = true
		if (view !== 'fork-workflow') return
		setForkWorkflowSelectionStage(legacyForkWorkflowSelectionStage)
		pendingLegacyForkWorkflowSelectionStageRef.current = undefined
	}, [currentForkWorkflowSelectionStage, legacyForkWorkflowSelectionStage, view])

	useEffect(() => {
		const selectedPoolKey = normalizeAddress(selectedPoolAddress)
		if (previousForkWorkflowPoolKeyRef.current === selectedPoolKey) return
		previousForkWorkflowPoolKeyRef.current = selectedPoolKey
		pendingGenericRouteManualSelectionRef.current = false
		pendingLegacyForkWorkflowSelectionStageRef.current = legacyForkWorkflowSelectionStage
		hasManualForkWorkflowSelectionRef.current = legacyForkWorkflowSelectionStage !== undefined
		setForkWorkflowSelectionStage(legacyForkWorkflowSelectionStage ?? currentForkWorkflowSelectionStage)
	}, [currentForkWorkflowSelectionStage, legacyForkWorkflowSelectionStage, selectedPoolAddress])

	useEffect(() => {
		const previousView = previousSelectedPoolViewRef.current
		previousSelectedPoolViewRef.current = view
		if (view !== 'fork-workflow' || previousView === 'fork-workflow') return
		const seededStage = pendingLegacyForkWorkflowSelectionStageRef.current
		if (seededStage !== undefined) {
			hasManualForkWorkflowSelectionRef.current = true
			setForkWorkflowSelectionStage(seededStage)
			pendingLegacyForkWorkflowSelectionStageRef.current = undefined
			return
		}
		hasManualForkWorkflowSelectionRef.current = false
		setForkWorkflowSelectionStage(currentForkWorkflowSelectionStage)
	}, [currentForkWorkflowSelectionStage, view])

	useEffect(() => {
		if (view !== 'fork-workflow') return
		if (pendingLegacyForkWorkflowSelectionStageRef.current !== undefined) return
		if (hasManualForkWorkflowSelectionRef.current) return
		if (forkWorkflowSelectionStage === currentForkWorkflowSelectionStage) return
		setForkWorkflowSelectionStage(currentForkWorkflowSelectionStage)
	}, [currentForkWorkflowSelectionStage, forkWorkflowSelectionStage, view])

	return {
		forkWorkflowSelectionStage,
		onForkWorkflowSelectionStageChange: (stage: ForkWorkflowSelectionStage) => {
			pendingGenericRouteManualSelectionRef.current = stage === 'fork-triggered'
			hasManualForkWorkflowSelectionRef.current = true
			setForkWorkflowSelectionStage(stage)
			onSelectedStageViewChange(stage)
		},
	}
}
