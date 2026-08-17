export function createPendingActionFeedback(action, title, detail = 'Waiting for confirmation.') {
    return {
        action,
        status: {
            detail,
            title,
            tone: 'pending',
        },
    };
}
export function createSuccessActionFeedback(action, title, hash, detail = 'Transaction confirmed.') {
    return {
        action,
        status: {
            detail,
            hash,
            title,
            tone: 'success',
        },
    };
}
export function createWarningActionFeedback(action, title, detail, hash) {
    return {
        action,
        status: {
            detail,
            ...(hash === undefined ? {} : { hash }),
            title,
            tone: 'warning',
        },
    };
}
export function createErrorActionFeedback(action, title, detail) {
    return {
        action,
        status: {
            detail,
            title,
            tone: 'error',
        },
    };
}
//# sourceMappingURL=actionFeedback.js.map