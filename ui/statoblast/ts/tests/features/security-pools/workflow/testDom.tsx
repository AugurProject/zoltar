/// <reference types="bun-types" />

import { afterEach, beforeEach } from 'bun:test'
import { render } from 'preact'
import { act } from 'preact/test-utils'
import { zeroAddress } from '@zoltar/core-shared/evm/ethereum'
import { SecurityPoolWorkflowSection } from '@zoltar/ui-statoblast-shared/features/security-pools/components/SecurityPoolWorkflowSection.js'
import type { SecurityPoolWorkflowRouteContentProps } from '@zoltar/ui-zoltar-shared/features/types.js'
import { ChainTimestampContext } from '@zoltar/ui-core-shared/wallet/chainTimestamp.js'
import { installDomEnvironment } from '@zoltar/ui-core-shared/tests/testUtils/domEnvironment.js'
import { renderIntoDocument } from '@zoltar/ui-core-shared/tests/testUtils/renderIntoDocument.js'
import { createSecurityPoolWorkflowProps, createSelectedPool } from './builders.js'

type RenderWorkflowOptions = { chainTimestamp?: bigint; showHeader?: boolean }

function renderWorkflowNode(props: SecurityPoolWorkflowRouteContentProps, { chainTimestamp, showHeader = false }: RenderWorkflowOptions) {
	const section = <SecurityPoolWorkflowSection {...props} showHeader={showHeader} />
	return chainTimestamp === undefined ? section : <ChainTimestampContext.Provider value={chainTimestamp}>{section}</ChainTimestampContext.Provider>
}

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

	const renderWorkflow = async (props: SecurityPoolWorkflowRouteContentProps, options: RenderWorkflowOptions = {}) => {
		const renderedComponent = await renderIntoDocument(renderWorkflowNode(props, options))
		cleanupRenderedComponent = renderedComponent.cleanup
		return {
			...renderedComponent,
			rerender: async (nextProps: SecurityPoolWorkflowRouteContentProps, nextOptions: RenderWorkflowOptions = options) => {
				await act(() => {
					render(renderWorkflowNode(nextProps, nextOptions), renderedComponent.container)
				})
			},
		}
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
