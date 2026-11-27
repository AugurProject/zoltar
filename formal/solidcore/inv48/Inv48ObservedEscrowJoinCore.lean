import Inv48FundingContinuationSite
import Inv48EscrowDecodeCanonical
open SolidCore.Solidity.Source EvmCompiler.Simulation
namespace Inv48.ObservedEscrowJoin
open Inv48.EscrowPrefix Inv48.QuoteTransport Inv48.FundingContinuation
set_option autoImplicit false
set_option maxRecDepth 65536
set_option maxHeartbeats 16000000

/-- Recover all downstream phases from a single successful generated suffix.
The preparation runtime and its empty transcript are conclusions. -/
theorem downstream (n : Nat) (c : Context) (start final : Runtime)
    (trace : Interaction.Transcript)
    (run : ExecutesOK (Stmt.evalList (n+2) Inv48.Source.model.core.table c start
      (Inv48.RequestQuote.actual.drop 7)) trace (.normal final)) :
    ∃ pending called last outer suffixTrace callTrace tailTrace outerTrace,
      trace = suffixTrace ++ callTrace ++ tailTrace ++ outerTrace ∧
      ExecutesOK (Stmt.evalList (n+2) Inv48.Source.model.core.table c start
        ((Inv48.RequestQuote.actual.drop 7).take 5)) suffixTrace (.normal pending) ∧
      ExecutesOK (Stmt.eval (n+1) Inv48.Source.model.core.table c (callPrep pending)
        Inv48.RequestQuote.callStmt) callTrace (.normal called) ∧
      ExecutesOK (Stmt.evalList (n+1) Inv48.Source.model.core.table c called
        (requestTail.drop 1)) tailTrace (.normal last) ∧
      last.popScope = outer ∧
      ExecutesOK (Stmt.evalList (n+2) Inv48.Source.model.core.table c outer
        (Inv48.RequestQuote.actual.drop 13)) outerTrace (.normal final) := by
  obtain ⟨pending,site,called,last,outer,st,pt,ct,tt,ot,split,writes,prep,call,tail,pop,finish⟩ :=
    actualSite n c start final trace run
  rw [prepEval] at prep
  cases prep
  exact ⟨pending,called,last,outer,st,ct,tt,ot,by simpa using split,writes,call,tail,pop,finish⟩

/-- Attach canonical extraction only to a matching event of the parent trace.
The responder wiring is explicit: this query must use this computed child's
response. A free-standing Served value cannot satisfy the event equality. -/
theorem childAtEvent (c : Context) (state : State)
    (payer sponsor a p halt bounty gas fuel budget : Nat) (rows : ScriptedResponder)
    (served : Inv48.NestedResponder.Served c state
      (Inv48.RequestQuote.calldata 2391489481 payer sponsor a
        (Inv48.QuoteExec.repAmount a p) halt bounty gas) fuel budget rows)
    (trace : Interaction.Transcript) (event : Interaction.Exchange)
    (member : event ∈ trace) (aligned : Inv48.ChildExtraction.Matches rows trace)
    (query : event.query = .external (snapshotWorld c state)
      (.call (buildCallRequest c .call c.self
        (Inv48.RequestQuote.calldata 2391489481 payer sponsor a
          (Inv48.QuoteExec.repAmount a p) halt bounty gas) 0 none)))
    (wiring : Inv48.NestedResponder.answer rows (.external (snapshotWorld c state)
      (.call (buildCallRequest c .call c.self
        (Inv48.RequestQuote.calldata 2391489481 payer sponsor a
          (Inv48.QuoteExec.repAmount a p) halt bounty gas) 0 none))) =
        some (Inv48.NestedResponder.response c state served.result))
    (enough : 47 ≤ fuel) (hp : payer < 2^160) (hs : sponsor < 2^160)
    (ha : a < 2^256) (hr : Inv48.QuoteExec.repAmount a p < 2^256)
    (hh : halt < 2^256) (hb : bounty < 2^256) (hg : gas < 2^32) :
    event = ⟨.external (snapshotWorld c state)
      (.call (buildCallRequest c .call c.self
        (Inv48.RequestQuote.calldata 2391489481 payer sponsor a
          (Inv48.QuoteExec.repAmount a p) halt bounty gas) 0 none)),
      Inv48.NestedResponder.response c state served.result⟩ ∧
    Inv48.PublicInvariant.SuccessfulBodyExtraction c state payer sponsor a p halt bounty gas
      fuel budget rows served := by
  have matched := aligned event member
  cases event with
  | mk q answer =>
    dsimp only at query
    subst q
    rw [wiring] at matched
    have eq := Option.some.inj matched
    dsimp only at eq
    subst answer
    exact ⟨rfl,Inv48.EscrowDecode.sufficient fuel budget rows c state payer sponsor a p halt bounty gas
      enough hp hs ha hr hh hb hg served⟩

#print axioms downstream
#print axioms childAtEvent
end Inv48.ObservedEscrowJoin
