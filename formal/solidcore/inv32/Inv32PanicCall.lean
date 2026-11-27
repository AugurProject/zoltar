import Inv32TernaryCall
open SolidCore.Solidity.Source Inv32Division
namespace Inv32PanicCall
theorem callAt (table : FunctionTable) (links : Inv32Rejection.Links table) (n : Nat) (c : Context) (r : Runtime) (src : String) (targets : List String)
    (v : Nat) (hv : v<R) (bound : r.lookupLocal? src = some (.word v)) :
    ∃ next e, Stmt.eval (n+4) table c r (.internalCall targets Inv32Bodies.Panic.key [.var src]) =
      pure (.reverted next e) := by
  obtain ⟨fn,found,ps,rs,bd⟩ := links.panic
  let empty := {r with locals := []}
  let start := empty.withFrame [("code",Value.word v)]
  have enter : internalCallEnter? fn [.word v] r = some (start,r.locals) := by
    unfold internalCallEnter? InternalFunction.initialFrame? InternalFunction.returnDefaultBindings
    rw [ps,rs]; simp [Inv32Library.decl,BindingDecl.bindArgsRef?,BindingDecl.bindArgRef?,BindingDecl.bindArg?,
      Ty.coerceValue?,start,empty,Runtime.withFrame]
  obtain ⟨err,ev⟩ := Inv32Revert.panic n table {c with checked := true} empty v hv
  change Stmt.eval _ _ _ start _ = _ at ev
  rw [← bd] at ev
  exact ⟨start,err,Inv32Internal.call _ _ _ _ _ _ _ _ _ _ _ _ _ (Inv32FlagCalls.arg _ _ _ _ bound) found enter ev⟩

abbrev call := callAt Inv32Dispatch.model.core.table Inv32Rejection.trading
end Inv32PanicCall
