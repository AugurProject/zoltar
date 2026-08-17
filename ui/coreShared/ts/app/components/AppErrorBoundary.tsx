import { Component, type ComponentChildren } from 'preact'
import * as appCopy from '../../copy/app.js'
import { getErrorMessage } from '../../lib/errors.js'
import { ApplicationErrorNotice } from './ApplicationErrorNotice.js'

type AppErrorBoundaryProps = {
	children?: ComponentChildren
}

type AppErrorBoundaryState = {
	errorMessage: string | undefined
}

export class AppErrorBoundary extends Component<AppErrorBoundaryProps, AppErrorBoundaryState> {
	override state: AppErrorBoundaryState = {
		errorMessage: undefined,
	}

	override componentDidCatch(error: unknown) {
		console.error('[ui] application render failed', error)
		this.setState({
			errorMessage: getErrorMessage(error, appCopy.applicationErrorFallback),
		})
	}

	override render() {
		if (this.state.errorMessage === undefined) return this.props.children

		return <ApplicationErrorNotice errorMessage={this.state.errorMessage} onRetry={() => this.setState({ errorMessage: undefined })} />
	}
}
