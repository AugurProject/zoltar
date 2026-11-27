import Inv48RequestProloguePrefix
open SolidCore.Solidity.Source EvmCompiler.Simulation Inv48.EscrowPrefix
open Inv48.WholeQuote Inv48.QuoteMemory Inv32Division Inv32FloorHoist Inv32CeilFlags
open Inv48.QuoteTransport
namespace Inv48.RequestPrologue
set_option maxRecDepth 65536
set_option maxHeartbeats 8000000
theorem transport
    (n : Nat) (c : Context) (raw oracle minMid : Runtime)
    (p a bounty multiplier v minimum basePriority feeMultiplier minimumRequired : Nat)
    (minimumTrace oracleTrace : EvmCompiler.Simulation.Interaction.Transcript)
    (fn : InternalFunction) (inner outer : Frame)
    (linked : Inv48.Source.model.core.table.lookup? quoteKey = some fn)
    (returns : fn.returns = [⟨"quote",quoteTy,false⟩])
    (frames : oracle.locals = inner :: outer :: (allocated (base raw) p a bounty).locals)
    (hp : p<R) (ha : a≤2^128-1) (hbounty : bounty≤2^96-1)
    (hrep : QuoteExec.repAmount a p≤2^128-1)
    (hmul : multiplier<R) (hbase : basePriority<R) (hfee : feeMultiplier<R)
    (hh : max (a*multiplier/10000) v≤2^128-1)
    (hmin : minimum<R) (minle : minimum≤a) (exposureFits : (a-minimum)*100<R)
    (settlementFits : basePriority*feeMultiplier/10000<R)
    (minimumFits : minimumRequired<R) (minimumEnough : minimumRequired≤a)
    (minimumHelper : Reached (Stmt.evalList (n+19) Inv48.Source.model.core.table c
      (prepared (base raw) p a bounty).pushScope minPrefix) minimumTrace minMid)
    (minimumScope : minMid.popScope = prepared (base raw) p a bounty)
    (minimumCollateral : minMid.lookupLocal? "requestedInitialAttoWeth" = some (.word a))
    (minimumResult : minMid.lookupLocal? "#view48027" = some (.word minimumRequired))
    (haltArgs : Inputs c (fundingState (base raw) p a bounty)
      h0 haltX haltY denom a multiplier 10000)
    (oracleObs : ReachedOracleObservation (n+20) Inv48.Source.model.core.table c
      (put (Inv32OneArg.store (fundingState (base raw) p a bounty) h0 (a*multiplier/10000))
        (base raw).nextMemory a (QuoteExec.repAmount a p) (a*multiplier/10000) 0 0) oracle oracleCode oracleTrace)
    (exposureRead : oracle.lookupLocal? "exposureEscalationHaltAttoEth" = some (.word v))
    (bountyRead : oracle.lookupLocal? "bountyAttoEth" = some (.word bounty))
    (minimumRead : (maximumState oracle (base raw).nextMemory a p (a*multiplier/10000) v).loadImmutableField c
      "minimumReportCollateral" = .ok (.word minimum))
    (feeArgs : Inputs c (exposed oracle (base raw).nextMemory a p (a*multiplier/10000) v minimum)
      h0 feeX feeY denom basePriority feeMultiplier 10000)
    (rest : LocalEnv) (old hoisted sponsor gas : Nat)
    (afterPending site : Runtime) (suffixTrace prepTrace : Interaction.Transcript)
    (checked : c.checked = true)
    (initial : fn.initialFrame? [.word p,.word a,.word bounty] = some
      [("proposedRepPerEthPrice",.word p),("requestedInitialAttoWeth",.word a),
       ("bountyAttoEth",.word bounty),("quote",Inv48.QuoteMemory.tuple 0 0 0 0 0)])
    (suffixRun : ExecutesOK (Stmt.evalList (n+25) Inv48.Source.model.core.table c
      (aliased (quoteOut (base raw) oracle p a multiplier v minimum basePriority feeMultiplier) [] ([]::requestFrame sponsor p a bounty gas::rest) (base raw).nextMemory)
      ((Inv48.RequestQuote.actual.drop 7).take 5)) suffixTrace (.normal afterPending))
    (prepRun : ExecutesOK (Stmt.evalList (n+24) Inv48.Source.model.core.table c
      afterPending.pushScope actualPrep) prepTrace (.normal site)) :
    let out := quoteOut (base raw) oracle p a multiplier v minimum basePriority feeMultiplier
    ExecutesOK (Stmt.evalList (n+24) Inv48.Source.model.core.table c (caller raw [] ([]::requestFrame sponsor p a bounty gas::rest) p a bounty old hoisted) bridgeCode >>=
      fun result => pure (result.mapRuntime Runtime.popScope)) (minimumTrace++oracleTrace)
      (.normal (aliased out [] ([]::requestFrame sponsor p a bounty gas::rest) (base raw).nextMemory)) ∧
    (captured out [] ([]::requestFrame sponsor p a bounty gas::rest) p a bounty (base raw).nextMemory hoisted).loadMemory? (base raw).nextMemory =
      some (Inv48.QuoteMemory.tuple a (Inv48.QuoteExec.repAmount a p)
        (max (a*multiplier/10000) v) ((a-minimum)*100) (basePriority*feeMultiplier/10000)) ∧
    site.lookupLocal? "quote" = some (.memoryRef (base raw).nextMemory) ∧
    site.loadMemory? (base raw).nextMemory = some (Inv48.QuoteMemory.tuple a (Inv48.QuoteExec.repAmount a p)
      (max (a*multiplier/10000) v) ((a-minimum)*100) (basePriority*feeMultiplier/10000)) ∧
    HasFunding site (base raw).nextMemory a p := by
  exact Inv48.QuoteTransport.generatedTransport n c (base raw) oracle minMid
    p a bounty multiplier v minimum basePriority feeMultiplier minimumRequired
    minimumTrace oracleTrace fn inner outer linked returns frames hp ha hbounty hrep
    hmul hbase hfee hh hmin minle exposureFits settlementFits minimumFits minimumEnough
    minimumHelper minimumScope minimumCollateral minimumResult haltArgs oracleObs
    exposureRead bountyRead minimumRead feeArgs
    (caller raw [] ([]::requestFrame sponsor p a bounty gas::rest) p a bounty old hoisted)
    [] ([]::requestFrame sponsor p a bounty gas::rest) old hoisted sponsor afterPending site suffixTrace prepTrace checked
    (arguments c raw [] ([]::requestFrame sponsor p a bounty gas::rest) p a bounty old hoisted)
    (enter fn raw [] ([]::requestFrame sponsor p a bounty gas::rest) p a bounty old hoisted initial)
    (by rfl) suffixRun prepRun

end Inv48.RequestPrologue
