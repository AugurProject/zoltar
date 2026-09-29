import { requireHookState } from '@zoltar/ui-core-shared/tests/testUtils/domTestLifecycle.js'
import { renderIntoDocument } from '@zoltar/ui-core-shared/tests/testUtils/renderIntoDocument.js'
import { render } from 'preact'
import { act } from 'preact/test-utils'

/**
 * Renders `useHook(props)` in a bare component and returns accessors for the latest hook state. The caller owns
 * `cleanup`, which unmounts the component.
 */
export async function renderHookWithProps<Props extends object, State>(useHook: (props: Props) => State, initialProps: Props) {
	let props = initialProps
	let hookState: State | undefined
	function HookHarness({ hookProps }: { hookProps: Props }) {
		hookState = useHook(hookProps)
		return <div />
	}
	const rendered = await renderIntoDocument(<HookHarness hookProps={props} />)
	/** Rerenders with merged props outside `act`, so callers can batch it with other updates. */
	const renderProps = (update: Partial<Props>) => {
		props = { ...props, ...update }
		render(<HookHarness hookProps={props} />, rendered.container)
	}
	return {
		cleanup: rendered.cleanup,
		renderProps,
		setProps: async (update: Partial<Props>) => {
			await act(() => {
				renderProps(update)
			})
		},
		state: () => requireHookState(hookState),
	}
}
