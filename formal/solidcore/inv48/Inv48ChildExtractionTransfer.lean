import Inv48ChildExtractionNormal
import Inv48InitialTransferSite
open SolidCore.Solidity.Source EvmCompiler.Simulation
namespace Inv48.ChildExtraction
open Inv48.EscrowPrefix Inv48.EscrowJoin Inv48.EscrowEntry
set_option maxRecDepth 65536
set_option maxHeartbeats 4000000
theorem quotedAtSameChildTrace (k budget : Nat) (rows : ScriptedResponder) (parent c : Context) (state : State)
    (sponsor a p halt bounty gas oracle collateral : Nat)
    (site : Runtime) (id : Nat)
    (funding : Inv48.WholeQuote.HasFunding site id a p)
    (hw : a < 2^256) (ha : (Inv48.QuoteExec.repAmount a p) < 2^256) (hh : halt < 2^256)
    (hb : bounty < 2^256) (hg : gas < 2^32) (hp : parent.sender < 2^160)
    (senderBound : c.sender < 2^256) (selfBound : c.self < 2^256) (zeroValue : c.value = 0)
    (notConstruction : c.construction = false)
    (implementation universeBytes token : List Nat)
    (hi : implementation.length=20) (hu : universeBytes.length=31) (ht : token.length=20)
    (cu : ∀ b∈universeBytes,b<256) (ct : ∀ b∈token,b<256)
    (code : (lookupCaller (entry c state parent.sender sponsor a (Inv48.QuoteExec.repAmount a p) halt bounty gas).pushScope).state.envAccountCode c c.self =
      Inv48.CloneRead.runtimeCode implementation universeBytes token)
    (O : (Inv48.CloneGetters.tStart (Inv48.CloneGetters.post (lookupCaller (entry c state parent.sender sponsor a (Inv48.QuoteExec.repAmount a p) halt bounty gas).pushScope) (Inv48.CloneRead.runtimeCode implementation universeBytes token))).loadImmutableField c "openOracle" = .ok (.word oracle))
    (C : (Inv48.CloneGetters.tStart (Inv48.CloneGetters.post (lookupCaller (entry c state parent.sender sponsor a (Inv48.QuoteExec.repAmount a p) halt bounty gas).pushScope) (Inv48.CloneRead.runtimeCode implementation universeBytes token))).loadImmutableField c "collateralToken" = .ok (.word collateral))
    (openWorld : c.selfDispatch? = none)
    (childIsActual : c = Inv48.PublicInvariant.childContext parent
      (Inv48.RequestQuote.calldata 2391489481 parent.sender sponsor a
        (Inv48.QuoteExec.repAmount a p) halt bounty gas))
    (canonical : Inv48.ChildExtraction.Canonical
      (Inv48.RequestQuote.calldata 2391489481 parent.sender sponsor a
        (Inv48.QuoteExec.repAmount a p) halt bounty gas)
      (arguments parent.sender sponsor a (Inv48.QuoteExec.repAmount a p) halt bounty gas))
    (served : Inv48.NestedResponder.Served parent state
      (Inv48.RequestQuote.calldata 2391489481 parent.sender sponsor a
        (Inv48.QuoteExec.repAmount a p) halt bounty gas) (k+47) budget rows)
    (success : served.result.success = true) :
    (∃ h e s, site.lookupLocal? "quote" = some (.memoryRef id) ∧
      site.loadMemory? id = some (Inv48.QuoteMemory.tuple a
        (Inv03.ceilQuot (a*p) (10^18)) h e s)) ∧
    c.sender = c.self ∧ Inv48.InitialTransfer.Contains c parent.sender
      (Inv03.ceilQuot (a*p) (10^18)) (Inv48.CloneRead.decode token) served.nested.observed.trace := by
  obtain ⟨tree,final,entry,run⟩ := Inv48.ChildExtraction.normal (k+47) budget rows
    parent state parent.sender sponsor a p halt bounty gas canonical served success
  have applied := Inv48.InitialTransfer.quotedAtRequestSite k parent c state final sponsor a p
    halt bounty gas oracle collateral site id funding hw ha hh hb hg hp senderBound selfBound
    zeroValue notConstruction implementation universeBytes token hi hu ht cu ct code O C openWorld
    tree served.nested.observed.trace (by simpa only [childIsActual] using entry) run
  exact applied

#print axioms quotedAtSameChildTrace
end Inv48.ChildExtraction
