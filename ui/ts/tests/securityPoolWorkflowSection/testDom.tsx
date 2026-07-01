/// <reference types="bun-types" />

import { afterEach, beforeEach } from 'bun:test'
import { zeroAddress } from 'viem'
import { SecurityPoolWorkflowSection } from '../../components/SecurityPoolWorkflowSection.js'
import type { SecurityPoolWorkflowRouteContentProps } from '../../types/components.js'
import { installDomEnvironment } from '../testUtils/domEnvironment.js'
import { renderIntoDocument } from '../testUtils/renderIntoDocument.js'
import { createSecurityPoolWorkflowProps, createSelectedPool } from './builders.js'

export function useSecurityPoolWorkflowSectionTestDom() {
	let restoreDomEnvironment: (() => void) | undefined
	let cleanupRenderedComponent: (() => Promise<void>) | undefined

	beforeEach(() => {
		const domEnvironment = installDomEnvironment()
		restoreDomEnvironment = domEnvironment.cleanup
	})

	afterEach(async () => {
		await cleanupRenderedComponent?.()
		cleanupRenderedComponent = undefined
		restoreDomEnvironment?.()
		restoreDomEnvironment = undefined
	})

	const renderWorkflow = async (props: SecurityPoolWorkflowRouteContentProps, options: { showHeader?: boolean } = {}) => {
		const renderedComponent = await renderIntoDocument(<SecurityPoolWorkflowSection {...props} showHeader={options.showHeader ?? false} />)
		cleanupRenderedComponent = renderedComponent.cleanup
		return renderedComponent
	}

	const renderLoadedPool = async (overrides: Partial<SecurityPoolWorkflowRouteContentProps> = {}) =>
		await renderWorkflow(
			createSecurityPoolWorkflowProps({
				checkedSecurityPoolAddress: zeroAddress,
				securityPoolAddress: zeroAddress,
				securityPools: [createSelectedPool()],
				...overrides,
			}),
		)

	return {
		renderLoadedPool,
		renderWorkflow,
		setCleanup(cleanup: () => Promise<void>) {
			cleanupRenderedComponent = cleanup
		},
	}
}
