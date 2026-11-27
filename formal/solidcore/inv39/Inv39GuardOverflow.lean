import Inv39GuardReject
open SolidCore.Solidity SolidCore.Solidity.Source Inv32Division Inv32FloorStart
namespace Inv39.Child
private theorem okBind {α β : Type} (v : α) (f : α → SolI β) : pure v >>= f = f v := rfl
theorem sumOverflows (c : Context) (r : Runtime) (x y : Nat) (X : r.lookupLocal? "#view1586"=some (.word x))
    (Y : r.lookupLocal? "#operand1587"=some (.word y)) (xFit : x<R) (yFit : y<R) (large : R≤x+y) (checked : c.checked=true) :
    sumExpr.eval c r=throw (SolidityFailure.revert .overflow) := by
  have raw : checkedAdd true x y=.error .overflow := by
    simp only [checkedAdd,show Shared.norm x=x from Nat.mod_eq_of_lt xFit,show Shared.norm y=y from Nat.mod_eq_of_lt yFit]
    rw [if_pos (by simpa using large)]
  have bad : Source.BinaryOp.apply c.checked .add (.word x) (.word y)=.error .overflow := by
    simp [checked,Source.BinaryOp.apply,Value.forceAbiLazy,Source.BinaryOp.preservesFixedBytesWidth,Source.BinaryOp.applyWord,raw,Bind.bind,Except.bind]
  have inner (n : Nat) : Expr.evalFuel (n+3) c r (.binary .add (cv "#view1586") (cv "#operand1587")) = throw (SolidityFailure.revert .overflow) := by
    rw [Expr.evalFuel]
    simp only [readClean n c r _ _ xFit X,readClean n c r _ _ yFit Y,okBind,bad]; rfl
    all_goals intro h; cases h
  change Expr.evalFuel (_+3+1+1) c r (.castOp .uintCleanup 256 (.castOp .uintCleanup 256 (.binary .add _ _)))=_
  rw [Expr.evalFuel,Expr.evalFuel,inner]; rfl
theorem guardOverflow (n : Nat) (c : Context) (r : Runtime) (issued val cap : Nat)
    (quantity : r.lookupLocal? "valueAttoRep"=some (.word val)) (atIssued : r.state.loadSlot circulating.slot=issued)
    (atCap : r.state.loadSlot theoretical.slot=cap) (issuedFit : issued<R) (valFit : val<R) (large : R≤issued+val) (checked : c.checked=true)
    (fields : c.storageFields=model.core.context.storageFields) :
    Stmt.eval (n+7) model.core.table c r mintGuard.value = pure (.reverted r .overflow) := by
  let t := model.core.table
  let one := stateTmp r issued
  let two := one.declareLocal "#view1586" (.word issued)
  let three := two.declareLocal "#operand1587" (.word val)
  have zero := Inv32FloorStart.zero (n+5) t c r.pushScope tmp
  have get := fetchRun n c r issued fields atIssued issuedFit
  have dv := Inv32Hoist.declEval (n+5) t c one "#view1586" .uint256 (cv tmp) issued
    (readClean _ c one tmp issued issuedFit rfl) rfl
  have da := Inv32Hoist.declEval (n+5) t c two "#operand1587" .uint256 (cv "valueAttoRep") val
    (readClean _ c two "valueAttoRep" val valFit quantity) rfl
  have fail : Stmt.eval (n+6) t c three (.varDecl .uint256 "#operand1588" (some sumExpr))=pure (.reverted three .overflow) := by
    rw [Stmt.eval]; dsimp only; rw [sumOverflows _ _ _ _ rfl rfl issuedFit valFit large checked]; rfl
  exact Inv32Revert.blockRevert _ _ _ _ _ _ _ ((seqStep _ _ _ _ _ _ _ zero).trans ((seqStep _ _ _ _ _ _ _ get).trans
    ((seqStep _ _ _ _ _ _ _ dv).trans ((seqStep _ _ _ _ _ _ _ da).trans (Inv32Revert.stop _ _ _ _ _ _ _ _ fail)))))
end Inv39.Child
