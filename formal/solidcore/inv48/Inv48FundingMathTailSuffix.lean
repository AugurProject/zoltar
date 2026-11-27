import Inv48FundingMathTailFinish
import Inv48QuoteTailPreserveSource
open SolidCore.Solidity.Source Inv32Division Inv32FloorHoist Inv32CeilFlags EvmCompiler.Simulation
namespace Inv48.FundingMathTail
open Inv48.QuoteMemory Inv48.WholeQuote
set_option maxRecDepth 65536
set_option maxHeartbeats 7000000
set_option linter.unusedSimpArgs false

def haltX := (cleanP (fieldP 0)).value
def haltY := (cleanP (immutableP "escalationHaltMultiplierBps")).value
def denom := bpsP.value
def feeX := (feeArgsP[0]).value
def feeY := (cleanP (immutableP "maxSettlementBaseFeeMultiplierBps")).value

def halted (r : Runtime) (id a b multiplier e s : Nat) :=
  put (Inv32OneArg.store r h0 (a*multiplier/10000)) id a b (a*multiplier/10000) e s

def suffixCode : List Stmt := floorCode 2 haltX haltY denom ++
  oracleP.map (·.value) ++ finishCode feeX feeY denom

/-- The whole post-funding suffix, not just its direct writes. -/
theorem actualSuffix : Inv48.QuoteMemory.actualStatements.drop 5 = suffixCode := by
  rw [Inv48.QuoteFundingFields.actualInterior]
  rfl

theorem appendRun (fuel : Nat) (c : Context) (r mid : Runtime) (rows : ScriptedResponder)
    (xs ys : List Stmt)
    (step : (Stmt.evalList fuel table c r xs).runWith rows = .ok (.normal mid)) :
    (Stmt.evalList fuel table c r (xs++ys)).runWith rows =
      (Stmt.evalList fuel table c mid ys).runWith rows := by
  rw [listAppend,Inv48.PositiveRuns.bind,step]
  rfl

/-- Funding entry and numerical/environment inputs are explicit. All later
helper calls, captures, writes and guards are evaluated, with no frame premise. -/
theorem suffix (n : Nat) (c : Context) (r : Runtime) (rows : ScriptedResponder)
    (id a b h e s multiplier minimum bounty base feeMul : Nat)
    (before : Inv48.QuoteTailPreserve.Keeps r id a b)
    (mem : r.loadMemory? id = some (tuple a b h e s))
    (ha : a<R) (hmul : multiplier<R) (hbase : base<R) (hfee : feeMul<R)
    (haltFits : a*multiplier/10000<R)
    (hc : a≤2^128-1) (hr : b≤2^128-1) (hb : bounty≤2^96-1)
    (hmin : minimum<R) (minle : minimum≤a) (exposureFits : (a-minimum)*100<R)
    (settlementFits : base*feeMul/10000<R)
    (haltArgs : Inputs c r h0 haltX haltY denom a multiplier 10000)
    (oracle : OracleInputs c (halted r id a b multiplier e s) rows)
    (earlier : id<(halted r id a b multiplier e s).nextMemory)
    (hh : max (a*multiplier/10000) (Inv03.ceilQuot oracle.exposure 100)≤2^128-1)
    (bountyRead : (oracleOut oracle).lookupLocal? "bountyAttoEth" = some (.word bounty))
    (minimumRead : (maximum (oracleOut oracle) id a b (a*multiplier/10000) e s
      (Inv03.ceilQuot oracle.exposure 100)).loadImmutableField c
      "minimumReportCollateral" = .ok (.word minimum))
    (feeArgs : Inputs c (exposed (oracleOut oracle) id a b (a*multiplier/10000) e s
      (Inv03.ceilQuot oracle.exposure 100) minimum) h0 feeX feeY denom base feeMul 10000) :
    let final := finalState (oracleOut oracle) id a b (a*multiplier/10000) e s
      (Inv03.ceilQuot oracle.exposure 100) minimum (base*feeMul/10000)
    (Stmt.evalList (n+52) table c r (Inv48.QuoteMemory.actualStatements.drop 5)).runWith rows =
      .ok (.normal final) ∧ Inv48.QuoteTailPreserve.Keeps final id a b := by
  dsimp only
  let mid := halted r id a b multiplier e s
  have first := floorHalt (n+37) table productLink floorLink c r id a b h e s
    a multiplier 10000 haltX haltY denom before.1 mem ha hmul (by decide) (by decide) haltFits haltArgs
  simp only [Nat.add_assoc] at first
  change Stmt.evalList (n+52) table c r (floorCode 2 haltX haltY denom) = pure (.normal mid) at first
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
  have done := finish n c (oracleOut oracle) id a b (a*multiplier/10000) e s
    (Inv03.ceilQuot oracle.exposure 100) minimum bounty base feeMul feeX feeY denom
    oracleRun.2.2 oracleMem ha hh hbase hfee hc hr hb hmin minle exposureFits settlementFits
    exposureRead bountyRead minimumRead feeArgs
  refine ⟨?_,done.2⟩
  rw [actualSuffix]
  change (Stmt.evalList (n+52) table c r
    (floorCode 2 haltX haltY denom ++ (oracleP.map (·.value) ++ finishCode feeX feeY denom))).runWith rows = _
  rw [appendNormal _ _ _ _ mid _ _ first,appendRun _ _ _ _ rows _ _ oracleRun.1,done.1]
  rfl
end Inv48.FundingMathTail
