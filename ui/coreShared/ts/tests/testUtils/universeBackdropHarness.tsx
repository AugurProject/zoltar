import { act } from 'preact/test-utils'
import { UniverseIdentity } from '../../components/UniverseIdentity.js'
import { renderIntoDocument } from './renderIntoDocument.js'

/** Renders the universe identity backdrop for the universe that an application's URL-state hook reads from the current URL. */
export async function renderUniverseBackdrop(useUrlState: () => { activeUniverseId: bigint }) {
	let activeUniverseId: bigint | undefined
	function Harness() {
		const state = useUrlState()
		activeUniverseId = state.activeUniverseId
		return <UniverseIdentity universeId={state.activeUniverseId} variant='backdrop' />
	}
	const rendered = await renderIntoDocument(<Harness />)
	return {
		cleanup: rendered.cleanup,
		activeUniverseId() {
			if (activeUniverseId === undefined) throw new Error('Hook state is unavailable')
			return activeUniverseId
		},
		backdropUniverseId: () => rendered.container.querySelector('.universe-identity-backdrop')?.getAttribute('data-universe-id'),
		/** Replaces the URL and dispatches the popstate a browser history navigation would. */
		async navigate(url: string) {
			await act(() => {
				window.history.replaceState({}, '', url)
				window.dispatchEvent(new Event('popstate'))
			})
		},
	}
}
