import Inv36Execution
open SolidCore.Solidity.Source Inv32Dispatch Inv32Division
namespace Inv36Source
def returns (z : Nat × Nat) := [Value.word z.1,.word z.2]
theorem call (n : Nat) (ctx : Context) (r : Runtime) (a p : Nat) (ha : a<R) (hp : p<R)
    (A : r.lookupLocal? a0 = some (.word a)) (P : r.lookupLocal? a1 = some (.word p)) :
    let run := Stmt.eval (n+20) model.core.table ctx r callStmt
    match quote a p with
    | some z => run = internalCallAssign r [out0,out1] (returns z)
    | none => ∃ next err, run = pure (.reverted next err) := by
  obtain ⟨fn,lk,ps,rs,bd⟩ := linked
  let empty := {r with locals := []}
  let src := empty.withFrame (frm a p 0 0)
  have enter : internalCallEnter? fn [.word a,.word p] r = some (src,r.locals) := by
    unfold internalCallEnter? InternalFunction.initialFrame? InternalFunction.returnDefaultBindings
    rw [ps,rs]; simp [Inv32Library.decl,BindingDecl.bindArgsRef?,BindingDecl.bindArgRef?,BindingDecl.bindArg?,
      BindingDecl.defaultBinding,Ty.coerceValue?,Ty.defaultValue,frm,src,empty,Runtime.withFrame]
  have ev := execute n {ctx with checked := true} empty a p ha hp
  rw [← bd] at ev
  dsimp only
  cases Q : quote a p with
  | none =>
    rw [Q] at ev; obtain ⟨s,e,h⟩ := ev
    exact ⟨s,e,Inv32Internal.call _ _ _ _ _ _ _ _ _ _ _ _ _ (Inv32ProductCall.args _ _ _ _ _ _ A P) lk enter h⟩
  | some z =>
    rw [Q] at ev
    let next := empty.withFrame (frm a p z.1 z.2)
    change Stmt.eval _ _ _ src fn.body = pure (.normal next) at ev
    unfold callStmt
    rw [Inv32Internal.call _ _ _ _ _ _ _ _ _ _ _ _ _ (Inv32ProductCall.args _ _ _ _ _ _ A P) lk enter ev]
    simp [internalCallFinish,rs,collectReturnBindingsRef,collectReturnBindingsRef.collect,Inv32Library.decl,
      next,frm,empty,Runtime.withFrame,Runtime.lookupLocal?,LocalEnv.lookup?,Frame.lookup?,Runtime.derefMemoryValueDeep,
      Runtime.derefMemoryValueWithFuel,Ty.coerceValue?,Bind.bind,Except.bind,returns,yn,nn,cn,pn]
end Inv36Source
