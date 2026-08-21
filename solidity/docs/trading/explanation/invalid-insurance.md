# INVALID insurance

INVALID is held, not traded. Each ordinary ETH entry returns one INVALID share for each base directional share created. If the question resolves INVALID, the holder can redeem through the authoritative SecurityPool winner path at the current collateral value.

This design removes the on-chain three-reserve quadratic and makes an ordinary entry insured against INVALID, but it cannot detect suspicious invalid markets from an INVALID price because no such price exists.

Worked INVALID result: Alice entered with enough ETH to mint 100 complete-set shares, received 190 YES after her swap, and retained 100 INVALID. If the final outcome is INVALID, the pair’s YES/NO balances do not become valuable merely because they are nonzero. Alice redeems her 100 winning INVALID through the pool. Retention means the refund is current net collateral value, not necessarily her original gross ETH.

LP providers likewise retain INVALID separately. Selling or transferring LP tokens does not move that insurance.
