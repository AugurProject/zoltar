import Inv48ObservedTailBoundsFinish
open SolidCore.Solidity.Source EvmCompiler.Simulation Inv32Division Inv32FloorHoist Inv32CeilFlags
namespace Inv48.ObservedTailBounds
open Inv48.QuoteMemory Inv48.WholeQuote Inv48.FundingMathTail Inv48.QuoteOperandReads
set_option maxRecDepth 65536
set_option maxHeartbeats 20000000

theorem suffixBounds (n : Nat) (c : Context) (physical r last : Runtime)
    (rows : ScriptedResponder) (id a b bounty multiplier minimum priority feeMul : Nat)
    (ref : r.lookupLocal? "quote" = some (.memoryRef id))
    (mem : r.loadMemory? id = some (tuple a b 0 0 0))
    (ha : a<R) (hb : bounty<R) (repFits : b<R)
    (haltWord : PhysicalWord c physical "escalationHaltMultiplierBps" multiplier)
    (minimumWord : PhysicalWord c physical "minimumReportCollateral" minimum)
    (priorityWord : PhysicalWord c physical "initialReportPriorityFeeAttoEthPerGas" priority)
    (feeWord : PhysicalWord c physical "maxSettlementBaseFeeMultiplierBps" feeMul)
    (same : ∀ name, r.state.immutable? name = physical.state.immutable? name)
    (oracle : OracleInputs c (halted r id a b multiplier 0 0) rows)
    (earlier : id<(halted r id a b multiplier 0 0).nextMemory)
    (bountyRead : (oracleOut oracle).lookupLocal? "bountyAttoEth" = some (.word bounty))
    (checked : c.checked=true) (trace : Interaction.Transcript)
    (aligned : Inv48.ChildExtraction.Matches rows trace)
    (run : Interaction.Executes (Stmt.evalList (n+65) table c r
      (actualStatements.drop 5)) trace (.ok (.normal last))) :
    a*multiplier/10000<R ∧ a≤2^128-1 ∧ b≤2^128-1 ∧
      max (a*multiplier/10000) (Inv03.ceilQuot oracle.exposure 100)≤2^128-1 ∧
      bounty≤2^96-1 ∧ minimum≤a ∧ ∃ base,
      checkedAdd true (EnvWord.blockBasefee.eval c) priority = .ok base ∧
      base=EnvWord.blockBasefee.eval c+priority ∧ base<R ∧
      base*feeMul/10000<R ∧ base*feeMul<R*10000 := by
  have haltFit := haltFits (n+40) c physical r last id a b 0 0 0 multiplier ref mem ha haltWord (same _) trace
    (by simpa only [Nat.add_assoc] using run)
  have args := haltInputs c r id a b 0 0 0 multiplier ref mem ha (physicalRead haltWord (same _)) haltWord.fits
  obtain ⟨hc,hr,hh,hb'⟩ := Inv48.ObservedSuffixBounds.rangeFits n 0 c r rows id a b bounty multiplier
    ref mem ha hb repFits haltFit haltWord.fits args oracle earlier bountyRead last trace aligned
    (by simpa only [Nat.add_zero] using run)
  let mid := halted r id a b multiplier 0 0
  have first := floorHalt (n+50) table productLink floorLink c r id a b 0 0 0 a multiplier 10000
    Inv48.FundingMathTail.haltX Inv48.FundingMathTail.haltY Inv48.FundingMathTail.denom
    ref mem ha haltWord.fits (by decide) (by decide) haltFit args
  simp only [Nat.add_assoc] at first
  change Stmt.evalList (n+65) table c r
    (floorCode 2 Inv48.FundingMathTail.haltX Inv48.FundingMathTail.haltY Inv48.FundingMathTail.denom) = pure (.normal mid) at first
  have midRef : mid.lookupLocal? "quote" = some (.memoryRef id) :=
    (store_other r _ "quote" (by decide)).trans ref
  have midMem : mid.loadMemory? id = some (tuple a b (a*multiplier/10000) 0 0) := put_load _ _ _ _ _ _ _
  have orun := oracleStageRun (n+13) c mid rows id a b oracle earlier ⟨midRef,a*multiplier/10000,0,0,midMem⟩
  have omem : (oracleOut oracle).loadMemory? id = some (tuple a b (a*multiplier/10000) 0 0) := orun.2.1.trans midMem
  have exposureRead : (oracleOut oracle).lookupLocal? "exposureEscalationHaltAttoEth" = some (.word (Inv03.ceilQuot oracle.exposure 100)) := by
    cases H : (aggregateOut oracle).locals <;>
      simp [oracleOut,Inv32OneArg.store,Runtime.declareLocal,LocalEnv.declare,Runtime.lookupLocal?,LocalEnv.lookup?,Frame.lookup?,H]
  have osame (name : String) : (oracleOut oracle).state.immutable? name = physical.state.immutable? name := same name
  have folded := Inv48.ChildExtraction.foldTrace rows _ _ _ aligned run
  rw [actualSuffix] at folded
  change (Stmt.evalList (n+65) table c r
    (floorCode 2 Inv48.FundingMathTail.haltX Inv48.FundingMathTail.haltY Inv48.FundingMathTail.denom ++
      (oracleP.map (·.value) ++ finishCode Inv48.FundingMathTail.feeX Inv48.FundingMathTail.feeY Inv48.FundingMathTail.denom))).runWith rows = _ at folded
  rw [appendNormal _ _ _ _ mid _ _ first,appendRun _ _ _ _ rows _ _ (by simpa only [Nat.add_assoc] using orun.1)] at folded
  obtain ⟨minle,fee⟩ := finishBounds (n+13) c physical (oracleOut oracle) last id a b
    (a*multiplier/10000) 0 0 (Inv03.ceilQuot oracle.exposure 100) minimum bounty priority feeMul
    orun.2.2.1 omem ha hc hr hh hb' exposureRead bountyRead minimumWord priorityWord feeWord osame checked rows
    (by simpa only [Nat.add_assoc] using folded)
  exact ⟨haltFit,hc,hr,hh,hb',minle,fee⟩
#print axioms suffixBounds
end Inv48.ObservedTailBounds
