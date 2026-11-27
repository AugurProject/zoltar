import Inv48WholeQuoteFundingStage
import Inv48WholeQuoteMinimumStage
import Inv48WholeQuoteRuntime
open SolidCore.Solidity.Source Inv32Division Inv32FloorHoist Inv32CeilFlags
namespace Inv48.WholeQuote
set_option maxRecDepth 65536
set_option maxHeartbeats 4000000
open QuoteMemory

/-- Whole successful body execution from a named zero-return frame. No input
hypothesis mentions an old quote tuple, either funding output, or a quote call's
result. External/helper observations and floor argument observations are explicit. -/
theorem wholeQuote {table : FunctionTable}
    (productLinked : Inv32Internal.ProductLinked table)
    (floorLinked : Inv32FloorCall.FloorLinked table)
    (roundsLinked : Inv32Library.LinkAt table Inv32Bodies.RoundsUp.key
      [.word "rounding"] [.flag "_ret0"] Inv32Bodies.RoundsUp.body)
    (uintLinked : Inv32Library.LinkAt table Inv32Bodies.ToUint.key
      [.flag "b"] [.word "u"] Inv32Bodies.ToUint.body)
    (roundedLinked : Inv32Library.LinkAt table Inv32Bodies.Ceil.key
      [.word "x",.word "y",.word "denominator",.word "rounding"] [.word "_ret0"] Inv32Bodies.Ceil.body)
    (sourceBody : (table.lookup? quoteKey).map InternalFunction.body = some bodyP.value)
    (n : Nat) (c : Context) (base oracle minMid : Runtime)
    (p a bounty multiplier v minimum basePriority feeMultiplier minimumRequired : Nat)
    (minimumTrace oracleTrace : EvmCompiler.Simulation.Interaction.Transcript)
    (fn : InternalFunction) (saved : LocalEnv) (targets : List String) (inner outer : Frame)
    (linked : table.lookup? quoteKey = some fn)
    (returns : fn.returns = [⟨"quote",quoteTy,false⟩])
    (frames : oracle.locals = inner :: outer :: (allocated base p a bounty).locals)
    (hp : p<R) (ha : a≤2^128-1) (hbounty : bounty≤2^96-1)
    (hrep : QuoteExec.repAmount a p≤2^128-1)
    (hmul : multiplier<R) (hbase : basePriority<R) (hfee : feeMultiplier<R)
    (hh : max (a*multiplier/10000) v≤2^128-1)
    (hmin : minimum<R) (minle : minimum≤a) (exposureFits : (a-minimum)*100<R)
    (settlementFits : basePriority*feeMultiplier/10000<R)
    (minimumFits : minimumRequired<R) (minimumEnough : minimumRequired≤a)
    (minimumHelper : Reached (Stmt.evalList (n+19) table c
      (prepared base p a bounty).pushScope minPrefix) minimumTrace minMid)
    (minimumScope : minMid.popScope = prepared base p a bounty)
    (minimumCollateral : minMid.lookupLocal? "requestedInitialAttoWeth" = some (.word a))
    (minimumResult : minMid.lookupLocal? "#view48027" = some (.word minimumRequired))
    (haltArgs : Inputs c (fundingState base p a bounty)
      h0 haltX haltY denom a multiplier 10000)
    (oracleObs : ReachedOracleObservation (n+20) table c
      (put (Inv32OneArg.store (fundingState base p a bounty) h0 (a*multiplier/10000))
        base.nextMemory a (QuoteExec.repAmount a p) (a*multiplier/10000) 0 0) oracle oracleCode oracleTrace)
    (exposureRead : oracle.lookupLocal? "exposureEscalationHaltAttoEth" = some (.word v))
    (bountyRead : oracle.lookupLocal? "bountyAttoEth" = some (.word bounty))
    (minimumRead : (maximumState oracle base.nextMemory a p (a*multiplier/10000) v).loadImmutableField c
      "minimumReportCollateral" = .ok (.word minimum))
    (feeArgs : Inputs c (exposed oracle base.nextMemory a p (a*multiplier/10000) v minimum)
      h0 feeX feeY denom basePriority feeMultiplier 10000) :
    Reached (Stmt.eval (n+22) table c (entry base p a bounty) fn.body)
      (minimumTrace++oracleTrace) ((finalState oracle base.nextMemory a p (a*multiplier/10000) v minimum
        (basePriority*feeMultiplier/10000)).popScope.popScope) ∧
    HasFunding (finalState oracle base.nextMemory a p (a*multiplier/10000) v minimum
      (basePriority*feeMultiplier/10000)).popScope.popScope base.nextMemory a p ∧
    (let out := (finalState oracle base.nextMemory a p (a*multiplier/10000) v minimum
      (basePriority*feeMultiplier/10000)).popScope.popScope
     internalCallFinish fn targets saved (.normal out) =
       internalCallAssign {out with locals := saved} targets [.memoryRef base.nextMemory]) := by
  let r := prepared base p a bounty
  let id := base.nextMemory
  let out := finalState oracle id a p (a*multiplier/10000) v minimum (basePriority*feeMultiplier/10000)
  have haFit : a<R := lt_of_le_of_lt ha (by decide)
  have hbFit : bounty<R := lt_of_le_of_lt hbounty (by decide)
  have hrFit : QuoteExec.repAmount a p<R := lt_of_le_of_lt hrep (by decide)
  have guard := initializedMinimum n table c base minMid p a bounty minimumRequired minimumTrace
    minimumHelper minimumScope minimumCollateral minimumResult haFit minimumFits minimumEnough
  have fundRaw := initializedFunding productLinked floorLinked roundsLinked uintLinked roundedLinked n c base p a bounty hp haFit hrFit
  have fund := fundingTransport (n+20) table c base p a bounty fundRaw
  have rest := tailReached table productLinked floorLinked n c (fundingState base p a bounty) oracle
    id a p bounty multiplier v minimum basePriority feeMultiplier haltX haltY denom feeX feeY denom
    oracleCode oracleTrace (fundingStateRef base p a bounty) (fundingStateMemory base p a bounty)
    haFit hmul hbase hfee ha hrep hh hbounty hmin minle exposureFits settlementFits
    haltArgs oracleObs exposureRead bountyRead minimumRead feeArgs
  have interior := interiorJoin (n+20) table c r (fundingState base p a bounty) out minimumTrace oracleTrace guard fund rest
  constructor
  · rw [bodyFromLookup table fn sourceBody linked]
    exact entryJoin n table c base out p a bounty (minimumTrace++oracleTrace) hp haFit hbFit interior
  constructor
  · exact ⟨returnReference base oracle inner outer p a bounty (a*multiplier/10000) v minimum _ frames,
      max (a*multiplier/10000) v, (a-minimum)*100, basePriority*feeMultiplier/10000,
      returnMemory oracle base.nextMemory a p (a*multiplier/10000) v minimum _⟩
  · exact finish fn base oracle inner outer p a bounty (a*multiplier/10000) v minimum _ saved targets returns frames

#print axioms wholeQuote
end Inv48.WholeQuote
