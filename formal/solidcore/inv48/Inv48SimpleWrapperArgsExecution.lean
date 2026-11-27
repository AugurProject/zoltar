import Inv48SimpleWrapperArgsCore
import Inv48CloneGettersWrappers
open SolidCore.Solidity.Source EvmCompiler.Simulation
namespace Inv48.SimpleWrapperArgs
set_option maxRecDepth 65536
set_option maxHeartbeats 12000000
set_option linter.unusedSimpArgs false
private theorem caughtPure {α : Type} (v : α) : (pure v : SolI α).caught = pure (.ok v) := rfl
private theorem pb {α β : Type} (v : α) (k : α → SolI β) : pure v >>= k = k v := rfl

theorem getterExpression (c : Context) (r : Runtime) :
    Expr.eval c r (.castOp .uintCast 32 (.ternary (.word 1) (.word 4000000) (.word 4000000))) =
      pure (.word 4000000,r) := by
  rfl

theorem getterBody (n : Nat) (t : FunctionTable) (c : Context) (r : Runtime) :
    Stmt.eval (n+3) t c r getterBodyP.value = pure (.returned r [.word 4000000]) := by
  change Stmt.eval (n+3) t c r (.block [.skip,.block [.returnValues
    [.castOp .uintCast 32 (.ternary (.word 1) (.word 4000000) (.word 4000000))]]]) = _
  simp only [Stmt.eval,Stmt.evalList,pb]
  simp [Expr.evalReturnList,Expr.listEvalFuel,Expr.evalReturnListFuel,Expr.evalReturnValue,
    getterExpression,caughtPure,pb,Result.mapRuntime,Runtime.pushScope,Runtime.popScope]

theorem getterCallExecution (n : Nat) (c : Context) (r : Runtime) :
    Stmt.eval (n+4) Inv48.Source.model.core.table c r
      (.internalCall [ret] getterKey []) = internalCallAssign r [ret] [.word 4000000] := by
  obtain ⟨fn,found,params,returns,body⟩ := getterMetadata
  rw [Stmt.eval]
  change (match Inv48.Source.model.core.table.lookup? getterKey with
    | none => pure (Result.reverted r .typeMismatch)
    | some fn => match internalCallEnter? fn [] r with
      | none => pure (Result.reverted r .typeMismatch)
      | some (inner,saved) => Stmt.eval (n+3) Inv48.Source.model.core.table
          {c with checked := true} inner fn.body >>= internalCallFinish fn [ret] saved) = _
  rw [found]
  dsimp only
  have entered : internalCallEnter? fn [] r = some
      ({r with locals := [[("_ret0",.word 0)]]},r.locals) := by
    simp [internalCallEnter?,InternalFunction.initialFrame?,InternalFunction.returnDefaultBindings,
      params,returns,BindingDecl.bindArgsRef?,BindingDecl.defaultBinding,Ty.defaultValue]
  rw [entered]
  dsimp only
  rw [body,getterBody]
  simp only [pb]
  simp [internalCallFinish,returns,coerceReturnBindingsRef,coerceReturnBindingsRef.coerce,Runtime.derefMemoryValueDeep,Runtime.derefMemoryValueWithFuel,
    BindingDecl.bindArgRef?,BindingDecl.bindArg?,Ty.coerceValue?]
  rfl

theorem getterBlockExecution (n : Nat) (c : Context) (base : Runtime) :
    Stmt.eval (n+6) Inv48.Source.model.core.table c (base.declareLocal hoist (.word 0))
      getterBlock = pure (.normal (base.declareLocal hoist (.word 4000000))) := by
  let outer := base.declareLocal hoist (.word 0)
  let inner := outer.pushScope.declareLocal ret (.word 0)
  let captured := outer.pushScope.declareLocal ret (.word 4000000)
  let copied := (base.declareLocal hoist (.word 4000000)).pushScope.declareLocal ret (.word 4000000)
  have decl : Stmt.eval (n+5) Inv48.Source.model.core.table c outer.pushScope
      (.varDecl .uint256 ret none) = pure (.normal inner) := by
    simpa only [inner,Ty.defaultValue] using
      (Inv48.CloneGetters.decl_none (n+4) Inv48.Source.model.core.table c outer.pushScope .uint256 ret)
  have capture := Inv48.PositiveHoist.takeReturn (n+4) Inv48.Source.model.core.table c inner captured
    ret getterKey [] 4000000 (getterCallExecution n c inner) (by
      simp [inner,captured,Runtime.declareLocal,Runtime.pushScope,Runtime.assignLocal?,
        Runtime.lookupLocal?,LocalEnv.declare,LocalEnv.lookup?,Frame.lookup?,LocalEnv.assign?,
        Frame.assign?,Value.coerceLike?])
  have copy := Inv32Temps.copy (n+4) Inv48.Source.model.core.table c captured copied hoist ret
    0 4000000 (by
      cases h : base.locals <;>
      simp [captured,outer,hoist,ret,Runtime.declareLocal,Runtime.pushScope,Runtime.lookupLocal?,
        LocalEnv.declare,LocalEnv.lookup?,Frame.lookup?,h]) (by rfl) (by
      cases h : base.locals <;>
      simp [captured,copied,outer,hoist,ret,Runtime.declareLocal,Runtime.pushScope,Runtime.assignLocal?,
        Runtime.lookupLocal?,LocalEnv.declare,LocalEnv.lookup?,Frame.lookup?,LocalEnv.assign?,
        Frame.assign?,Value.coerceLike?,h])
  change Stmt.eval (n+5) _ c inner getterCall = pure (.normal captured) at capture
  have sequence : Stmt.evalList (n+5) Inv48.Source.model.core.table c outer.pushScope
      [.varDecl .uint256 ret none,getterCall,.assign (.var hoist) (.var ret)] = pure (.normal copied) := by
    rw [Inv32FloorStart.seqStep _ _ _ _ _ _ _ decl,
      Inv32FloorStart.seqStep _ _ _ _ _ _ _ capture,Inv48.WholeQuote.singleList,copy]
  have block := Inv48.PositiveHoist.block (n+5) Inv48.Source.model.core.table c outer copied _ sequence
  simpa [getterBlock,copied,outer,Runtime.popScope,Runtime.declareLocal,Runtime.pushScope,LocalEnv.declare] using block
end Inv48.SimpleWrapperArgs
