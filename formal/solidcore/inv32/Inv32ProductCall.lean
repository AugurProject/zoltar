import Inv32Internal
open SolidCore.Solidity.Source Inv32Division Inv32Internal Inv32Mul512
namespace Inv32ProductCall
theorem wordArg (c : Context) (r : Runtime) (name : String) (v : Nat)
    (localValue : r.lookupLocal? name = some (.word v)) :
    Expr.evalRefArg c r (.var name) = pure (.word v,r) := by
  simp only [Expr.evalRefArg,Runtime.lookupStorageBase?,Runtime.lookupMemoryRef?,localValue]
  exact Inv32Guards.readWord _ _ _ _ _ localValue

private theorem pb {α β : Type} (a : α) (k : α → SolI β) : pure a >>= k = k a := rfl
theorem args (c : Context) (r : Runtime) (x y : String) (a b : Nat)
    (ha : r.lookupLocal? x = some (.word a)) (hb : r.lookupLocal? y = some (.word b)) :
    Expr.evalRefArgList c r [.var x,.var y] = pure ([.word a,.word b],r) := by
  change Expr.evalRefArgListFuel (_+1) c r [.var x,.var y] = _
  simp only [Expr.orderFuel,Expr.listEvalFuel,Nat.reduceAdd,Expr.evalRefArgListFuel,wordArg _ _ _ _ ha,wordArg _ _ _ _ hb,pb]

theorem evaluates (fuel : Nat) (c : Context) (r : Runtime) (x y : String)
    (targets : List String) (a b : Nat) (ha : a < R) (hb : b < R)
    (ax : r.lookupLocal? x = some (.word a)) (by' : r.lookupLocal? y = some (.word b))
    (enough : 6 ≤ fuel) :
    Stmt.eval (fuel+1) Inv32Dispatch.model.core.table c r
      (.internalCall targets Inv32Bodies.Mul512.key [.var x,.var y]) =
      internalCallAssign r targets [.word (a*b/R),.word (a*b%R)] := by
  obtain ⟨fn,found,ps,rs,bd⟩ := signature
  let empty := {r with locals := []}
  let start := empty.withFrame (frame a b 0 0)
  let done' := empty.withFrame (frame a b (a*b/R) (a*b%R))
  have enter : internalCallEnter? fn [.word a,.word b] r = some (start,r.locals) := by
    unfold internalCallEnter? InternalFunction.initialFrame? InternalFunction.returnDefaultBindings
    rw [ps,rs]
    simp [wordBindings,BindingDecl.bindArgsRef?,BindingDecl.bindArgRef?,BindingDecl.bindArg?,
      BindingDecl.defaultBinding,Ty.coerceValue?,Ty.defaultValue,start,empty,Runtime.withFrame,frame]
  have eval : Stmt.eval fuel Inv32Dispatch.model.core.table {c with checked := true} start fn.body =
      pure (.normal done') := by
    rw [bd]; exact generatedExecution _ _ _ _ _ _ ha hb enough
  rw [call _ _ _ _ _ _ _ _ _ _ _ _ _ (args _ _ _ _ _ _ ax by') found enter eval]
  simp only [internalCallFinish,rs]
  simp [collectReturnBindingsRef,collectReturnBindingsRef.collect,wordBindings,done',empty,frame,
    Runtime.withFrame,Runtime.lookupLocal?,LocalEnv.lookup?,Frame.lookup?,Runtime.derefMemoryValueDeep,
    Runtime.derefMemoryValueWithFuel,Ty.coerceValue?,Bind.bind,Except.bind]
end Inv32ProductCall
