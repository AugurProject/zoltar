import Inv48MinimumRepOperandFinish
open SolidCore.Solidity SolidCore.Solidity.Source EvmCompiler.Simulation
namespace Inv48.MinimumRepOperand
open Inv48.Positive Inv48.MinimumSuffixPath Inv32Actions Inv32Scalar Inv32Product
set_option maxRecDepth 65536
set_option maxHeartbeats 20000000
set_option linter.unusedSimpArgs false

private theorem pb {α β : Type} (x : α) (k : α → SolI β) :
    (pure x >>= k : SolI β) = k x := rfl

def roundCaller (post base : Runtime) (p C R : Nat) : Runtime :=
  { post with locals := (roundStage base p C R 0 0).locals }

theorem roundedCaller (path : Path n c r trace out) (s : Rounded path)
    (repEq : path.rep = repPost post base p C R)
    (hp : p < Inv32Division.R) (hr : R < Inv32Division.R) :
    s.caller = roundCaller post base p C R := by
  have declaredEq : s.declared = saved (repPost post base p C R) h2 0 := by
    have run := s.declareRun
    simp only [repEq,Stmt.evalList,Inv48.CloneGetters.decl_none] at run
    simp only [Ty.defaultValue,pure_bind,Stmt.evalList] at run
    exact Result.normal.inj (Inv48.CollateralReturnedMinimum.pureResult run).2
  have pre : runList c.checked (saved (repPost post base p C R) h2 0).pushScope roundArgs =
      some (roundCaller post base p C R) := by
    simp [roundArgs,runList,declare,declareZero,cleanWord,clean,Inv32Scalar.cast,localWord,literal,choice,
      enumOne,locals,h0,h1,h2,a0,a1,a2,a3,roundRet,phase2,phase1,root,start,saved,roundStage,roundCaller,repPost,
      Runtime.lookupLocal?,Runtime.declareLocal,Runtime.pushScope,Runtime.withFrame,
      LocalEnv.declare,LocalEnv.lookup?,Frame.lookup?,Ty.coerceValue?,Ty.defaultValue,
      Inv32Guards.cleanupWord c.checked R hr,Inv32Guards.cleanupWord c.checked p hp,
      projectWord]
    decide
  have pureArgs := runList_sound roundArgs (n+20) Inv48.Source.model.core.table c
    (saved (repPost post base p C R) h2 0).pushScope (roundCaller post base p C R)
    (by simp [roundArgs,listDepth,declare,declareZero]) pre
  have run := Inv48.CollateralCloneFuel.replayList (show n+2 ≤ n+20 by omega) _ _ _ _ _ _ s.argsRun
  rw [declaredEq,pureArgs] at run
  exact Result.normal.inj (Inv48.CollateralReturnedMinimum.pureResult run).2

theorem operands (path : Path n c r trace out) (s : Rounded path)
    (repEq : path.rep = repPost post base p C R)
    (hp : p < Inv32Division.R) (hr : R < Inv32Division.R) :
    Expr.evalRefArgList c s.caller [.var a0,.var a1,.var a2,.var a3] =
      pure ([.word R,.word (10^18),.word p,.word 1],s.caller) ∧
    s.caller.lookupLocal? h0 = some (.word C) := by
  have eq := roundedCaller path s repEq hp hr
  have A : s.caller.lookupLocal? a0 = some (.word R) := by
    rw [eq]
    simp [roundCaller,roundStage,phase2,phase1,root,start,saved,Runtime.pushScope,Runtime.withFrame,h0,h1,h2,a0,a1,a2,a3,roundRet,Runtime.lookupLocal?,Runtime.declareLocal,LocalEnv.declare,LocalEnv.lookup?,Frame.lookup?]
  have B : s.caller.lookupLocal? a1 = some (.word (10^18)) := by
    rw [eq]
    simp [roundCaller,roundStage,phase2,phase1,root,start,saved,Runtime.pushScope,Runtime.withFrame,h0,h1,h2,a0,a1,a2,a3,roundRet,Runtime.lookupLocal?,Runtime.declareLocal,LocalEnv.declare,LocalEnv.lookup?,Frame.lookup?,a0,a1,a2,a3,roundRet]
  have P : s.caller.lookupLocal? a2 = some (.word p) := by
    rw [eq]
    simp [roundCaller,roundStage,phase2,phase1,root,start,saved,Runtime.pushScope,Runtime.withFrame,h0,h1,h2,a0,a1,a2,a3,roundRet,Runtime.lookupLocal?,Runtime.declareLocal,LocalEnv.declare,LocalEnv.lookup?,Frame.lookup?,a0,a1,a2,a3,roundRet]
  have O : s.caller.lookupLocal? a3 = some (.word 1) := by
    rw [eq]
    simp [roundCaller,roundStage,phase2,phase1,root,start,saved,Runtime.pushScope,Runtime.withFrame,h0,h1,h2,a0,a1,a2,a3,roundRet,Runtime.lookupLocal?,Runtime.declareLocal,LocalEnv.declare,LocalEnv.lookup?,Frame.lookup?,a0,a1,a2,a3,roundRet]
  constructor
  · have read (name : String) (v : Nat) (h : s.caller.lookupLocal? name = some (.word v)) :
        Expr.evalRefArg c s.caller (.var name) = pure (.word v,s.caller) := by
      simp only [Expr.evalRefArg,Runtime.lookupStorageBase?,Runtime.lookupMemoryRef?,h]
      exact Inv32Guards.readWord _ _ _ _ _ h
    simp only [Expr.evalRefArgList,Expr.listEvalFuel,Expr.orderFuel,Expr.evalRefArgListFuel,
      read a0 R A,read a1 (10^18) B,read a2 p P,read a3 1 O,pb]

  · rw [eq]
    simp [roundCaller,roundStage,phase2,phase1,root,start,saved,h0,h1,h2,a0,a1,a2,a3,roundRet,
      Runtime.lookupLocal?,Runtime.declareLocal,Runtime.pushScope,Runtime.withFrame,
      LocalEnv.declare,LocalEnv.lookup?,Frame.lookup?]

#print axioms roundedCaller
#print axioms operands
end Inv48.MinimumRepOperand
