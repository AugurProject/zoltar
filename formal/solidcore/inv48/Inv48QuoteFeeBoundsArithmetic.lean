import Inv48QuoteFeeBoundsSuffix
open SolidCore.Solidity.Source EvmCompiler.Simulation Inv32Division Inv32FloorHoist Inv32CeilFlags
namespace Inv48.QuoteFeeBounds
open Inv48.QuoteMemory Inv48.WholeQuote Inv48.FundingMathTail Inv48.QuoteEntryTail Inv48.QuoteOperandReads
set_option maxRecDepth 65536
set_option maxHeartbeats 16000000
private theorem pb {α β : Type} (v : α) (f : α → SolI β) : (pure v >>= f) = f v := rfl

theorem feeAdditionOverflow (c : Context) (r : Runtime) (priority : Nat)
    (hp : priority<R) (checked : c.checked=true)
    (read : r.loadImmutableField c "initialReportPriorityFeeAttoEthPerGas" = .ok (.word priority))
    (large : R≤EnvWord.blockBasefee.eval c+priority) :
    Expr.eval c r Inv48.FundingMathTail.feeX = throw (SolidityFailure.revert .overflow) := by
  have he := basefeeWord c
  have raw : checkedAdd true (EnvWord.blockBasefee.eval c) priority = .error .overflow := by
    simp only [checkedAdd,show SolidCore.Solidity.Shared.norm (EnvWord.blockBasefee.eval c) = EnvWord.blockBasefee.eval c from Nat.mod_eq_of_lt he,
      show SolidCore.Solidity.Shared.norm priority = priority from Nat.mod_eq_of_lt hp]
    rw [if_pos (by simpa using large)]
  have op : BinaryOp.apply c.checked .add (.word (EnvWord.blockBasefee.eval c)) (.word priority) = .error .overflow := by
    simp [checked,BinaryOp.apply,Value.forceAbiLazy,BinaryOp.preservesFixedBytesWidth,BinaryOp.applyWord,raw,Bind.bind,Except.bind]
  have envRead : Reads c r (.env .blockBasefee) (EnvWord.blockBasefee.eval c) := by
    intro fuel enough
    change 2≤fuel at enough
    cases fuel with
    | zero => omega
    | succ n => simp [Expr.evalFuel]
  have pri := immutableReads read
  have sumThrows (k : Nat) : Expr.evalFuel (k+5) c r
      (.binary .add (.castOp .uintCleanup 256 (.env .blockBasefee))
        (.castOp .uintCleanup 256 (.immutable "initialReportPriorityFeeAttoEthPerGas"))) =
      throw (SolidityFailure.revert .overflow) := by
    rw [Expr.evalFuel]
    have x := Inv08.MemoryMember.clean envRead he (k+4) (by change 3≤k+4; omega)
    have y := Inv08.MemoryMember.clean pri hp (k+4) (by change 3≤k+4; omega)
    simp only [x,y,pb,op]
    rfl
    all_goals intro h; cases h
  change Expr.evalFuel (1+5+1+1) c r (.castOp .uintCleanup 256 (.castOp .uintCleanup 256 (.binary .add (.castOp .uintCleanup 256 (.env .blockBasefee)) (.castOp .uintCleanup 256 (.immutable "initialReportPriorityFeeAttoEthPerGas"))))) = _
  rw [Expr.evalFuel,Expr.evalFuel,sumThrows]
  rfl

theorem floorAdditionOverflow (n : Nat) (c : Context) (r : Runtime) (priority : Nat)
    (hp : priority<R) (checked : c.checked=true)
    (read : r.loadImmutableField c "initialReportPriorityFeeAttoEthPerGas" = .ok (.word priority))
    (large : R≤EnvWord.blockBasefee.eval c+priority) :
    ∃ mid err, Stmt.evalList (n+3) table c r
      (floorCode 4 Inv48.FundingMathTail.feeX Inv48.FundingMathTail.feeY Inv48.FundingMathTail.denom) =
      pure (.reverted mid err) := by
  let st := Inv32FloorHoist.start r h0 0
  have failure := feeAdditionOverflow c st priority hp checked read large
  have decl : Stmt.eval (n+2) table c st (.varDecl .uint256 a0 (some Inv48.FundingMathTail.feeX)) =
      pure (.reverted st .overflow) := by
    rw [Stmt.eval]
    dsimp only
    rw [failure]
    rfl
  have block : Stmt.eval (n+3) table c (Inv32OneArg.store r h0 0)
      (code h0 Inv48.FundingMathTail.feeX Inv48.FundingMathTail.feeY Inv48.FundingMathTail.denom) = pure (.reverted st.popScope .overflow) := by
    unfold code
    apply Inv32Revert.blockRevert
    exact Inv32Revert.stop _ _ _ _ _ _ _ _ decl
  refine ⟨st.popScope,.overflow,?_⟩
  unfold floorCode
  exact (Inv32FloorStart.seqStep _ _ _ _ _ _ _ (Inv32FloorStart.zero (n+2) table c r h0)).trans
    (Inv32Revert.stop _ _ _ _ _ _ _ _ block)

/-- Exact budget: the quotient fits, without discarding the allowed remainder. -/
theorem quotientBudget (x y : Nat) : x*y/10000<R ↔ x*y<R*10000 := by
  exact Nat.div_lt_iff_lt_mul (by decide)
end Inv48.QuoteFeeBounds
