import Inv45AddBranches
open SolidCore.Solidity SolidCore.Solidity.Source Inv32Division Inv32Shapes Inv03.Bodies
namespace Inv45.Add
def arguments (r : Runtime) (v : Int) (a : Nat) :=
  r.withFrame [("value",.int (Signed.word v)),("addend",.word a),("_ret0",.int 0)]
theorem execution (n : Nat) (c : Context) (r : Runtime) (v : Int) (a : Nat) (V : Signed.inRange v) (A : a<R)
    (out : Signed.inRange (v+↑a)) :
    Stmt.eval (n+11) model.core.table c (arguments r v a) fn.body =
      pure (.returned (arguments r v a) [.int (Signed.word (v+↑a))]) := by
  let t := model.core.table
  let src := arguments r v a
  have norm : Shared.norm (Signed.word v)=Signed.word v := Nat.mod_eq_of_lt (Signed.wordFit _ V)
  have asg := Shapes.assignInput (n+9) t c src.pushScope v V rfl
    (by simp [src,arguments,Runtime.assignLocal?,Runtime.assignLocalRaw?,Runtime.lookupLocal?,Runtime.withFrame,Runtime.pushScope,
      LocalEnv.assign?,LocalEnv.lookup?,Frame.lookup?,Frame.assign?,Value.coerceLike?,norm])
  have ac := Inv32FloorFastPath.cleanParamExec (n+9) t c src.pushScope "addend" a A rfl
    (by simp [src,arguments,Runtime.assignLocal?,Runtime.assignLocalRaw?,Runtime.lookupLocal?,Runtime.withFrame,Runtime.pushScope,
      LocalEnv.assign?,LocalEnv.lookup?,Frame.lookup?,Frame.assign?,Value.coerceLike?])
  have sk : Stmt.eval (n+10) t c src.pushScope .skip=pure (.normal src.pushScope) := by rw [Stmt.eval]
  have bodyRun := inner n c src.pushScope v a V A out rfl rfl
  rw [source]
  apply Inv32FloorFastPath.blockReturned (n+10) t c src src.pushScope _
  refine (Inv32FloorStart.seqStep _ _ _ _ _ _ _ asg).trans ?_
  refine (Inv32FloorStart.seqStep _ _ _ _ _ _ _ ac).trans ?_
  refine (Inv32FloorStart.seqStep _ _ _ _ _ _ _ sk).trans ?_
  exact Inv32FloorFastPath.stop _ _ _ _ _ _ [] _ bodyRun
theorem call (n : Nat) (c : Context) (r : Runtime) (v : Int) (a : Nat) (valueArg addArg : String) (targets : List String)
    (V : Signed.inRange v) (A : a<R) (out : Signed.inRange (v+↑a))
    (vHere : r.lookupLocal? valueArg=some (.int (Signed.word v))) (aHere : r.lookupLocal? addArg=some (.word a)) :
    Stmt.eval (n+12) model.core.table c r (.internalCall targets key [.var valueArg,.var addArg])=
      internalCallAssign r targets [.int (Signed.word (v+↑a))] := by
  let empty := {r with locals:=[]}
  have found : model.core.table.lookup? key=some fn := (Option.some_get existsFn).symm
  have refArg : Expr.evalRefArg c r (.var valueArg)=pure (.int (Signed.word v),r) := by
    simp only [Expr.evalRefArg,Runtime.lookupMemoryRef?,Runtime.lookupStorageBase?,vHere]
    exact readSignedLocal _ _ _ _ vHere _ (Nat.le_succ _)
  have args : Expr.evalRefArgList c r [.var valueArg,.var addArg]=pure ([.int (Signed.word v),.word a],r) := by
    change Expr.evalRefArgListFuel (_+1) c r [.var valueArg,.var addArg]=_
    simp only [Expr.orderFuel,Expr.listEvalFuel,Nat.reduceAdd,Expr.evalRefArgListFuel,refArg,
      Inv32ProductCall.wordArg _ _ _ _ aHere,Inv08.Authority.bindPure]
  obtain ⟨ps,rs⟩ := signature
  have enter : internalCallEnter? fn [.int (Signed.word v),.word a] r=some (arguments empty v a,r.locals) := by
    unfold internalCallEnter? InternalFunction.initialFrame? InternalFunction.returnDefaultBindings
    rw [ps,rs]
    simp [BindingDecl.bindArgsRef?,BindingDecl.bindArgRef?,BindingDecl.bindArg?,BindingDecl.defaultBinding,
      Ty.coerceValue?,Ty.defaultValue,arguments,empty,Runtime.withFrame]
  have ev := execution n {c with checked:=true} empty v a V A out
  rw [Inv32Internal.call _ _ _ _ _ _ _ _ _ _ _ _ _ args found enter ev]
  simp [internalCallFinish,rs,coerceReturnBindingsRef,coerceReturnBindingsRef.coerce,Runtime.derefMemoryValueDeep,
      Runtime.derefMemoryValueWithFuel,Ty.coerceValue?,Bind.bind,Except.bind,arguments,empty,Runtime.withFrame]
end Inv45.Add
