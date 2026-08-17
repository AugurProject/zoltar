import { createElement, render } from 'preact';
import * as appCopy from '../copy/app.js';
import { getErrorMessage } from '../lib/errors.js';
import { initializeActiveEnvironment } from '../lib/activeEnvironment.js';
import { AppErrorBoundary } from './components/AppErrorBoundary.js';
import { ApplicationErrorNotice } from './components/ApplicationErrorNotice.js';
export function createAppRoot(children) {
    return createElement(AppErrorBoundary, {}, children);
}
export async function mountApp(options) {
    const initialize = options.initialize ?? initializeActiveEnvironment;
    const rootOption = options.root;
    if (rootOption === undefined)
        throw new Error('mountApp requires a root component factory');
    const root = rootOption;
    const target = options.target ?? document.body;
    try {
        await initialize();
        render(root(), target);
    }
    catch (error) {
        console.error('[ui] failed to initialize or mount application', error);
        const errorMessage = getErrorMessage(error, appCopy.applicationInitializationErrorFallback);
        render(createElement(ApplicationErrorNotice, { errorMessage, onRetry: () => mountApp(options) }), target);
    }
}
//# sourceMappingURL=appRoot.js.map