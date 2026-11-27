import Inv48LiquidationVerifiedNestedFloor
import Inv48LiquidationGuardLibraryShape
open SolidCore.Solidity.Source EvmCompiler.Simulation Inv32Division
namespace LiquidationLibrary
set_option maxRecDepth 65536
set_option maxHeartbeats 20000000

def uncertaintyCondition : Expr := .binary .lt (.castOp .uintCleanup 256 (.var "uncertainty"))
  (.ternary (.word 1) (.word 10000000) (.word 10000000))
def uncertaintyRequire : Stmt := .requireStmt uncertaintyCondition (some "Invalid oracle uncertainty")

theorem ltValue (checked : Bool) (a b : Nat) (ha : a<R) (hb : b<R) :
    BinaryOp.apply checked .lt (.word a) (.word b) = .ok (.word (if a<b then 1 else 0)) := by
  have val (v : Nat) (h : v<R) : (SolidCore.Solidity.Shared.toEvmWord v).val.val = v := by
    change (v%R)%R = v
    simp [Nat.mod_eq_of_lt h]
  have truth : (SolidCore.Solidity.Shared.toEvmWord a < SolidCore.Solidity.Shared.toEvmWord b) ↔ a<b := by
    change (SolidCore.Solidity.Shared.toEvmWord a).val.val < (SolidCore.Solidity.Shared.toEvmWord b).val.val ↔ _
    rw [val a ha,val b hb]
  simp [BinaryOp.apply,BinaryOp.applyWord,Value.forceAbiLazy,BinaryOp.preservesFixedBytesWidth,
    SolidCore.Solidity.Shared.ltWord,SolidCore.Solidity.Shared.liftEvmBinary,
    EvmYul.UInt256.lt,truth,Bind.bind,Except.bind]
  split <;> rename_i cmp
  · simp_all [Bool.toUInt256]; rfl
  · simp_all [Bool.toUInt256,show ¬ a<b by omega]; rfl

theorem uncertaintyEval (c : Context) (r : Runtime) (u : Nat) (hu : u<R)
    (read : r.lookupLocal? "uncertainty" = some (.word u)) :
    Expr.eval c r uncertaintyCondition = pure (.word (if u<10000000 then 1 else 0),r) := by
  change Expr.evalFuel 5 c r uncertaintyCondition = _
  apply Inv32Eval.binary 4 c r .lt (by intro h; cases h) (by intro h; cases h)
  · exact Inv32Guards.clean 3 c r _ u hu (Inv32Guards.readWord 2 c r _ u read)
  · rfl
  · exact ltValue _ _ _ hu (by native_decide)

/-- This is the actual checked uncertainty require, inverted from its execution. -/
theorem uncertaintyFromRun (n : Nat) (c : Context) (r final : Runtime) (u : Nat)
    (hu : u<R) (read : r.lookupLocal? "uncertainty" = some (.word u))
    (tr : Interaction.Transcript)
    (run : Interaction.Executes (Stmt.eval (n+1) table c r uncertaintyRequire)
      tr (.ok (.normal final))) : u<10000000 ∧ tr=[] ∧ final=r := by
  change Interaction.Executes (Stmt.eval (n+1) table c r (.requireStmt uncertaintyCondition (some "Invalid oracle uncertainty"))) _ _ at run
  rw [Stmt.eval] at run
  dsimp only at run
  rw [uncertaintyEval c r u hu read] at run
  by_cases good : u<10000000
  · rw [if_pos good] at run
    cases run
    exact ⟨good,rfl,rfl⟩
  · rw [if_neg good] at run
    cases run

/-- Exact syntactic location in the current generated liquidation library. -/
theorem requireSource : (match actualLiquidationLibraryBody with
    | .block [_,_,_,.block (s::_)] => some s
    | _ => none) = some uncertaintyRequire := rfl

#print axioms uncertaintyFromRun
#print axioms requireSource
end LiquidationLibrary
