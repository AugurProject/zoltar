import Inv48InitialTransferCore
open SolidCore.Solidity.Source EvmCompiler.Simulation
namespace Inv48.InitialTransfer
open Inv48.EscrowPrefix Inv48.EscrowJoin Inv48.EscrowEntry
set_option maxRecDepth 65536
set_option maxHeartbeats 4000000
theorem canonicalTranscript (k : Nat) (c : Context) (state : State)
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
    (openWorld : c.selfDispatch? = none)
    (tree : SolI Result) (trace : Interaction.Transcript)
    (binding : fn.evalBodyEntry (k+42+5) Inv48.Source.model.core.table c state
      (arguments payer sponsor weth amount halt bounty gas) = some tree)
    (run : ExecutesOK tree trace (.normal final)) :
    c.sender = c.self ∧ Contains c payer amount (Inv48.CloneRead.decode token) trace := by
  let response := Inv48.CloneGetters.tStart (Inv48.CloneGetters.post
    (lookupCaller (entry c state payer sponsor weth amount halt bounty gas).pushScope)
    (Inv48.CloneRead.runtimeCode implementation universeBytes token))
  have lookup := canonicalLookup k c
    (lookupCaller (entry c state payer sponsor weth amount halt bounty gas).pushScope)
    implementation universeBytes token hi hu ht cu ct selfBound code
  obtain ⟨self,rawFinal,_,suffix⟩ := suffixFromSuccessfulEntry (k+42) c state response final
    payer sponsor weth amount halt bounty gas (Inv48.CloneRead.decode token)
    hw ha hh hb hg senderBound selfBound zeroValue lookup tree trace binding run
  rw [← List.take_append_drop 4 (Inv48.EscrowTrace.actualStatements.drop 4)] at suffix
  obtain ⟨segmentEnd,segmentTrace,tailTrace,joined,segment,_⟩ :=
    appendNormal _ _ _ _ _ _ _ _ suffix
  obtain ⟨P,A,S,R,G,E⟩ := publicPreparedLocals c state response payer sponsor weth amount halt bounty gas (Inv48.CloneRead.decode token)
  have o : (publicPrepared c state response payer sponsor weth amount halt bounty gas (Inv48.CloneRead.decode token)).loadImmutableField c "openOracle" = .ok (.word oracle) := O
  have co : (publicPrepared c state response payer sponsor weth amount halt bounty gas (Inv48.CloneRead.decode token)).loadImmutableField c "collateralToken" = .ok (.word collateral) := C
  have witness := generatedTranscript (k+42) c _ segmentEnd payer amount sponsor oracle collateral
    (Inv48.CloneRead.decode token) gas 0 P A S o co R G E hp ha
    ((Inv48.CloneRead.token_bounds token ht ct).trans (by decide)) notConstruction openWorld segmentTrace segment
  obtain ⟨ls,ready,bytes,created,answer,pullTrace,rest,eq,success,bound⟩ := witness
  refine ⟨self,ls,ready,bytes,created,answer,pullTrace,rest++tailTrace,?_,success,bound⟩
  simp only [joined,eq,List.append_assoc]

/-- Registered transport export: no alternative quote computation is introduced. -/
def quoteTransport := Inv48.QuoteTransport.generatedTransport

end Inv48.InitialTransfer
