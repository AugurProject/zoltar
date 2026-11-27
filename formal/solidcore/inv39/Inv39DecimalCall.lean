import Inv39DecimalFrame
import Inv39ReturnStorage
import Inv32ProductCall
open SolidCore.Solidity.Source
namespace Inv39.Decimal
theorem call (n : Nat) (c : Context) (r : Runtime) (arg : String) (v : Nat) (targets : List String)
    (read : r.lookupLocal? arg=some (.word v)) :
    Frame.Ensures (Stmt.eval (n+1) model.core.table c r (.internalCall targets key [.var arg]))
      (fun out => out.runtime.state.storage=r.state.storage) := by
  obtain ⟨f,found,ps,rs,safe⟩ := linked
  let inner := {r with locals:=[[("absoluteValue",.word v),("_ret0",.bytes [])]]}
  have args : Expr.evalRefArgList c r [.var arg]=pure ([.word v],r) := by
    change (do let (a,s) ← Expr.evalRefArg c r (.var arg); let (vs,s') ← Expr.evalRefArgListFuel _ c s []; pure (a::vs,s'))=_
    rw [Inv32ProductCall.wordArg _ _ _ _ read]; rfl
  have enter : internalCallEnter? f [.word v] r=some (inner,r.locals) := by
    unfold internalCallEnter? InternalFunction.initialFrame? InternalFunction.returnDefaultBindings
    rw [ps,rs]
    simp [BindingDecl.bindArgsRef?,BindingDecl.bindArgRef?,BindingDecl.bindArg?,Ty.coerceValue?,BindingDecl.defaultBinding,Ty.defaultValue,inner]
  have initial : Frame.plainEnv inner.locals := by
    simp [inner,Frame.plainEnv,Frame.plainFrame,Frame.plain]
    rintro a b (⟨rfl,rfl⟩|⟨rfl,rfl⟩) <;> trivial
  rw [Stmt.eval]; dsimp only; rw [args]
  change Frame.Ensures (match model.core.table.lookup? key with
      | none => pure (Result.reverted r RevertData.typeMismatch)
      | some g => match internalCallEnter? g [.word v] r with
        | none => pure (Result.reverted r RevertData.typeMismatch)
        | some (start,saved) => Stmt.eval n model.core.table {c with checked:=true} start g.body >>= internalCallFinish g targets saved) _
  simp only [found,enter]
  apply Frame.bind (preserves f found n _ inner initial)
  intro result same
  exact Frame.weaken (Frame.finishStorage f targets r.locals result) (fun post h => h.trans same)
end Inv39.Decimal
