import Inv48PostLoopJoinCore
open SolidCore.Solidity.Source EvmCompiler.Simulation
open Inv48.RequestGuards Inv48.RequestDispatch Inv48.RequestClassify Inv48.FundingFallthrough
namespace Inv48.PostLoopJoin
set_option maxRecDepth 65536
set_option maxHeartbeats 20000000
open Inv48.OperationsWrapperArgs

def requestContinuation (n : Nat) (c : Context) : Result → SolI Result := fun v =>
  (captureNext ["_ret__requestPrice_0"] v >>= listNext (n+2) Inv48.Source.model.core.table c
    [.assign (.var "_sol_hoist_0") (.var "_ret__requestPrice_0")]) >>= pop

theorem requestEquation (n : Nat) (c : Context) (r : Runtime) (p a b g : Nat)
    (hp : p < 2^256) (ha : a < 2^256) (hb : b < 2^256) (hg : g < 2^32)
    (inputs : ∃ batch, Inv48.BatchInputLoop.Inputs r p a b batch)
    (G : r.lookupLocal? "callbackGas" = some (.word g)) :
    Stmt.eval (n+3) Inv48.Source.model.core.table c r requestP.value =
      (Stmt.eval (n+1) Inv48.Source.model.core.table c (temps c r.pushScope p a b g)
        Inv48.SimpleWrapperArgs.call >>= requestContinuation n c) := by
  obtain ⟨batch,P,A,B,_⟩ := inputs
  rw [actualRequestPrefix,blockSplit,
    requestPrefixExecution (n+1) c r.pushScope p a b g hp ha hb hg
      (by simpa using P) (by simpa using A) (by simpa using B) (by simpa using G)]
  simp only [show ∀ (α β : Type) (a : α) (k : α → SolI β), pure a >>= k = k a from fun _ _ _ _ => rfl]
  rw [Stmt.eval]
  change ((Stmt.eval (n+1) _ c _ Inv48.SimpleWrapperArgs.call >>= captureNext _) >>= _) >>= _ = _
  unfold requestContinuation
  simp only [assoc]

/-- The actual request block supplies the same-run call Site and its checked
body entry/finish. Original inputs, rather than TempValues, are the boundary. -/
theorem actualEntry (n : Nat) (c : Context) (r final : Runtime) (p a b g : Nat) (batch : Value)
    (hp : p < 2^256) (ha : a < 2^256) (hb : b < 2^256) (hg : g < 2^32)
    (inputs : Inv48.BatchInputLoop.Inputs r p a b batch)
    (G : r.lookupLocal? "callbackGas" = some (.word g))
    (fn : InternalFunction)
    (registered : Inv48.Source.model.core.table.lookup? Inv48.RequestQuote.requestKey = some fn)
    (tr : Interaction.Transcript)
    (run : Interaction.Executes (Stmt.eval (n+3) Inv48.Source.model.core.table c r requestP.value)
      tr (.ok (.normal final))) :
    ∃ s : Site (Stmt.eval (n+3) Inv48.Source.model.core.table c r requestP.value)
        Inv48.Source.model.core.table Inv48.SimpleWrapperArgs.call tr (.normal final),
      s.fuel = n+1 ∧ s.context = c ∧ s.runtime = temps c r.pushScope p a b g ∧
      Inv48.WrapperArgs.TempValues s.runtime c.sender p a b g ∧
      ∃ result bt ft rest mid,
        s.after = (bt++ft)++rest ∧
        Interaction.Executes (Stmt.eval n Inv48.Source.model.core.table {c with checked := true}
          (Inv48.GuardArgsFrame.entry s.runtime c.sender p a b g) fn.body) bt (.ok result) ∧
        Interaction.Executes (internalCallFinish fn ["_ret__requestPrice_0"] s.runtime.locals result)
          ft (.ok (.normal mid)) ∧
        Interaction.Executes (s.continuation (.normal mid)) rest (.ok (.normal final)) := by
  have eq := requestEquation n c r p a b g hp ha hb hg ⟨batch,inputs⟩ G
  let s : Site (Stmt.eval (n+3) Inv48.Source.model.core.table c r requestP.value)
      Inv48.Source.model.core.table Inv48.SimpleWrapperArgs.call tr (.normal final) :=
    ⟨n+1,c,temps c r.pushScope p a b g,requestContinuation n c,[],tr,
      by simp,by rw [eq]; exact .refl _,by rwa [← eq]⟩
  obtain ⟨v,during,rest,split,first,last⟩ := bindSuccess _ _ _ _ s.suffix
  have never := Inv48.FundingFallthrough.neverSound 1 Inv48.SimpleWrapperArgs.call rfl
    (n+1) Inv48.Source.model.core.table c (temps c r.pushScope p a b g)
  have normal : ∃ mid, v = .normal mid := by
    cases v with
    | normal mid => exact ⟨mid,rfl⟩
    | returned rt vs => exact False.elim (never _ _ _ first)
    | _ => cases last
  obtain ⟨mid,rfl⟩ := normal
  obtain ⟨result,bt,ft,sp,body,finish,_⟩ := Inv48.WrapperArgs.actualEntry n c _ mid
    ["_ret__requestPrice_0"] fn registered c.sender p a b g
    (tempsValues c r.pushScope p a b g) during first
  exact ⟨s,rfl,rfl,rfl,tempsValues c r.pushScope p a b g,result,bt,ft,rest,mid,
    by simpa [sp] using split,body,finish,last⟩
end Inv48.PostLoopJoin
