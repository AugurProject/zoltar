import Inv48InitialTransferPublic
import Inv48ChildExtractionNormal
import Inv48EscrowDecodeCanonical
open SolidCore.Solidity.Source EvmCompiler.Simulation
namespace Inv48.SingleTransferClosed
open Inv48.EscrowPrefix Inv48.EscrowJoin Inv48.EscrowEntry
set_option maxRecDepth 65536
set_option maxHeartbeats 4000000

def Transfer {fuel budget : Nat} {rows : ScriptedResponder} {parent : Context} {state : State}
    {sponsor a p halt bounty gas : Nat}
    (served : Inv48.NestedResponder.Served parent state
      (Inv48.RequestQuote.calldata 2391489481 parent.sender sponsor a
        (Inv48.QuoteExec.repAmount a p) halt bounty gas) fuel budget rows) : Prop :=
  ∀ (k : Nat), fuel = k+47 →
    let c := Inv48.PublicInvariant.childContext parent
      (Inv48.RequestQuote.calldata 2391489481 parent.sender sponsor a
        (Inv48.QuoteExec.repAmount a p) halt bounty gas)

  ∀ (oracle collateral : Nat)
    (_hw : a < 2^256) (_ha : (Inv48.QuoteExec.repAmount a p) < 2^256) (_hh : halt < 2^256)
    (_hb : bounty < 2^256) (_hg : gas < 2^32) (_hp : parent.sender < 2^160)
    (_notConstruction : c.construction = false)
    (implementation universeBytes token : List Nat)
    (_hi : implementation.length=20) (_hu : universeBytes.length=31) (_ht : token.length=20)
    (_cu : ∀ b∈universeBytes,b<256) (_ct : ∀ b∈token,b<256)
    (_code : (lookupCaller (entry c state parent.sender sponsor a (Inv48.QuoteExec.repAmount a p) halt bounty gas).pushScope).state.envAccountCode c c.self =
      Inv48.CloneRead.runtimeCode implementation universeBytes token)
    (_O : (Inv48.CloneGetters.tStart (Inv48.CloneGetters.post (lookupCaller (entry c state parent.sender sponsor a (Inv48.QuoteExec.repAmount a p) halt bounty gas).pushScope) (Inv48.CloneRead.runtimeCode implementation universeBytes token))).loadImmutableField c "openOracle" = .ok (.word oracle))
    (_C : (Inv48.CloneGetters.tStart (Inv48.CloneGetters.post (lookupCaller (entry c state parent.sender sponsor a (Inv48.QuoteExec.repAmount a p) halt bounty gas).pushScope) (Inv48.CloneRead.runtimeCode implementation universeBytes token))).loadImmutableField c "collateralToken" = .ok (.word collateral))
    ,
    c.sender = c.self ∧ Inv48.InitialTransfer.Contains c parent.sender
      (Inv03.ceilQuot (a*p) (10^18)) (Inv48.CloneRead.decode token) served.nested.observed.trace
theorem childTransferOfSuccess {fuel budget : Nat} {rows : ScriptedResponder} {parent : Context} {state : State}
    {sponsor a p halt bounty gas : Nat}
    (served : Inv48.NestedResponder.Served parent state
      (Inv48.RequestQuote.calldata 2391489481 parent.sender sponsor a
        (Inv48.QuoteExec.repAmount a p) halt bounty gas) fuel budget rows)
    (success : served.result.success = true)
    (hs : sponsor < 2^160) : Transfer served := by
  intro k fuelEq c oracle collateral hw ha hh hb hg hp
    notConstruction implementation universeBytes token hi hu ht cu ct code O C
  have senderBound : c.sender < 2^256 := Nat.mod_lt _ (by decide)
  have selfBound : c.self < 2^256 := Nat.mod_lt _ (by decide)
  have zeroValue : c.value = 0 := rfl
  have openWorld : c.selfDispatch? = none := rfl
  subst fuel
  obtain ⟨tree,final,binding,run⟩ := Inv48.ChildExtraction.normal (k+47) budget rows
    parent state parent.sender sponsor a p halt bounty gas
    (Inv48.EscrowDecode.canonical _ _ _ _ _ _ _ hp hs hw ha hh hb hg) served success
  exact Inv48.InitialTransfer.canonicalTranscript k _ state final parent.sender sponsor a
    (Inv48.QuoteExec.repAmount a p) halt bounty gas oracle collateral hw ha hh hb hg hp
    senderBound selfBound zeroValue notConstruction implementation universeBytes token hi hu ht cu ct
    code O C openWorld tree served.nested.observed.trace binding run

#print axioms childTransferOfSuccess
end Inv48.SingleTransferClosed
