import { useEffect, useRef, useState } from 'preact/hooks'
import { normalizeAddress } from '../lib/address.js'
import type { ForkWorkflowSelectionStage, SelectedPoolView } from '../lib/securityPoolWorkflow.js'

type UseForkWorkflowSelectionStageParams = {
	currentForkWorkflowSelectionStage: ForkWorkflowSelectionStage
	legacyForkWorkflowSelectionStage: ForkWorkflowSelectionStage | undefined
	selectedPoolAddress: string | undefined
	view: SelectedPoolView
}

export function useForkWorkflowSelectionStage({ currentForkWorkflowSelectionStage, legacyForkWorkflowSelectionStage, selectedPoolAddress, view }: UseForkWorkflowSelectionStageParams) {
	const previousSelectedPoolViewRef = useRef<SelectedPoolView | undefined>(undefined)
	const previousForkWorkflowPoolKeyRef = useRef<string | undefined>(undefined)
	const pendingLegacyForkWorkflowSelectionStageRef = useRef<ForkWorkflowSelectionStage | undefined>(legacyForkWorkflowSelectionStage)
	const hasManualForkWorkflowSelectionRef = useRef(false)
	const [forkWorkflowSelectionStage, setForkWorkflowSelectionStage] = useState<ForkWorkflowSelectionStage>(legacyForkWorkflowSelectionStage ?? currentForkWorkflowSelectionStage)

	useEffect(() => {
		if (legacyForkWorkflowSelectionStage === undefined) return
		pendingLegacyForkWorkflowSelectionStageRef.current = legacyForkWorkflowSelectionStage
		hasManualForkWorkflowSelectionRef.current = false
		if (view !== 'fork-workflow') return
		setForkWorkflowSelectionStage(legacyForkWorkflowSelectionStage)
		pendingLegacyForkWorkflowSelectionStageRef.current = undefined
	}, [legacyForkWorkflowSelectionStage, view])

	useEffect(() => {
		const selectedPoolKey = normalizeAddress(selectedPoolAddress)
		if (previousForkWorkflowPoolKeyRef.current === selectedPoolKey) return
		previousForkWorkflowPoolKeyRef.current = selectedPoolKey
		pendingLegacyForkWorkflowSelectionStageRef.current = undefined
		hasManualForkWorkflowSelectionRef.current = false
		setForkWorkflowSelectionStage(currentForkWorkflowSelectionStage)
	}, [currentForkWorkflowSelectionStage, selectedPoolAddress])

	useEffect(() => {
		const previousView = previousSelectedPoolViewRef.current
		previousSelectedPoolViewRef.current = view
		if (view !== 'fork-workflow' || previousView === 'fork-workflow') return
		const seededStage = pendingLegacyForkWorkflowSelectionStageRef.current
		if (seededStage !== undefined) {
			hasManualForkWorkflowSelectionRef.current = false
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
		onSelectedStageViewChange: (stage: ForkWorkflowSelectionStage) => {
			hasManualForkWorkflowSelectionRef.current = true
			setForkWorkflowSelectionStage(stage)
		},
	}
}
