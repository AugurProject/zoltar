import Inv32Library
open SolidCore.Solidity.Source Inv32Library Inv32Internal
namespace Inv32FlagCalls
private theorem pb {α β : Type} (a : α) (k : α → SolI β) : pure a >>= k = k a := rfl
theorem arg (c : Context) (r : Runtime) (name : String) (v : Nat)
    (read : r.lookupLocal? name = some (.word v)) :
    Expr.evalRefArgList c r [.var name] = pure ([.word v],r) := by
  change Expr.evalRefArgListFuel (_+1+1) c r [.var name] = _
  simp only [Expr.evalRefArgListFuel,Inv32ProductCall.wordArg _ _ _ _ read,pb]

theorem toUintAt (t : FunctionTable)
    (linked : LinkAt t Inv32Bodies.ToUint.key [.flag "b"] [.word "u"] Inv32Bodies.ToUint.body)
    (n : Nat) (c : Context) (r : Runtime) (name : String) (targets : List String) (b : Bool)
    (read : r.lookupLocal? name = some (.word (boolWord b))) :
    Stmt.eval (n+7) t c r (.internalCall targets Inv32Bodies.ToUint.key [.var name]) =
    internalCallAssign r targets [.word (boolWord b)] := by
  obtain ⟨f,found,ps,rs,bd⟩ := linked
  let empty := {r with locals := []}
  let source := empty.withFrame (Inv32BoolHelper.frame b 0)
  let dest := empty.withFrame (Inv32BoolHelper.frame b (boolWord b))
  have enter : internalCallEnter? f [.word (boolWord b)] r = some (source,r.locals) := by
    unfold internalCallEnter? InternalFunction.initialFrame? InternalFunction.returnDefaultBindings
    rw [ps,rs]; cases b <;> simp [decl,BindingDecl.bindArgsRef?,BindingDecl.bindArgRef?,BindingDecl.bindArg?,
      BindingDecl.defaultBinding,Ty.coerceValue?,Ty.defaultValue,source,empty,Runtime.withFrame,Inv32BoolHelper.frame,boolWord]
    all_goals rfl
  have ev : Stmt.eval (n+6) t {c with checked := true} source f.body = pure (.normal dest) := by
    rw [bd]; exact Inv32BoolHelper.execute _ _ _ _ _
  rw [call _ _ _ _ _ _ _ _ _ _ _ _ _ (arg _ _ _ _ read) found enter ev]
  simp only [internalCallFinish,rs]
  simp [collectReturnBindingsRef,collectReturnBindingsRef.collect,decl,dest,empty,Inv32BoolHelper.frame,
    Runtime.withFrame,Runtime.lookupLocal?,LocalEnv.lookup?,Frame.lookup?,Runtime.derefMemoryValueDeep,
    Runtime.derefMemoryValueWithFuel,Ty.coerceValue?,Bind.bind,Except.bind]

abbrev toUint := toUintAt Inv32Dispatch.model.core.table linkToUint

theorem roundsUpAt (t : FunctionTable)
    (linked : LinkAt t Inv32Bodies.RoundsUp.key [.word "rounding"] [.flag "_ret0"] Inv32Bodies.RoundsUp.body)
    (n : Nat) (c : Context) (r : Runtime) (name : String) (targets : List String) (i : Fin 4)
    (read : r.lookupLocal? name = some (.word i.val)) :
    Stmt.eval (n+4) t c r (.internalCall targets Inv32Bodies.RoundsUp.key [.var name]) =
    internalCallAssign r targets [.word (i.val%2)] := by
  obtain ⟨f,found,ps,rs,bd⟩ := linked
  let src := {r with locals := [[("rounding",Value.word i.val),("_ret0",.word 0)]]}
  have enter : internalCallEnter? f [.word i.val] r = some (src,r.locals) := by
    unfold internalCallEnter? InternalFunction.initialFrame? InternalFunction.returnDefaultBindings
    rw [ps,rs]; simp [decl,BindingDecl.bindArgsRef?,BindingDecl.bindArgRef?,BindingDecl.bindArg?,
      BindingDecl.defaultBinding,Ty.coerceValue?,Ty.defaultValue,src]
  have ev : Stmt.eval (n+3) t {c with checked := true} src f.body =
      pure (.returned src [.word (i.val%2)]) := by
    rw [bd]; exact Inv32RoundingHelper.execute _ _ _ _ _ rfl
  rw [call _ _ _ _ _ _ _ _ _ _ _ _ _ (arg _ _ _ _ read) found enter ev]
  have valid : wordEq (i.val%2) 0 || wordEq (i.val%2) 1 := by
    have v : ∀ i : Fin 4, (wordEq (i.val%2) 0 || wordEq (i.val%2) 1) = true := by decide
    exact v i
  simp [internalCallFinish,rs,coerceReturnBindingsRef,coerceReturnBindingsRef.coerce,decl,src,
    Runtime.derefMemoryValueDeep,Runtime.derefMemoryValueWithFuel,Ty.coerceValue?,valid,Bind.bind,Except.bind]
abbrev roundsUp := roundsUpAt Inv32Dispatch.model.core.table linkRoundsUp

end Inv32FlagCalls
