import Inv48LiquidationVerifiedOperands
open SolidCore.Solidity.Source EvmCompiler.Simulation Inv32Division
namespace LiquidationBody
set_option maxRecDepth 65536
set_option maxHeartbeats 20000000
private theorem pb {α β : Type} (v : α) (k : α → SolI β) : pure v >>= k = k v := rfl

theorem hoistEval (n : Nat) (c : Context) (r : Runtime) (p u : Nat) (tail : Frame)
    (hp : p<R) (hu : u<10000000) (checked : c.checked=true) :
    Stmt.eval (n+15) t c
      ((entry r p u tail).pushScope.pushScope.declareLocal "_sol_hoist_0" (.word 0))
      (.block (setup ++ [nested,copy])) =
    pure (.normal ((entry r p u tail).pushScope.pushScope.declareLocal "_sol_hoist_0" (.word (q p u)))) := by
  apply Inv32FloorHoist.successAt t LiquidationLibrary.MathLinks.product LiquidationLibrary.MathLinks.floor
    n c (entry r p u tail).pushScope.pushScope "_sol_hoist_0" _ _ _
    p 10000000 (10000000+u) hp (by native_decide) (denominatorFits u hu) (by omega)
    (LiquidationLibrary.quotientFits p u hp) _ (by decide) (by decide) (by decide) (by decide)
  refine ⟨?_,?_,?_⟩
  · exact Inv32Guards.clean _ _ _ _ _ hp (Inv32Guards.readWord _ _ _ _ _ (by
      simp [Inv32FloorHoist.start,Inv32OneArg.store]; locals_simp))
  · rfl
  · apply denominatorEval _ _ u hu _ checked
    simp [Inv32FloorHoist.a1,Inv32FloorHoist.a0,Inv32FloorHoist.st2,Inv32FloorHoist.st1,Inv32FloorHoist.start,Inv32OneArg.store]
    locals_simp

theorem returnEval (n : Nat) (c : Context) (r : Runtime) (v : Nat) (hv : v<R)
    (V : r.lookupLocal? "_sol_hoist_0" = some (.word v)) :
    Stmt.eval (n+1) t c r ret = pure (.returned r [.word v]) := by
  have cast : uintCast? 256 (.word v) = .ok (.word v) := by
    simp [uintCast?,Value.forceAbiLazy,Value.asStorageWord?,SolidCore.Solidity.Shared.norm,
      show 2^256=R from rfl,Bind.bind,Except.bind]
    change v % R % R = v
    simp [Nat.mod_eq_of_lt hv]
  have ex : Expr.eval c r (.castOp .uintCleanup 256 (.castOp .uintCast 256 (.var "_sol_hoist_0"))) =
      pure (.word v,r) := by
    change Expr.evalFuel 4 c r _ = _
    apply Inv32Guards.clean _ _ _ _ _ hv
    rw [Expr.evalFuel,Inv32Guards.readWord _ _ _ _ _ V]
    simp only [pb,cast]
    rfl
  have vals : Expr.evalReturnList c r [.castOp .uintCleanup 256 (.castOp .uintCast 256 (.var "_sol_hoist_0"))] =
      pure ([.word v],r) := by
    change Expr.evalReturnListFuel 6 c r [_] = _
    simp only [Expr.evalReturnListFuel,Expr.evalReturnValue,ex,pb]
  change Stmt.eval (n+1) t c r (.returnValues [_]) = _
  rw [Stmt.eval]
  dsimp only
  rw [vals]
  rfl

/-- Complete actual library body, including hoist copy, cast, return collection,
and both scope exits. Its entire runtime is unchanged. -/
theorem bodyEval (n : Nat) (c : Context) (r : Runtime) (p u : Nat) (tail : Frame)
    (hp : p<R) (hu : u<10000000) (checked : c.checked=true) :
    Stmt.eval (n+17) t c (entry r p u tail) actualLiquidationLibraryBody =
      pure (.returned (entry r p u tail) [.word (q p u)]) := by
  have ub : u<R := by have := denominatorFits u hu; omega
  let outside := (entry r p u tail).pushScope
  let middle := outside.pushScope
  let finished := middle.declareLocal "_sol_hoist_0" (.word (q p u))
  have guard : Stmt.eval (n+15) t c middle requireU = pure (.normal middle) := by
    change Stmt.eval (n+15) t c middle (.requireStmt LiquidationLibrary.uncertaintyCondition (some "Invalid oracle uncertainty")) = _
    rw [Stmt.eval]
    dsimp only
    rw [LiquidationLibrary.uncertaintyEval c middle u ub (by dsimp [middle,outside]; locals_simp),if_pos hu]
    rfl
  have decl := Inv32FloorStart.zero (n+14) t c middle "_sol_hoist_0"
  have hoisted := hoistEval n c r p u tail hp hu checked
  have returned := returnEval (n+14) c finished (q p u)
    (LiquidationLibrary.quotientFits p u hp) (by dsimp [finished,middle,outside]; locals_simp)
  have list : Stmt.evalList (n+15) t c middle
      [requireU,.varDecl .uint256 "_sol_hoist_0" none,.block (setup ++ [nested,copy]),ret] =
      pure (.returned finished [.word (q p u)]) := by
    rw [Inv32FloorStart.seqStep _ _ _ _ _ _ _ guard,
      Inv32FloorStart.seqStep _ _ _ _ _ _ _ decl,
      Inv32FloorStart.seqStep _ _ _ _ _ _ _ hoisted]
    exact Inv32FloorFastPath.stop _ _ _ _ _ _ [] _ returned
  have body := Inv32FloorFastPath.blockReturned (n+15) t c outside finished _ _ list
  rw [bodyShape]
  apply Inv32FloorFastPath.blockReturned (n+16) t c _ finished.popScope _ _
  change Stmt.evalList (n+16) t c (entry r p u tail).pushScope
    ([clean "price",clean "uncertainty",.skip] ++
      [.block [requireU,.varDecl .uint256 "_sol_hoist_0" none,.block (setup ++ [nested,copy]),ret]]) = _
  rw [GuardRecovery.listAppend (n+16) t c _
    [clean "price",clean "uncertainty",.skip] [.block _],prologue (n+15) c r p u tail hp ub]
  change Stmt.evalList (n+16) t c outside [.block _] = _
  exact Inv32FloorFastPath.stop _ _ _ _ _ _ [] _ body

#print axioms hoistEval
#print axioms returnEval
#print axioms bodyEval
end LiquidationBody
