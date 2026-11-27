import Inv48ObservedTailBoundsExposure
open SolidCore.Solidity.Source EvmCompiler.Simulation Inv32Division Inv32FloorHoist Inv32CeilFlags
namespace Inv48.ObservedTailBounds
open Inv48.QuoteMemory Inv48.WholeQuote Inv48.FundingMathTail Inv48.QuoteOperandReads
set_option maxRecDepth 65536
set_option maxHeartbeats 20000000

theorem finishBounds (n : Nat) (c : Context) (physical r last : Runtime)
    (id a b h e s v minimum bounty priority feeMul : Nat)
    (ref : r.lookupLocal? "quote" = some (.memoryRef id))
    (mem : r.loadMemory? id = some (tuple a b h e s))
    (ha : a<R) (hc : a≤2^128-1) (hr : b≤2^128-1)
    (hh : max h v≤2^128-1) (hb : bounty≤2^96-1)
    (exposureRead : r.lookupLocal? "exposureEscalationHaltAttoEth" = some (.word v))
    (bountyRead : r.lookupLocal? "bountyAttoEth" = some (.word bounty))
    (minimumWord : PhysicalWord c physical "minimumReportCollateral" minimum)
    (priorityWord : PhysicalWord c physical "initialReportPriorityFeeAttoEthPerGas" priority)
    (feeWord : PhysicalWord c physical "maxSettlementBaseFeeMultiplierBps" feeMul)
    (same : ∀ name, r.state.immutable? name = physical.state.immutable? name)
    (checked : c.checked=true) (rows : ScriptedResponder)
    (run : (Stmt.evalList (n+52) table c r
      (finishCode Inv48.FundingMathTail.feeX Inv48.FundingMathTail.feeY Inv48.FundingMathTail.denom)).runWith rows = .ok (.normal last)) :
    minimum≤a ∧ ∃ base,
      checkedAdd true (EnvWord.blockBasefee.eval c) priority = .ok base ∧
      base=EnvWord.blockBasefee.eval c+priority ∧ base<R ∧
      base*feeMul/10000<R ∧ base*feeMul<R*10000 := by
  let mx := maximum r id a b h e s v
  have hfit : h<R := lt_of_le_of_lt (le_trans (le_max_left h v) hh) (by decide)
  have vfit : v<R := lt_of_le_of_lt (le_trans (le_max_right h v) hh) (by decide)
  have maximumRun := haltMaximum (n+50) table c r id a b h e s v ref mem hfit vfit exposureRead
  have mxref : mx.lookupLocal? "quote" = some (.memoryRef id) := by
    dsimp [mx,maximum]; split <;> exact ref
  have mxmem : mx.loadMemory? id = some (tuple a b (max h v) e s) := by
    dsimp [mx,maximum]
    split
    next yes => rw [put_load,max_eq_right (Nat.le_of_lt yes)]
    next no => rw [max_eq_left (Nat.le_of_not_gt no)]; exact mem
  have mxBounty : mx.lookupLocal? "bountyAttoEth" = some (.word bounty) := by
    dsimp [mx,maximum]; split <;> exact bountyRead
  have guards := allUpperPreserve (n+51) table c mx id a b (max h v) e s bounty
    mxref mxmem mxBounty hc hr hh hb
  have mxsame (name : String) : mx.state.immutable? name = physical.state.immutable? name := by
    dsimp [mx,maximum]; split <;> exact same name
  have minimumRead := physicalRead minimumWord (mxsame _)
  simp only [Nat.add_assoc] at maximumRun guards
  have rest : (Stmt.evalList (n+52) table c mx
      (.assign (.index (.var "quote") (.word 3)) exposureExpr ::
        floorCode 4 Inv48.FundingMathTail.feeX Inv48.FundingMathTail.feeY Inv48.FundingMathTail.denom)).runWith rows = .ok (.normal last) := by
    dsimp only [finishCode] at run
    simp only [List.append_assoc] at run
    change (Stmt.evalList (n+52) table c r (haltUpdateStmt :: (upperGuards ++ _))).runWith rows = .ok (.normal last) at run
    rw [Stmt.evalList,maximumRun] at run
    change (Stmt.evalList (n+52) table c mx (upperGuards ++ _)).runWith rows = .ok (.normal last) at run
    rw [listAppend,guards] at run
    exact run
  have minle : minimum≤a := by
    by_contra bad
    have fail := exposureUnderflow c mx id a b (max h v) e s minimum mxref mxmem minimumRead
      ha minimumWord.fits checked (Nat.lt_of_not_ge bad)
    have assignment : Stmt.eval (n+52) table c mx (.assign (.index (.var "quote") (.word 3)) exposureExpr) = pure (.reverted mx .overflow) := by
      have failMem : Expr.evalMemoryRefPreserving c mx exposureExpr = throw (SolidityFailure.revert .overflow) := by
        unfold Expr.evalMemoryRefPreserving Expr.memoryRefOrValue
        simp only [exposureExpr,clean,Expr.orderFuel,Expr.memoryRefOrValueFuel]
        change Expr.evalFuel 17 c mx exposureExpr = _ at fail
        dsimp only [exposureExpr,clean,field,Expr.orderFuel] at fail ⊢
        rw [fail]
        rfl
      rw [Stmt.eval]
      dsimp only
      rw [fail,failMem]
      split <;> rfl
    rw [Stmt.evalList,assignment] at rest
    cases rest
  have expfit : (a-minimum)*100<R := by
    have le := Nat.mul_le_mul_right 100 (Nat.sub_le a minimum)
    have le' := Nat.mul_le_mul_right 100 hc
    exact lt_of_le_of_lt (le_trans le le') (by decide)
  let feeRuntime := exposed r id a b h e s v minimum
  have exp := exposureComputed (n+51) table c mx id a b (max h v) e s minimum
    mxref mxmem minimumRead ha minimumWord.fits minle expfit
  simp only [Nat.add_assoc] at exp
  rw [Stmt.evalList,exp] at rest
  change (Stmt.evalList (n+52) table c feeRuntime
    (floorCode 4 Inv48.FundingMathTail.feeX Inv48.FundingMathTail.feeY Inv48.FundingMathTail.denom)).runWith rows = .ok (.normal last) at rest
  have rejectFee (mid : Runtime) (err : RevertData)
      (failure : Stmt.evalList (n+52) table c feeRuntime
        (floorCode 4 Inv48.FundingMathTail.feeX Inv48.FundingMathTail.feeY Inv48.FundingMathTail.denom) = pure (.reverted mid err)) : False := by
    rw [failure] at rest
    cases rest
  have priorityRead : feeRuntime.loadImmutableField c "initialReportPriorityFeeAttoEthPerGas" = .ok (.word priority) := physicalRead priorityWord (mxsame _)
  have feeRead : feeRuntime.loadImmutableField c "maxSettlementBaseFeeMultiplierBps" = .ok (.word feeMul) := physicalRead feeWord (mxsame _)
  have addFit : EnvWord.blockBasefee.eval c+priority<R := by
    by_contra bad
    obtain ⟨mid,err,ev⟩ := Inv48.QuoteFeeBounds.floorAdditionOverflow (n+49) c feeRuntime priority priorityWord.fits checked priorityRead (Nat.le_of_not_gt bad)
    exact rejectFee mid err (by simpa only [Nat.add_assoc] using ev)
  let base := EnvWord.blockBasefee.eval c+priority
  have addSuccess : checkedAdd true (EnvWord.blockBasefee.eval c) priority = .ok base := by
    have word := Inv40.addWords true _ _ addFit
    cases raw : checkedAdd true (EnvWord.blockBasefee.eval c) priority with
    | error err => simp [BinaryOp.apply,BinaryOp.applyWord,BinaryOp.preservesFixedBytesWidth,Value.forceAbiLazy,Bind.bind,Except.bind,raw] at word
    | ok v =>
      have eq : v=base := by
        simpa [base,BinaryOp.apply,BinaryOp.applyWord,BinaryOp.preservesFixedBytesWidth,Value.forceAbiLazy,Bind.bind,Except.bind,raw] using word
      rw [eq]
  have args := feeInputs c feeRuntime priority feeMul base priorityWord.fits feeWord.fits
    (basefeeWord _) addSuccess priorityRead feeRead
  have fit : base*feeMul/10000<R := by
    by_contra bad
    obtain ⟨mid,err,ev⟩ := Inv48.QuoteWideBounds.floorHoistOverflow table Inv48.QuoteWideBounds.rejectionLinks
      (n+27) c feeRuntime h0 Inv48.FundingMathTail.feeX Inv48.FundingMathTail.feeY Inv48.FundingMathTail.denom
      base feeMul 10000 addFit feeWord.fits (by decide) (by decide) (Nat.le_of_not_gt bad) args
    have failure : Stmt.evalList (n+52) table c feeRuntime
        (floorCode 4 Inv48.FundingMathTail.feeX Inv48.FundingMathTail.feeY Inv48.FundingMathTail.denom) = pure (.reverted mid err) := by
      unfold floorCode
      exact (Inv32FloorStart.seqStep _ _ _ _ _ _ _ (Inv32FloorStart.zero (n+51) table c feeRuntime h0)).trans
        (Inv32Revert.stop _ _ _ _ _ _ _ _ (by simpa only [Nat.add_assoc] using ev))
    exact rejectFee mid err failure
  exact ⟨minle,base,addSuccess,rfl,addFit,fit,(Inv48.QuoteFeeBounds.quotientBudget _ _).mp fit⟩
#print axioms finishBounds
end Inv48.ObservedTailBounds
