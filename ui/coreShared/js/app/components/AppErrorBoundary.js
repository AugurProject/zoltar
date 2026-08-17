import { jsx as _jsx } from "preact/jsx-runtime";
import { Component } from 'preact';
import * as appCopy from '../../copy/app.js';
import { getErrorMessage } from '../../lib/errors.js';
import { ApplicationErrorNotice } from './ApplicationErrorNotice.js';
export class AppErrorBoundary extends Component {
    state = {
        errorMessage: undefined,
    };
    componentDidCatch(error) {
        console.error('[ui] application render failed', error);
        this.setState({
            errorMessage: getErrorMessage(error, appCopy.applicationErrorFallback),
        });
    }
    render() {
        if (this.state.errorMessage === undefined)
            return this.props.children;
        return _jsx(ApplicationErrorNotice, { errorMessage: this.state.errorMessage, onRetry: () => this.setState({ errorMessage: undefined }) });
    }
}
//# sourceMappingURL=AppErrorBoundary.js.map