import Inv48EndToEndFundingBoundaryCore
open SolidCore.Solidity.Source EvmCompiler.Simulation
namespace Inv48.EscrowEntry
open Inv48.EscrowPrefix
set_option maxRecDepth 65536
set_option maxHeartbeats 4000000
theorem canonicalChild (k : Nat) (c : Context) (state : State)
    (final : Runtime) (payer sponsor weth amount halt bounty gas oracle collateral : Nat)
    (hw : weth < 2^256) (ha : amount < 2^256) (hh : halt < 2^256)
    (hb : bounty < 2^256) (hg : gas < 2^32) (hp : payer < 2^160)
    (senderBound : c.sender < 2^256) (selfBound : c.self < 2^256) (zeroValue : c.value = 0)
    (notConstruction : c.construction = false)
    (implementation universeBytes token : List Nat)
    (hi : implementation.length=20) (hu : universeBytes.length=31) (ht : token.length=20)
    (cu : ∀ b∈universeBytes,b<256) (ct : ∀ b∈token,b<256)
    (code : (lookupCaller (entry c state payer sponsor weth amount halt bounty gas).pushScope).state.envAccountCode c c.self =
      Inv48.CloneRead.runtimeCode implementation universeBytes token)
    (O : (Inv48.CloneGetters.tStart (Inv48.CloneGetters.post (lookupCaller (entry c state payer sponsor weth amount halt bounty gas).pushScope) (Inv48.CloneRead.runtimeCode implementation universeBytes token))).loadImmutableField c "openOracle" = .ok (.word oracle))
    (C : (Inv48.CloneGetters.tStart (Inv48.CloneGetters.post (lookupCaller (entry c state payer sponsor weth amount halt bounty gas).pushScope) (Inv48.CloneRead.runtimeCode implementation universeBytes token))).loadImmutableField c "collateralToken" = .ok (.word collateral))
    (tree : SolI Result) (trace : Interaction.Transcript)
    (binding : fn.evalBodyEntry (k+42+5) Inv48.Source.model.core.table c state
      (arguments payer sponsor weth amount halt bounty gas) = some tree)
    (run : ExecutesOK tree trace (.normal final)) :
    c.sender = c.self ∧ TransferWitness (k+42) c (Inv48.CloneGetters.tStart (Inv48.CloneGetters.post (lookupCaller (entry c state payer sponsor weth amount halt bounty gas).pushScope) (Inv48.CloneRead.runtimeCode implementation universeBytes token))).state payer amount (Inv48.CloneRead.decode token) trace := by
  exact publicSuccessfulEntryIntoTransfer (k+42) c state _ final payer sponsor weth
    amount halt bounty gas _ oracle collateral hw ha hh hb hg hp ((Inv48.CloneRead.token_bounds token ht ct).trans (by decide)) senderBound selfBound
    zeroValue notConstruction O C
    (canonicalLookup k c _ implementation universeBytes token hi hu ht cu ct selfBound code)
    tree trace binding run
end Inv48.EscrowEntry
