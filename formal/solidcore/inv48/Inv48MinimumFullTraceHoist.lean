import Inv48MinimumFullTraceSafe
open SolidCore.Solidity SolidCore.Solidity.Source EvmCompiler.Simulation
namespace Inv48.MinimumFullTrace
open Inv48.RequestDispatch Inv48.WrapperTraversal Inv48.MinimumCollateralTrace
set_option maxRecDepth 65536
set_option maxHeartbeats 20000000

theorem listEvents (depth fuel : Nat) (c : Context) (r : Runtime) (ss : List Source.Stmt)
    (safe : ss.all (stmtSafe depth Inv48.Source.model.core.table) = true)
    (run : Interaction.Executes (Stmt.evalList fuel Inv48.Source.model.core.table c r ss) tr result) :
    tr = [] :=
  quietEvents _ (listFromQuiet _ _ _ _ _ (fun s mem rt =>
    stmtQuiet depth _ s (List.all_eq_true.mp safe s mem) fuel c rt)) run

theorem captureCall (n : Nat) (c : Context) (r final : Runtime)
    (names : List String) (key : String) (args : List Source.Expr)
    (run : Interaction.Executes (Stmt.eval (n+2) Inv48.Source.model.core.table c r
      (.captureReturn names (.internalCall names key args))) tr (.ok (.normal final))) :
    Interaction.Executes (Stmt.eval (n+1) Inv48.Source.model.core.table c r
      (.internalCall names key args)) tr (.ok (.normal final)) := by
  rw [Stmt.eval] at run
  obtain ⟨v,a,b,split,first,last⟩ := bindSuccess _ _ _ _ run
  have never := Inv48.FundingFallthrough.neverSound 1 (.internalCall names key args) rfl (n+1)
    Inv48.Source.model.core.table c r
  cases v with
  | normal mid =>
    cases last
    simp only [List.append_nil] at split
    subst tr
    exact first
  | returned rt vs => exact False.elim (never _ _ _ first)
  | _ => cases last

/-- The helper invocation and its trace are cut directly from this hoist run.
The declaration, capture collector and reference-aware copy contribute no events. -/
theorem hoist (n : Nat) (c : Context) (r final : Runtime) (dst ret key : String)
    (run : Interaction.Executes (Stmt.eval (n+3) Inv48.Source.model.core.table c r
      (Inv48.Positive.simpleCode dst ret key)) tr (.ok (.normal final))) :
    ∃ caller called,
      Interaction.Executes (Stmt.eval (n+1) Inv48.Source.model.core.table c caller
        (.internalCall [ret] key [])) tr (.ok (.normal called)) := by
  obtain ⟨k,v,eq,eqOut,list⟩ := block _ _ _ _ _ _ _ run
  have keq : k = n+2 := by omega
  subst k
  cases v <;> simp only [Result.mapRuntime] at eqOut <;> try contradiction
  case normal copied =>
    change Interaction.Executes (Stmt.evalList (n+2) _ c r.pushScope
      ([.varDecl .uint256 ret none] ++
      [.captureReturn [ret] (.internalCall [ret] key []),.assign (.var dst) (.var ret)])) tr (.ok (.normal copied)) at list
    obtain ⟨caller,dt,rest,sp,decl,remaining⟩ := normalPrefix _ _ _ _ _ _ _ _ list
    obtain ⟨called,ct,xt,sp2,call,copy⟩ := normalPrefix (n+2) _ c caller copied
      [.captureReturn [ret] (.internalCall [ret] key [])] [.assign (.var dst) (.var ret)] rest remaining
    have dn : dt = [] := listEvents 2 _ _ _ _ (by simp [stmtSafe,Option.all]) decl
    have xn : xt = [] := listEvents 2 _ _ _ _ (by simp [stmtSafe,exprSafe]) copy
    have call := captureCall n c caller called [ret] key [] (singleton _ _ _ _ _ _ _ call)
    have traceEq : tr = ct := by rw [sp,sp2,dn,xn,List.nil_append,List.append_nil]
    exact ⟨caller,called,by rwa [traceEq]⟩
end Inv48.MinimumFullTrace
