import Inv48OperationsPublicEntryGas
import Inv48QuoteMemoryGuards
open SolidCore.Solidity.Source EvmCompiler.Simulation
open Inv48.RequestGuards Inv48.RequestDispatch
namespace Inv48.OperationsPublicEntry
set_option maxRecDepth 65536
set_option maxHeartbeats 12000000

theorem leFailure (checked : Bool) (a b : Nat) (ha : a < 2^256) (hb : b < 2^256)
    (lt : b < a) : BinaryOp.apply checked .le (.word a) (.word b) = .ok (.word 0) := by
  have val (v : Nat) (h : v < 2^256) : (SolidCore.Solidity.Shared.toEvmWord v).val.val = v := by
    change (v % 2^256) % 2^256 = v
    rw [Nat.mod_eq_of_lt h,Nat.mod_eq_of_lt h]
  have cmp : SolidCore.Solidity.Shared.toEvmWord a > SolidCore.Solidity.Shared.toEvmWord b := by
    change (SolidCore.Solidity.Shared.toEvmWord b).val.val < (SolidCore.Solidity.Shared.toEvmWord a).val.val
    rw [val a ha,val b hb]
    exact lt
  simp [BinaryOp.apply,BinaryOp.applyWord,Value.forceAbiLazy,BinaryOp.preservesFixedBytesWidth,
    SolidCore.Solidity.Shared.gtWord,SolidCore.Solidity.Shared.liftEvmBinary,
    EvmYul.UInt256.gt,cmp,Bind.bind,Except.bind]
  rfl

/-- The numeric callback limit follows from the successful real guard, rather
than being supplied to the arithmetic theorem. -/
theorem callbackLimit (n : Nat) (c : Context) (r final : Runtime) (g : Nat)
    (hg : g < 2^32) (look : r.lookupLocal? "callbackGas" = some (.word (4000000+g)))
    (trace : Interaction.Transcript)
    (run : Interaction.Executes (Stmt.eval n Inv48.Source.model.core.table c r
      Inv48.OperationsWrapperArgs.limitP.value) trace (.ok (.normal final))) :
    4000000+g ≤ 10000000 ∧ final = r := by
  have read : Inv48.BatchReadFrame.Read
      (.binary .le (.castOp .uintCleanup 256 (.var "callbackGas"))
        (.ternary (.word 1) (.word 10000000) (.word 10000000))) :=
    .binary .le (by intro h; cases h) (by intro h; cases h) (.cast _ _ (.var _))
      (.ternary (.word _) (.word _) (.word _))
  have same := Inv48.BatchReadFrame.requireRuntime n Inv48.Source.model.core.table c _ _ read r final trace run
  refine ⟨?_,same⟩
  by_contra bad
  have hs : 4000000+g < 2^256 := by omega
  have condition : Expr.eval c r
      (.binary .le (.castOp .uintCleanup 256 (.var "callbackGas"))
        (.ternary (.word 1) (.word 10000000) (.word 10000000))) = pure (.word 0,r) := by
    change Expr.evalFuel 8 c r _ = _
    apply Inv32Eval.binary 7 c r .le (by intro h; cases h) (by intro h; cases h)
      _ _ (.word (4000000+g)) (.word 10000000)
    · exact Inv32Guards.clean 6 c r _ (4000000+g) hs (Inv32Guards.readWord 5 c r _ _ look)
    · rfl
    · exact leFailure c.checked _ _ hs (by decide) (by omega)
  cases n with
  | zero => rw [Stmt.eval] at run; cases run
  | succ n =>
    have failure : Stmt.eval (n+1) Inv48.Source.model.core.table c r
        Inv48.OperationsWrapperArgs.limitP.value =
        pure (.reverted r (.error "Callback gas exceeds limit")) := by
      change Stmt.eval (n+1) _ c r (.requireStmt
        (.binary .le (.castOp .uintCleanup 256 (.var "callbackGas"))
          (.ternary (.word 1) (.word 10000000) (.word 10000000)))
        (some "Callback gas exceeds limit")) = _
      rw [Stmt.eval]
      dsimp only
      rw [condition]
      rfl
    rw [failure] at run
    cases run

theorem callbackStageLimit (n : Nat) (c : Context) (r final : Runtime) (g : Nat)
    (hg : g < 2^32) (trace : Interaction.Transcript)
    (run : Interaction.Executes (Stmt.eval n Inv48.Source.model.core.table c (callbackStage r g)
      Inv48.OperationsWrapperArgs.limitP.value) trace (.ok (.normal final))) :
    4000000+g ≤ 10000000 ∧ (4000000+g) % 2^32 = 4000000+g ∧
      final = callbackStage r g := by
  obtain ⟨limit,same⟩ := callbackLimit n c (callbackStage r g) final g hg (by simp [callbackStage]) trace run
  exact ⟨limit,Inv48.OperationsWrapperArgs.checkedTotalFits g limit,same⟩
end Inv48.OperationsPublicEntry
