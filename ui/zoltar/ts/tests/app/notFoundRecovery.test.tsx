import { describe, expect, test } from 'bun:test'
import { installDomTestLifecycle } from '@zoltar/ui-core-shared/tests/testUtils/domTestLifecycle.js'
import { renderIntoDocument } from '@zoltar/ui-core-shared/tests/testUtils/renderIntoDocument.js'
import { installTestRouting } from '@zoltar/ui-core-shared/tests/testUtils/testRouting.js'
import { AppRouteContent } from '../../app/components/AppRouteContent.js'

installTestRouting()
describe('not-found recovery', () => {
	installDomTestLifecycle({ url: 'http://localhost/?network=sepolia&rpcUrl=https%3A%2F%2Frpc.example#/missing?universe=42' })
	test('keeps the selected universe and read environment in every recovery link', async () => {
		const rendered = await renderIntoDocument(
			<AppRouteContent
				route='not-found'
				zoltarView='overview'
				readBackendMessage={undefined}
				deploy={{
					accountAddress: undefined,
					busyStepId: undefined,
					deploymentStateReady: false,
					deploymentStatusError: undefined,
					deploymentSections: [],
					deploymentStatuses: [],
					isLoadingDeploymentStatuses: false,
					isOnActiveAppChain: false,
					deployNextMissingPending: false,
					onDeploy: async () => undefined,
					onDeployNextMissing: () => undefined,
					onRetryDeploymentStatus: () => undefined,
				}}
			/>,
		)
		try {
			const links = [...rendered.container.querySelectorAll('a')]
			expect(links).toHaveLength(3)
			for (const link of links) {
				const url = new URL(link.href)
				expect(new URLSearchParams(url.hash.split('?')[1]).get('universe')).toBe('42')
				expect(url.searchParams.get('network')).toBe('sepolia')
				expect(url.searchParams.get('rpcUrl')).toBe('https://rpc.example')
			}
		} finally {
			await rendered.cleanup()
		}
	})
})
