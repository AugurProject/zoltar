export function createSupportedNetworkChangeCoordinator({ getInFlightCount, replaceEnvironment }) {
    let replacementPending = false;
    let replacementPromise;
    const replaceWhenSafe = () => {
        if (replacementPromise !== undefined)
            return replacementPromise;
        replacementPromise = (async () => {
            while (replacementPending && getInFlightCount() === 0) {
                replacementPending = false;
                const committed = await replaceEnvironment(() => getInFlightCount() === 0);
                if (!committed)
                    replacementPending = true;
            }
        })().finally(() => {
            replacementPromise = undefined;
        });
        return replacementPromise;
    };
    const drainPendingReplacement = async () => {
        await replaceWhenSafe();
        while (replacementPending && getInFlightCount() === 0)
            await replaceWhenSafe();
    };
    return {
        handleSupportedNetworkChange: async () => {
            replacementPending = true;
            await drainPendingReplacement();
        },
        handleTransactionFinished: async () => {
            await drainPendingReplacement();
        },
    };
}
//# sourceMappingURL=supportedNetworkChange.js.map