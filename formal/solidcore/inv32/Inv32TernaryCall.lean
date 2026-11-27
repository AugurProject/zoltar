import Inv32PanicChoice
open SolidCore.Solidity.Source Inv32Division Inv32PanicChoice Inv32FloorFastPath Inv32FloorStart
namespace Inv32TernaryCall
def body : Stmt := .block [.skip,cleanParam "a",cleanParam "b",.skip,
  .block [.unchecked (.block [.varDecl .uint256 outName none,stage,.returnValues [answer.core]])]]
theorem atBody : Inv32Bodies.Ternary.body = body := by rfl
theorem executeAt (table : FunctionTable) (links : Inv32Rejection.Links table) (n : Nat) (c : Context) (r : Runtime) (b : Bool) :
    let src := r.withFrame (frame b)
    Stmt.eval (n+13) table c src Inv32Bodies.Ternary.body = pure (.returned src [.word (value b)]) := by
  let t := table
  let src := r.withFrame (frame b)
  let outside := src.pushScope
  let root := bodyFrame r b
  let ctx := {c with checked := false}
  let after := saved root (boolWord b)
  let vs := [Value.word (value b)]
  have Z := zero (n+8) t ctx root outName
  have S := Inv32PanicChoice.stageExecAt table links n ctx r b
  have L := leaf (n+8) t ctx after b rfl (by
    intro k v h
    unfold env at h
    split at h <;> simp_all [after,saved,root,bodyFrame,frame,outName,Runtime.declareLocal,Runtime.pushScope,
      Runtime.withFrame,Runtime.lookupLocal?,LocalEnv.declare,LocalEnv.lookup?,Frame.lookup?])
  have list : Stmt.evalList (n+9) t ctx root [.varDecl .uint256 outName none,stage,.returnValues [answer.core]] =
      pure (.returned after vs) :=
    (seqStep _ _ _ _ _ _ _ Z).trans ((seqStep _ _ _ _ _ _ _ S).trans (stop _ _ _ _ _ _ [] _ L))
  have inner := blockReturned _ t ctx outside.pushScope _ _ _ list
  have un : Stmt.eval (n+11) t c outside.pushScope (.unchecked (.block [.varDecl .uint256 outName none,stage,.returnValues [answer.core]])) = pure (.returned after.popScope vs) := by
    rw [Stmt.eval]; exact inner
  have block' := blockReturned _ t c outside _ _ _ (stop _ _ _ _ _ _ [] _ un)
  have sk : Stmt.eval (n+12) t c outside .skip = pure (.normal outside) := by rw [Stmt.eval]
  have A := cleanParamExec (n+11) t c outside "a" 18 (by decide) rfl (by dsimp [outside,src]; store_flag)
  have B := cleanParamExec (n+11) t c outside "b" 17 (by decide) rfl (by dsimp [outside,src]; store_flag)
  rw [atBody]; unfold body; apply blockReturned _ _ _ src outside _ vs
  exact (seqStep _ _ _ _ _ _ _ sk).trans ((seqStep _ _ _ _ _ _ _ A).trans ((seqStep _ _ _ _ _ _ _ B).trans
    ((seqStep _ _ _ _ _ _ _ sk).trans (stop _ _ _ _ _ _ [] _ block'))))

theorem callAt (table : FunctionTable) (links : Inv32Rejection.Links table) (n : Nat) (c : Context) (r : Runtime) (x y z : String) (targets : List String) (b : Bool)
    (X : r.lookupLocal? x = some (.word (boolWord b))) (Y : r.lookupLocal? y = some (.word 18))
    (Z : r.lookupLocal? z = some (.word 17)) :
    Stmt.eval (n+14) table c r (.internalCall targets Inv32Bodies.Ternary.key [.var x,.var y,.var z]) =
    internalCallAssign r targets [.word (value b)] := by
  obtain ⟨fn,found,ps,rs,bd⟩ := links.ternary
  let empty := {r with locals := []}
  let source := empty.withFrame (frame b)
  have enter : internalCallEnter? fn [.word (boolWord b),.word 18,.word 17] r = some (source,r.locals) := by
    unfold internalCallEnter? InternalFunction.initialFrame? InternalFunction.returnDefaultBindings
    rw [ps,rs]; cases b <;> simp [Inv32Library.decl,BindingDecl.bindArgsRef?,BindingDecl.bindArgRef?,BindingDecl.bindArg?,
      BindingDecl.defaultBinding,Ty.coerceValue?,Ty.defaultValue,source,empty,Runtime.withFrame,frame,boolWord] <;> rfl
  have ev := executeAt table links n {c with checked := true} empty b
  change Stmt.eval _ _ _ source _ = _ at ev
  rw [←bd] at ev
  rw [Inv32Internal.call _ _ _ _ _ _ _ _ _ _ _ _ _ (Inv32FloorCall.args _ _ _ _ _ _ _ _ X Y Z) found enter ev]
  simp [internalCallFinish,rs,coerceReturnBindingsRef,coerceReturnBindingsRef.coerce,Inv32Library.decl,source,empty,
    Runtime.withFrame,Runtime.derefMemoryValueDeep,Runtime.derefMemoryValueWithFuel,Ty.coerceValue?,Bind.bind,Except.bind]

abbrev execute := executeAt Inv32Dispatch.model.core.table Inv32Rejection.trading
abbrev call := callAt Inv32Dispatch.model.core.table Inv32Rejection.trading
end Inv32TernaryCall
