import Inv48QuoteOperandReadsFee
import Inv48QuoteRangeFromSuccessFailure
import Inv48FundingMathTailScopes
import Inv48QuoteEntryTailCore
open SolidCore.Solidity.Source EvmCompiler.Simulation Inv32Division Inv32FloorHoist Inv32CeilFlags
namespace Inv48.QuoteRangeFromSuccess
open Inv48.QuoteMemory Inv48.WholeQuote Inv48.FundingMathTail Inv48.QuoteEntryTail Inv48.QuoteOperandReads
set_option maxRecDepth 65536
set_option maxHeartbeats 2000000
private theorem haltedRef (r : Runtime) (id a b m e s : Nat)
    (ref : r.lookupLocal? "quote" = some (.memoryRef id)) :
    (Inv48.FundingMathTail.halted r id a b m e s).lookupLocal? "quote" = some (.memoryRef id) :=
  (store_other r (a*m/10000) "quote" (by decide)).trans ref

private theorem maximumRef (r : Runtime) (id a b h e s v : Nat)
    (ref : r.lookupLocal? "quote" = some (.memoryRef id)) :
    (Inv48.FundingMathTail.maximum r id a b h e s v).lookupLocal? "quote" = some (.memoryRef id) := by
  unfold Inv48.FundingMathTail.maximum
  split <;> exact ref

private theorem maximumMem (r : Runtime) (id a b h e s v : Nat)
    (mem : r.loadMemory? id = some (tuple a b h e s)) :
    (Inv48.FundingMathTail.maximum r id a b h e s v).loadMemory? id = some (tuple a b (max h v) e s) := by
  unfold Inv48.FundingMathTail.maximum
  split
  next yes => rw [put_load,max_eq_right (Nat.le_of_lt yes)]
  next no => rw [max_eq_left (Nat.le_of_not_gt no)]; exact mem

private theorem maximumBounty (r : Runtime) (id a b h e s v bounty : Nat)
    (read : r.lookupLocal? "bountyAttoEth" = some (.word bounty)) :
    (Inv48.FundingMathTail.maximum r id a b h e s v).lookupLocal? "bountyAttoEth" = some (.word bounty) := by
  unfold Inv48.FundingMathTail.maximum
  split <;> exact read

theorem tailFailure (n helperFuel : Nat) (c : Context) (r : Runtime) (rows : ScriptedResponder)
    (id a rep bounty multiplier : Nat)
    (ref : r.lookupLocal? "quote" = some (.memoryRef id))
    (mem : r.loadMemory? id = some (tuple a rep 0 0 0))
    (ha : a<R) (hb : bounty<R) (repFits : rep<R) (haltFits : a*multiplier/10000<R)
    (hmul : multiplier<R)
    (args : Inputs c r h0 Inv48.FundingMathTail.haltX Inv48.FundingMathTail.haltY Inv48.FundingMathTail.denom a multiplier 10000)
    (oracle : OracleInputs c (halted r id a rep multiplier 0 0) rows)
    (earlier : id<(halted r id a rep multiplier 0 0).nextMemory)
    (bountyRead : (oracleOut oracle).lookupLocal? "bountyAttoEth" = some (.word bounty))
    (bad : ¬ (a≤2^128-1 ∧ rep≤2^128-1 ∧
      max (a*multiplier/10000) (Inv03.ceilQuot oracle.exposure 100)≤2^128-1 ∧ bounty≤2^96-1)) :
    ∃ mid message, (Stmt.evalList (n+helperFuel+65) table c r (actualStatements.drop 5)).runWith rows =
      .ok (.reverted mid (.error message)) := by
  let mid := halted r id a rep multiplier 0 0
  let o := oracleOut oracle
  let v := Inv03.ceilQuot oracle.exposure 100
  let mx := Inv48.FundingMathTail.maximum o id a rep (a*multiplier/10000) 0 0 v
  have first := floorHalt (n+helperFuel+50) table productLink floorLink c r id a rep 0 0 0
    a multiplier 10000 Inv48.FundingMathTail.haltX Inv48.FundingMathTail.haltY Inv48.FundingMathTail.denom ref mem ha hmul (by decide) (by decide) haltFits args
  simp only [Nat.add_assoc] at first
  change Stmt.evalList (n+helperFuel+65) table c r (floorCode 2 Inv48.FundingMathTail.haltX Inv48.FundingMathTail.haltY Inv48.FundingMathTail.denom) = pure (.normal mid) at first
  have midRef : mid.lookupLocal? "quote" = some (.memoryRef id) :=
    haltedRef r id a rep multiplier 0 0 ref
  have midMem : mid.loadMemory? id = some (tuple a rep (a*multiplier/10000) 0 0) := put_load _ _ _ _ _ _ _
  have orun := oracleStageRun (n+helperFuel+13) c mid rows id a rep oracle earlier
    ⟨midRef,a*multiplier/10000,0,0,midMem⟩
  change ((Stmt.evalList (n+helperFuel+65) table c mid (oracleP.map (·.value))).runWith rows =
    .ok (.normal (oracleOut oracle))) ∧ _ at orun
  have omem : o.loadMemory? id = some (tuple a rep (a*multiplier/10000) 0 0) := orun.2.1.trans midMem
  have exposureRead : o.lookupLocal? "exposureEscalationHaltAttoEth" = some (.word v) := by
    cases H : (aggregateOut oracle).locals <;>
      simp [o,v,oracleOut,Inv32OneArg.store,Runtime.declareLocal,LocalEnv.declare,
        Runtime.lookupLocal?,LocalEnv.lookup?,Frame.lookup?,H]
  have vfits : v<R := by
    change Inv03.ceilQuot oracle.exposure 100<R
    by_cases z : oracle.exposure=0
    · simp [z,Inv03.ceilQuot,R]
    · have f := Inv48.MinimaCeil.scaledFactor oracle.exposure oracle.exposureFits
      simp only [if_neg z,Nat.one_mul] at f
      exact f.2 ▸ f.1
  have maximumRun := haltMaximum (n+helperFuel+63) table c o id a rep (a*multiplier/10000) 0 0 v
    orun.2.2.1 omem haltFits vfits exposureRead
  simp only [Nat.add_assoc] at maximumRun
  change Stmt.eval (n+helperFuel+65) table c o haltUpdateStmt = pure (.normal mx) at maximumRun
  have mxref : mx.lookupLocal? "quote" = some (.memoryRef id) :=
    maximumRef o id a rep (a*multiplier/10000) 0 0 v orun.2.2.1
  have mxmem : mx.loadMemory? id = some (tuple a rep (max (a*multiplier/10000) v) 0 0) :=
    maximumMem o id a rep (a*multiplier/10000) 0 0 v omem
  have mxBounty : mx.lookupLocal? "bountyAttoEth" = some (.word bounty) :=
    maximumBounty o id a rep (a*multiplier/10000) 0 0 v bounty bountyRead
  have maxFits : max (a*multiplier/10000) v<R := max_lt haltFits vfits
  obtain ⟨message,failure⟩ := guardsFailure (n+helperFuel+64) table c mx id a rep
    (max (a*multiplier/10000) v) 0 0 bounty mxref mxmem mxBounty ha repFits maxFits hb bad
  have suffixFail : (Stmt.evalList (n+helperFuel+65) table c r (actualStatements.drop 5)).runWith rows =
      .ok (.reverted mx (.error message)) := by
    rw [actualSuffix]
    unfold suffixCode finishCode
    simp only [List.append_assoc]
    rw [appendNormal _ _ _ _ mid _ _ first,appendRun _ _ _ _ rows _ _ orun.1]
    simp only [List.cons_append,List.nil_append]
    rw [Stmt.evalList,Inv48.PositiveRuns.bind,maximumRun]
    change (Stmt.evalList (n+helperFuel+65) table c mx _).runWith rows = _
    rw [listAppend,Inv48.PositiveRuns.bind,failure]
    rfl
  exact ⟨mx,message,suffixFail⟩

#print axioms tailFailure
end Inv48.QuoteRangeFromSuccess
