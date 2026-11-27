import Inv48PostLoopJoinProof
open SolidCore.Solidity.Source EvmCompiler.Simulation
open Inv48.RequestGuards Inv48.RequestDispatch Inv48.RequestClassify Inv48.FundingFallthrough
open Inv48.WrapperTraversal
namespace Inv48.PostLoopJoin
set_option maxRecDepth 65536
set_option maxHeartbeats 20000000

theorem suffixNever (n : Nat) (c : Context) (r : Runtime) :
    NeverReturns (Stmt.evalList n Inv48.Source.model.core.table c r suffix) := by
  apply listNever
  intro s mem rt
  apply neverSound 100 s _ n _ c rt
  have all : suffix.all (simpleFalls 100) = true := by decide
  exact List.all_eq_true.mp all s mem

/-- Invert one enclosing continuation; no stage-success premise is supplied.
The resulting Site, internal entry/finish, and enclosing continuation all
belong to this same run. -/
theorem continuationEntry (n : Nat) (c : Context) (r : Runtime)
    (checked : c.checked = true) (p a b : Nat) (batch : Value)
    (hp : p < 2^256) (ha : a < 2^256) (hb : b < 2^256)
    (inputs : Inv48.BatchInputLoop.Inputs r p a b batch)
    (fn : InternalFunction)
    (registered : Inv48.Source.model.core.table.lookup? Inv48.RequestQuote.requestKey = some fn)
    (k : Result → SolI Result) (out : Result) (reject : Rejects k out)
    (tr : Interaction.Transcript)
    (run : Interaction.Executes
      (Stmt.evalList (n+7) Inv48.Source.model.core.table c r suffix >>= k) tr (.ok out)) :
    ∃ needed g, needed ≤ g ∧ g < 2^32 ∧ 4000000+g ≤ 10000000 ∧
      ∃ s : Site (Stmt.evalList (n+7) Inv48.Source.model.core.table c r suffix >>= k)
        Inv48.Source.model.core.table Inv48.SimpleWrapperArgs.call tr out,
        s.fuel = n+5 ∧ s.context = c ∧
        Inv48.WrapperArgs.TempValues s.runtime c.sender p a b (4000000+g) ∧
        ∃ result bt ft rest mid,
          s.after = (bt++ft)++rest ∧
          Interaction.Executes (Stmt.eval (n+4) Inv48.Source.model.core.table {c with checked := true}
            (Inv48.GuardArgsFrame.entry s.runtime c.sender p a b (4000000+g)) fn.body)
            bt (.ok result) ∧
          Interaction.Executes (internalCallFinish fn ["_ret__requestPrice_0"] s.runtime.locals result)
            ft (.ok (.normal mid)) ∧
          Interaction.Executes (s.continuation (.normal mid)) rest (.ok out) := by
  obtain ⟨v,during,after,split,first,last⟩ := bindSuccess _ _ _ _ run
  have normal : ∃ final, v = .normal final := by
    cases v with
    | normal final => exact ⟨final,rfl⟩
    | returned rt vs => exact False.elim (suffixNever (n+7) c r during rt vs first)
    | _ => apply False.elim; apply reject _ ?_ after last; trivial
  obtain ⟨final,rfl⟩ := normal
  obtain ⟨needed,g,le,hg,limit,s,fuel,context,temps,result,bt,ft,rest,mid,sp,body,finish,continuation⟩ :=
    suffixEntry n c r final checked p a b batch hp ha hb inputs fn registered during first
  let lifted : Site (Stmt.evalList (n+7) Inv48.Source.model.core.table c r suffix >>= k)
      Inv48.Source.model.core.table Inv48.SimpleWrapperArgs.call tr out :=
    { s with
      continuation := fun v => s.continuation v >>= k
      after := s.after ++ after
      split := by
        calc
          tr = during ++ after := split
          _ = (s.before ++ s.after) ++ after := congrArg (fun xs => xs ++ after) s.split
          _ = _ := by simp only [List.append_assoc]
      reached := by simpa only [assoc] using s.reached.bind k
      suffix := by
        have exec := Interaction.Executes.bind_ok s.suffix last
        change Interaction.Executes ((_ >>= s.continuation) >>= k) _ _ at exec
        simpa only [assoc] using exec }
  refine ⟨needed,g,le,hg,limit,lifted,fuel,context,temps,result,bt,ft,rest++after,mid,?_,body,finish,?_⟩
  · change s.after ++ after = _
    exact (congrArg (fun xs => xs ++ after) sp).trans (by simp only [List.append_assoc])
  · exact Interaction.Executes.bind_ok continuation last
end Inv48.PostLoopJoin
