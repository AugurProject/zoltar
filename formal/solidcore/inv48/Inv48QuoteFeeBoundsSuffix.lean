import Inv48QuoteFeeBoundsPrefix
open SolidCore.Solidity.Source EvmCompiler.Simulation Inv32Division Inv32FloorHoist Inv32CeilFlags
namespace Inv48.QuoteFeeBounds
open Inv48.QuoteMemory Inv48.WholeQuote Inv48.FundingMathTail Inv48.QuoteEntryTail Inv48.QuoteOperandReads
set_option maxRecDepth 65536
set_option maxHeartbeats 16000000

theorem suffixFailure (n : Nat) (c : Context) (r : Runtime) (rows : ScriptedResponder)
    (id a b h e s multiplier minimum bounty : Nat)
    (before : Inv48.QuoteTailPreserve.Keeps r id a b)
    (mem : r.loadMemory? id = some (tuple a b h e s))
    (ha : a<R) (hmul : multiplier<R) (haltFits : a*multiplier/10000<R)
    (hc : a≤2^128-1) (hr : b≤2^128-1) (hb : bounty≤2^96-1)
    (hmin : minimum<R) (minle : minimum≤a) (exposureFits : (a-minimum)*100<R)
    (haltArgs : Inputs c r h0 Inv48.FundingMathTail.haltX Inv48.FundingMathTail.haltY Inv48.FundingMathTail.denom a multiplier 10000)
    (oracle : OracleInputs c (halted r id a b multiplier e s) rows)
    (earlier : id<(halted r id a b multiplier e s).nextMemory)
    (hh : max (a*multiplier/10000) (Inv03.ceilQuot oracle.exposure 100)≤2^128-1)
    (bountyRead : (oracleOut oracle).lookupLocal? "bountyAttoEth" = some (.word bounty))
    (minimumRead : (maximum (oracleOut oracle) id a b (a*multiplier/10000) e s
      (Inv03.ceilQuot oracle.exposure 100)).loadImmutableField c "minimumReportCollateral" = .ok (.word minimum))
    (failed : Runtime) (err : RevertData)
    (failure : Stmt.evalList (n+52) table c (exposed (oracleOut oracle) id a b
      (a*multiplier/10000) e s (Inv03.ceilQuot oracle.exposure 100) minimum)
      (floorCode 4 Inv48.FundingMathTail.feeX Inv48.FundingMathTail.feeY Inv48.FundingMathTail.denom) = pure (.reverted failed err)) :
    (Stmt.evalList (n+52) table c r (actualStatements.drop 5)).runWith rows = .ok (.reverted failed err) := by
  let mid := halted r id a b multiplier e s
  have first := floorHalt (n+37) table productLink floorLink c r id a b h e s
    a multiplier 10000 Inv48.FundingMathTail.haltX Inv48.FundingMathTail.haltY Inv48.FundingMathTail.denom before.1 mem ha hmul (by decide) (by decide) haltFits haltArgs
  simp only [Nat.add_assoc] at first
  change Stmt.evalList (n+52) table c r (floorCode 2 Inv48.FundingMathTail.haltX Inv48.FundingMathTail.haltY Inv48.FundingMathTail.denom) = pure (.normal mid) at first
  have midRef : mid.lookupLocal? "quote" = some (.memoryRef id) :=
    (store_other r _ "quote" (by decide)).trans before.1
  have midMem : mid.loadMemory? id = some (tuple a b (a*multiplier/10000) e s) := put_load _ _ _ _ _ _ _
  have midKeeps : Inv48.QuoteTailPreserve.Keeps mid id a b :=
    ⟨midRef,a*multiplier/10000,e,s,midMem⟩
  have oracleRun := oracleStageRun n c mid rows id a b oracle earlier midKeeps
  have oracleMem : (oracleOut oracle).loadMemory? id = some (tuple a b (a*multiplier/10000) e s) :=
    oracleRun.2.1.trans midMem
  have exposureRead : (oracleOut oracle).lookupLocal? "exposureEscalationHaltAttoEth" =
      some (.word (Inv03.ceilQuot oracle.exposure 100)) := by
    cases H : (aggregateOut oracle).locals <;>
      simp [oracleOut,Inv32OneArg.store,Runtime.declareLocal,LocalEnv.declare,
        Runtime.lookupLocal?,LocalEnv.lookup?,Frame.lookup?,H]
  have done := finishFailure n c (oracleOut oracle) id a b (a*multiplier/10000) e s
    (Inv03.ceilQuot oracle.exposure 100) minimum bounty oracleRun.2.2 oracleMem ha hh hc hr hb
    hmin minle exposureFits exposureRead bountyRead minimumRead failed err failure
  rw [actualSuffix]
  change (Stmt.evalList (n+52) table c r
    (floorCode 2 Inv48.FundingMathTail.haltX Inv48.FundingMathTail.haltY Inv48.FundingMathTail.denom ++ (oracleP.map (·.value) ++ finishCode Inv48.FundingMathTail.feeX Inv48.FundingMathTail.feeY Inv48.FundingMathTail.denom))).runWith rows = _
  rw [appendNormal _ _ _ _ mid _ _ first,appendRun _ _ _ _ rows _ _ oracleRun.1,done]
  rfl
end Inv48.QuoteFeeBounds
