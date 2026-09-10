"use strict";Object.defineProperty(exports, "__esModule", {value: true});// src/getLogsRetryHelper.ts



var _viem = require('viem');
var getLogsRetryHelper = ({
  params,
  error
}) => {
  const sError = JSON.stringify(error);
  let match;
  match = sError.match(
    /requested too many blocks from (\d+) to (\d+), maximum is set to (\d+)/
  );
  if (match !== null) {
    const ranges = chunk({ params, range: BigInt(match[3]) - 1n });
    if (isRangeUnchanged(params, ranges) === false) {
      return {
        shouldRetry: true,
        ranges,
        isSuggestedRange: true
      };
    }
  }
  match = sError.match(/Max range: (\d+)/);
  if (match !== null) {
    const ranges = chunk({ params, range: BigInt(match[1]) - 1n });
    if (isRangeUnchanged(params, ranges) === false) {
      return {
        shouldRetry: true,
        ranges,
        isSuggestedRange: true
      };
    }
  }
  match = sError.match(/Maximum allowed number of requested blocks is ([\d]+)/);
  if (match !== null) {
    const ranges = chunk({
      params,
      range: BigInt(match[1])
    });
    if (isRangeUnchanged(params, ranges) === false) {
      return {
        shouldRetry: true,
        ranges,
        isSuggestedRange: true
      };
    }
  }
  match = sError.match(
    /Try with this block range \[0x([0-9a-fA-F]+),\s*0x([0-9a-fA-F]+)\]/
  );
  if (match !== null) {
    const start = _viem.hexToBigInt.call(void 0, `0x${match[1]}`);
    const end = _viem.hexToBigInt.call(void 0, `0x${match[2]}`);
    const range = end - start;
    const ranges = chunk({ params, range });
    if (isRangeUnchanged(params, ranges) === false) {
      return {
        shouldRetry: true,
        ranges,
        isSuggestedRange: true
      };
    }
  }
  match = sError.match("block range is too wide");
  if (match !== null && error.code === -32600) {
    const ranges = chunk({ params, range: 3000n });
    if (isRangeUnchanged(params, ranges) === false) {
      return {
        shouldRetry: true,
        ranges,
        isSuggestedRange: true
      };
    }
  }
  match = sError.match(
    /this block range should work: \[0x([0-9a-fA-F]+),\s*0x([0-9a-fA-F]+)\]/
  );
  if (match !== null) {
    const start = _viem.hexToBigInt.call(void 0, `0x${match[1]}`);
    const end = _viem.hexToBigInt.call(void 0, `0x${match[2]}`);
    const range = end - start;
    const ranges = chunk({ params, range });
    if (isRangeUnchanged(params, ranges) === false) {
      return {
        shouldRetry: true,
        ranges,
        isSuggestedRange: true
      };
    }
  }
  match = sError.match(/limited to a ([\d,.]+)/);
  if (match !== null) {
    const ranges = chunk({
      params,
      range: BigInt(match[1].replace(/[,.]/g, ""))
    });
    if (isRangeUnchanged(params, ranges) === false) {
      return {
        shouldRetry: true,
        ranges,
        isSuggestedRange: true
      };
    }
  }
  match = sError.match(/limited to ([\d,.]+) block/);
  if (match !== null) {
    const ranges = chunk({
      params,
      range: BigInt(match[1].replace(/[,.]/g, ""))
    });
    if (isRangeUnchanged(params, ranges) === false) {
      return {
        shouldRetry: true,
        ranges,
        isSuggestedRange: true
      };
    }
  }
  match = sError.match(
    /exceeds the range allowed for your plan \(\d+ > (\d+)\)/
  );
  if (match !== null) {
    const ranges = chunk({ params, range: BigInt(match[1]) });
    if (isRangeUnchanged(params, ranges) === false) {
      return {
        shouldRetry: true,
        ranges,
        isSuggestedRange: true
      };
    }
  }
  match = sError.match(/Block range limit exceeded./);
  if (match !== null) {
    const prevRange = _viem.hexToBigInt.call(void 0, params[0].toBlock) - _viem.hexToBigInt.call(void 0, params[0].fromBlock);
    const ranges = prevRange < 10000n ? chunk({ params, range: 100n }) : chunk({ params, range: 10000n });
    if (isRangeUnchanged(params, ranges) === false) {
      return {
        shouldRetry: true,
        ranges,
        isSuggestedRange: true
      };
    }
  }
  match = sError.match(/please limit the query to at most ([\d,.]+) blocks/);
  if (match !== null) {
    const ranges = chunk({
      params,
      range: BigInt(match[1].replace(/[,.]/g, "")) - 1n
    });
    if (isRangeUnchanged(params, ranges) === false) {
      return {
        shouldRetry: true,
        ranges,
        isSuggestedRange: true
      };
    }
  }
  match = sError.match(/maximum block range: ([\d,.]+)/);
  if (match !== null) {
    const ranges = chunk({
      params,
      range: BigInt(match[1].replace(/[,.]/g, ""))
    });
    if (isRangeUnchanged(params, ranges) === false) {
      return {
        shouldRetry: true,
        ranges,
        isSuggestedRange: true
      };
    }
  }
  match = sError.match(/query exceeds max block range ([\d,.]+)/);
  if (match !== null) {
    const ranges = chunk({
      params,
      range: BigInt(match[1].replace(/[,.]/g, ""))
    });
    if (isRangeUnchanged(params, ranges) === false) {
      return {
        shouldRetry: true,
        ranges,
        isSuggestedRange: true
      };
    }
  }
  match = sError.match(/block range greater than ([\d,.]+) max/);
  if (match !== null) {
    const ranges = chunk({
      params,
      range: BigInt(match[1].replace(/[,.]/g, ""))
    });
    if (isRangeUnchanged(params, ranges) === false) {
      return {
        shouldRetry: true,
        ranges,
        isSuggestedRange: true
      };
    }
  }
  match = sError.match(/block range exceeds ([\d,.]+)/);
  if (match !== null) {
    const ranges = chunk({
      params,
      range: BigInt(match[1].replace(/[,.]/g, ""))
    });
    if (isRangeUnchanged(params, ranges) === false) {
      return {
        shouldRetry: true,
        ranges,
        isSuggestedRange: true
      };
    }
  }
  match = sError.match(/eth_getLogs range is too large, max is 10k blocks/);
  if (match !== null) {
    const ranges = chunk({
      params,
      range: 10000n
    });
    if (isRangeUnchanged(params, ranges) === false) {
      return {
        shouldRetry: true,
        ranges,
        isSuggestedRange: true
      };
    }
  }
  match = sError.match(/eth_getLogs range is too large, max is 1k blocks/);
  if (match !== null) {
    const ranges = chunk({
      params,
      range: 1000n
    });
    if (isRangeUnchanged(params, ranges) === false) {
      return {
        shouldRetry: true,
        ranges,
        isSuggestedRange: true
      };
    }
  }
  match = sError.match(/query must be smaller than size ([\d,.]+)/);
  if (match !== null) {
    const ranges = chunk({
      params,
      range: BigInt(match[1].replace(/[,.]/g, ""))
    });
    if (isRangeUnchanged(params, ranges) === false) {
      return {
        shouldRetry: true,
        ranges,
        isSuggestedRange: true
      };
    }
  }
  match = sError.match(/block range is too wide \(maximum (\d+)\)/);
  if (match !== null) {
    const ranges = chunk({
      params,
      range: BigInt(match[1].replace(/[,.]/g, ""))
    });
    if (isRangeUnchanged(params, ranges) === false) {
      return {
        shouldRetry: true,
        ranges,
        isSuggestedRange: true
      };
    }
  }
  match = sError.match(/up to a ([\d,.]+) block range/);
  if (match !== null) {
    const ranges = chunk({
      params,
      range: BigInt(match[1].replace(/[,.]/g, ""))
    });
    if (isRangeUnchanged(params, ranges) === false) {
      return {
        shouldRetry: true,
        ranges,
        isSuggestedRange: true
      };
    }
  }
  match = sError.match(/maximum \[from, to\] blocks distance: (\d+)/);
  if (match !== null) {
    const ranges = chunk({
      params,
      range: BigInt(match[1])
    });
    if (isRangeUnchanged(params, ranges) === false) {
      return {
        shouldRetry: true,
        ranges,
        isSuggestedRange: true
      };
    }
  }
  match = sError.match(/exceed max block range: (\d+)/);
  if (match !== null) {
    const ranges = chunk({ params, range: BigInt(match[1]) - 1n });
    if (isRangeUnchanged(params, ranges) === false) {
      return {
        shouldRetry: true,
        ranges,
        isSuggestedRange: true
      };
    }
  }
  if (
    // valtitude
    sError.includes("allowed block range threshold exceeded") || // erpc
    sError.includes("exceeded max allowed") || // erpc
    sError.includes("range threshold exceeded") || // base
    sError.includes("no backend is currently healthy to serve traffic") || // base, monad
    sError.includes("block range too large") || // optimism
    sError.includes("Block range is too large") || // optimism
    sError.includes("backend response too large") || // llamarpc, ankr, altitude
    sError.includes("query exceeds max results") || // arbitrum
    /logs matched by query exceeds limit of \d+/.test(sError) || // zkevm
    /query returned more than \d+ results/.test(sError) || // 1rpc
    /response size should not greater than \d+ bytes/.test(sError) || // drpc
    /ranges over \d+ blocks are not supported on freetier/.test(sError)
  ) {
    const ranges = chunk({
      params,
      range: (_viem.hexToBigInt.call(void 0, params[0].toBlock) - _viem.hexToBigInt.call(void 0, params[0].fromBlock)) / 2n
    });
    if (isRangeUnchanged(params, ranges) === false) {
      return {
        ranges,
        shouldRetry: true,
        isSuggestedRange: false
      };
    }
  }
  return { shouldRetry: false };
};
var isRangeUnchanged = (params, ranges) => {
  return ranges.length === 0 || ranges.length === 1 && ranges[0].fromBlock === params[0].fromBlock && ranges[0].toBlock === params[0].toBlock;
};
var chunk = ({
  params,
  range
}) => {
  const ranges = [];
  const fromBlock = _viem.hexToBigInt.call(void 0, params[0].fromBlock);
  const toBlock = _viem.hexToBigInt.call(void 0, params[0].toBlock);
  for (let start = fromBlock; start <= toBlock; start += range + 1n) {
    const end = start + range > toBlock ? toBlock : start + range;
    ranges.push({
      fromBlock: _viem.numberToHex.call(void 0, start),
      toBlock: _viem.numberToHex.call(void 0, end)
    });
  }
  return ranges;
};

// src/mergeAbis.ts
var _utils = require('viem/utils');
var isAbiItemEqual = (a, b) => _utils.formatAbiItem.call(void 0, a) === _utils.formatAbiItem.call(void 0, b);
var mergeAbis = (abis) => {
  let merged = [];
  for (const abi of abis) {
    for (const item of abi) {
      if (item.type !== "constructor" && item.type !== "receive" && item.type !== "fallback" && !merged.some((m) => isAbiItemEqual(m, item))) {
        merged = [...merged, item];
      }
    }
  }
  return merged;
};

// src/loadBalance.ts

var loadBalance = (_transports) => {
  return ({ chain, retryCount, timeout }) => {
    const transports = _transports.map(
      (t) => chain === void 0 ? t({ retryCount: 0, timeout }) : t({ chain, retryCount: 0, timeout })
    );
    let index = 0;
    return _viem.createTransport.call(void 0, {
      key: "loadBalance",
      name: "Load Balance",
      request: (body) => {
        const response = transports[index++].request(body);
        if (index === transports.length)
          index = 0;
        return response;
      },
      retryCount,
      timeout,
      type: "loadBalance"
    });
  };
};

// src/rateLimit.ts


// src/utils/promiseWithResolvers.ts
var promiseWithResolvers = () => {
  let resolve;
  let reject;
  const promise = new Promise((_resolve, _reject) => {
    resolve = _resolve;
    reject = _reject;
  });
  return { resolve, reject, promise };
};

// src/utils/queue.ts
var validateParameters = ({
  concurrency,
  frequency
}) => {
  if (concurrency === void 0 && frequency === void 0) {
    throw new Error(
      "Invalid queue configuration, must specify either 'concurrency' or 'frequency'."
    );
  }
  if (concurrency !== void 0 && concurrency <= 0) {
    throw new Error(
      `Invalid value for queue 'concurrency' option. Got ${concurrency}, expected a number greater than zero.`
    );
  }
  if (frequency !== void 0 && frequency <= 0) {
    throw new Error(
      `Invalid value for queue 'frequency' option. Got ${frequency}, expected a number greater than zero.`
    );
  }
};
var createQueue = ({
  worker,
  initialStart = false,
  browser = true,
  ..._parameters
}) => {
  validateParameters(_parameters);
  const parameters = _parameters;
  let queue = new Array();
  let pending = 0;
  let timestamp = 0;
  let requests = 0;
  let isStarted = initialStart;
  let timer;
  let emptyPromiseWithResolvers = void 0;
  let idlePromiseWithResolvers = void 0;
  const next = () => {
    if (!isStarted)
      return;
    const _timestamp = Date.now();
    if (Math.floor(_timestamp / 1e3) !== timestamp) {
      requests = 0;
      timestamp = Math.floor(_timestamp / 1e3);
    }
    if (timer)
      return;
    while ((parameters.frequency !== void 0 ? requests < parameters.frequency : true) && (parameters.concurrency !== void 0 ? pending < parameters.concurrency : true) && queue.length > 0) {
      const { task, resolve, reject } = queue.shift();
      requests++;
      pending++;
      worker(task).then(resolve).catch(reject).finally(() => {
        pending--;
        if (idlePromiseWithResolvers !== void 0 && queue.length === 0 && pending === 0) {
          idlePromiseWithResolvers.resolve();
          idlePromiseWithResolvers.completed = true;
        }
        browser ? next() : process.nextTick(next);
      });
      if (emptyPromiseWithResolvers !== void 0 && queue.length === 0) {
        emptyPromiseWithResolvers.resolve();
        emptyPromiseWithResolvers.completed = true;
      }
    }
    if (parameters.frequency !== void 0 && requests >= parameters.frequency) {
      timer = setTimeout(
        () => {
          timer = void 0;
          next();
        },
        1e3 - _timestamp % 1e3
      );
      return;
    }
  };
  return {
    size: () => queue.length,
    pending: () => {
      if (browser) {
        return new Promise(
          (resolve) => setTimeout(() => resolve(pending))
        );
      } else {
        return new Promise(
          (resolve) => setImmediate(() => resolve(pending))
        );
      }
    },
    add: (task) => {
      const { promise, resolve, reject } = promiseWithResolvers();
      queue.push({ task, resolve, reject });
      next();
      return promise.catch((error) => {
        Error.captureStackTrace(error);
        throw error;
      });
    },
    clear: () => {
      queue = new Array();
      clearTimeout(timer);
      timer = void 0;
    },
    isStarted: () => isStarted,
    start: () => {
      if (browser) {
        return new Promise(
          (resolve) => setTimeout(() => resolve(pending))
        ).then(() => {
          isStarted = true;
          next();
        });
      } else {
        return new Promise(
          (resolve) => process.nextTick(() => resolve(pending))
        ).then(() => {
          isStarted = true;
          next();
        });
      }
    },
    pause: () => {
      isStarted = false;
    },
    onIdle: () => {
      if (idlePromiseWithResolvers === void 0 || idlePromiseWithResolvers.completed) {
        if (queue.length === 0 && pending === 0)
          return Promise.resolve();
        idlePromiseWithResolvers = {
          ...promiseWithResolvers(),
          completed: false
        };
      }
      return idlePromiseWithResolvers.promise;
    },
    onEmpty: () => {
      if (emptyPromiseWithResolvers === void 0 || emptyPromiseWithResolvers.completed) {
        if (queue.length === 0)
          return Promise.resolve();
        emptyPromiseWithResolvers = {
          ...promiseWithResolvers(),
          completed: false
        };
      }
      return emptyPromiseWithResolvers.promise;
    },
    setParameters: (_parameters2) => {
      validateParameters(_parameters2);
      if ("frequency" in _parameters2) {
        parameters.frequency = _parameters2.frequency;
      }
      if ("concurrency" in _parameters2) {
        parameters.concurrency = _parameters2.concurrency;
      }
    }
  };
};

// src/rateLimit.ts
var rateLimit = (_transport, {
  requestsPerSecond,
  browser = true
}) => {
  return ({ chain, retryCount, timeout }) => {
    const transport = chain === void 0 ? _transport({ retryCount: 0, timeout }) : _transport({ chain, retryCount: 0, timeout });
    const queue = createQueue({
      frequency: requestsPerSecond,
      concurrency: Math.ceil(requestsPerSecond / 4),
      initialStart: true,
      browser,
      worker: (body) => {
        return transport.request(body);
      }
    });
    return _viem.createTransport.call(void 0, {
      key: "rateLimit",
      name: "Rate Limit",
      request: (body) => {
        return queue.add(body);
      },
      retryCount,
      type: "rateLimit"
    });
  };
};

// src/replaceBigInts.ts
var replaceBigInts = (obj, replacer) => {
  if (typeof obj === "bigint")
    return replacer(obj);
  if (Array.isArray(obj))
    return obj.map((x) => replaceBigInts(x, replacer));
  if (obj && typeof obj === "object")
    return Object.fromEntries(
      Object.entries(obj).map(([k, v]) => [k, replaceBigInts(v, replacer)])
    );
  return obj;
};






exports.getLogsRetryHelper = getLogsRetryHelper; exports.loadBalance = loadBalance; exports.mergeAbis = mergeAbis; exports.rateLimit = rateLimit; exports.replaceBigInts = replaceBigInts;
//# sourceMappingURL=index.cjs.map