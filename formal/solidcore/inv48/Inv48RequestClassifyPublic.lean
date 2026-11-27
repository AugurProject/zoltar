import Inv48RequestClassifySource
import Inv48RequestClassifySelected
open SolidCore.Solidity.Source EvmCompiler.Simulation
open Inv48.RequestGuards Inv48.RequestDispatch
namespace Inv48.RequestClassify
set_option maxRecDepth 65536
set_option maxHeartbeats 8000000

/-- A completed public source run has a unique route branch. In the reached
branch its exact quote capture, prefix, suffix and context origin are extracted
from that run. This does not identify the exit branch with report noncreation. -/
structure PublicEvidence (fn : FunctionDef) (n : Nat) (c : Context) (state : State)
    (p a bounty : Nat) (trace : Interaction.Transcript) (out : Result) where
  route : Route Inv48.Source.model.core.table Inv48.RequestQuote.quoteCaptureP.value (n+9) fn.body
  partition :
    (Follows route c (Inv48.RequestPrologue.publicBase c state p a bounty) pure trace out false ∧
      ¬ Follows route c (Inv48.RequestPrologue.publicBase c state p a bounty) pure trace out true) ∨
    (Follows route c (Inv48.RequestPrologue.publicBase c state p a bounty) pure trace out true ∧
      ¬ Follows route c (Inv48.RequestPrologue.publicBase c state p a bounty) pure trace out false)
  capture : Follows route c (Inv48.RequestPrologue.publicBase c state p a bounty) pure trace out true →
    ∃ cut : Cut (n+9) Inv48.Source.model.core.table c
        (Inv48.RequestPrologue.publicBase c state p a bounty) fn.body,
      cut.statement = Inv48.RequestQuote.quoteCaptureP.value ∧
      ∃ after, trace = cut.trace++after ∧ Interaction.Executes
        (Stmt.eval cut.siteFuel Inv48.Source.model.core.table cut.context cut.runtime cut.statement >>=
          cut.continuation) after (.ok out)

theorem publicEvidence (fn : FunctionDef)
    (registered : Inv48.RequestPrologue.publicRequest = some fn) (n : Nat)
    (c : Context) (state : State) (p a bounty : Nat)
    (trace : Interaction.Transcript) (out : Result)
    (run : Interaction.Executes (Stmt.eval (n+9) Inv48.Source.model.core.table c
      (Inv48.RequestPrologue.publicBase c state p a bounty) fn.body) trace (.ok out)) :
    Nonempty (PublicEvidence fn n c state p a bounty trace out) := by
  obtain ⟨route⟩ := publicRoute fn registered n
  have unit : (Stmt.eval (n+9) Inv48.Source.model.core.table c
      (Inv48.RequestPrologue.publicBase c state p a bounty) fn.body >>= pure) =
      Stmt.eval (n+9) Inv48.Source.model.core.table c
      (Inv48.RequestPrologue.publicBase c state p a bounty) fn.body := Interaction.bind_pure _
  refine ⟨⟨route,exactPartition route c _ pure trace out (by rwa [unit]),?_⟩⟩
  intro reached
  obtain ⟨s,origin⟩ := selected route reached
  let cut : Cut (n+9) Inv48.Source.model.core.table c
      (Inv48.RequestPrologue.publicBase c state p a bounty) fn.body := {
    siteFuel := s.fuel
    context := s.context
    contextOrigin := origin
    runtime := s.runtime
    statement := Inv48.RequestQuote.quoteCaptureP.value
    trace := s.before
    continuation := s.continuation
    reached := by simpa only [unit] using s.reached }
  exact ⟨cut,rfl,s.after,s.split,s.suffix⟩

/-- Raw canonical ABI execution, including arbitrary transcript answers,
is connected to the source partition without any computed-search premise.
The final ABI success bit is deliberately not inferred from `.ok`. -/
theorem rawEvidence (n : Nat) (base : Context) (state : State)
    (self sender value : Nat) (data : List Byte) (p a bounty : Nat)
    (fn : FunctionDef) (registered : Inv48.RequestPrologue.publicRequest = some fn)
    (canonical : Canonical fn data p a bounty)
    (raw : SolI ABI.AbiCallResult) (trace : Interaction.Transcript) (out : ABI.AbiCallResult)
    (linked : ABI.Contract.callCalldataAtFromWithContext (n+9) Inv48.Source.model.core base state
      self sender value data = some raw)
    (run : Interaction.Executes raw trace (.ok out)) :
    let c := ABI.Contract.callContextAtWithBase Inv48.Source.model.core base self sender value data
    ∃ result, finish Inv48.Source.model.core fn state result = .ok out ∧
      Nonempty (PublicEvidence fn n c state p a bounty trace result) := by
  obtain ⟨result,body,done⟩ := publicBody (n+9) base state self sender value data p a bounty fn
    registered canonical raw trace out linked run
  exact ⟨result,done,publicEvidence fn registered n _ state p a bounty trace result body⟩
end Inv48.RequestClassify
