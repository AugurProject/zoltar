"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ChunkCache = void 0;
class ChunkCache {
    constructor() {
        this.cache = new Map();
    }
    set(stemKey, accessedStem) {
        this.cache.set(stemKey, accessedStem);
    }
    get(stemHex) {
        return this.cache.get(stemHex);
    }
    del(stemHex) {
        this.cache.delete(stemHex);
    }
    commit() {
        const items = Array.from(this.cache.entries());
        this.clear();
        return items;
    }
    clear() {
        this.cache.clear();
    }
    size() {
        return this.cache.size;
    }
}
exports.ChunkCache = ChunkCache;
//# sourceMappingURL=chunkCache.js.map