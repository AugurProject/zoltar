import Inv48QuoteTransportSite
open SolidCore.Solidity.Source EvmCompiler.Simulation Inv48.EscrowPrefix
open Inv48.WholeQuote Inv48.QuoteMemory Inv32Division Inv32FloorHoist Inv32CeilFlags
namespace Inv48.QuoteTransport
set_option maxRecDepth 65536
set_option maxHeartbeats 8000000

def quoteOut (base oracle : Runtime) (p a multiplier v minimum basePriority feeMultiplier : Nat) :=
  (finalState oracle base.nextMemory a p (a*multiplier/10000) v minimum
    (basePriority*feeMultiplier/10000)).popScope.popScope

def bridgeCode : List Stmt := [Inv48.RequestQuote.quoteCaptureP.value,aliasP.value]

/-- Step 2 only: use generatedWholeQuote's NORMAL execution and epilogue,
then recover the actual caller struct at the generated self-call site. Public
entry/prologue and successful continuation execution remain explicit seams. -/
theorem generatedTransport
    (n : Nat) (c : Context) (base oracle minMid : Runtime)
    (p a bounty multiplier v minimum basePriority feeMultiplier minimumRequired : Nat)
    (minimumTrace oracleTrace : EvmCompiler.Simulation.Interaction.Transcript)
    (fn : InternalFunction) (inner outer : Frame)
    (linked : Inv48.Source.model.core.table.lookup? quoteKey = some fn)
    (returns : fn.returns = [⟨"quote",quoteTy,false⟩])
    (frames : oracle.locals = inner :: outer :: (allocated base p a bounty).locals)
    (hp : p<R) (ha : a≤2^128-1) (hbounty : bounty≤2^96-1)
    (hrep : QuoteExec.repAmount a p≤2^128-1)
    (hmul : multiplier<R) (hbase : basePriority<R) (hfee : feeMultiplier<R)
    (hh : max (a*multiplier/10000) v≤2^128-1)
    (hmin : minimum<R) (minle : minimum≤a) (exposureFits : (a-minimum)*100<R)
    (settlementFits : basePriority*feeMultiplier/10000<R)
    (minimumFits : minimumRequired<R) (minimumEnough : minimumRequired≤a)
    (minimumHelper : Reached (Stmt.evalList (n+19) Inv48.Source.model.core.table c
      (prepared base p a bounty).pushScope minPrefix) minimumTrace minMid)
    (minimumScope : minMid.popScope = prepared base p a bounty)
    (minimumCollateral : minMid.lookupLocal? "requestedInitialAttoWeth" = some (.word a))
    (minimumResult : minMid.lookupLocal? "#view48027" = some (.word minimumRequired))
    (haltArgs : Inputs c (fundingState base p a bounty)
      h0 haltX haltY denom a multiplier 10000)
    (oracleObs : ReachedOracleObservation (n+20) Inv48.Source.model.core.table c
      (put (Inv32OneArg.store (fundingState base p a bounty) h0 (a*multiplier/10000))
        base.nextMemory a (QuoteExec.repAmount a p) (a*multiplier/10000) 0 0) oracle oracleCode oracleTrace)
    (exposureRead : oracle.lookupLocal? "exposureEscalationHaltAttoEth" = some (.word v))
    (bountyRead : oracle.lookupLocal? "bountyAttoEth" = some (.word bounty))
    (minimumRead : (maximumState oracle base.nextMemory a p (a*multiplier/10000) v).loadImmutableField c
      "minimumReportCollateral" = .ok (.word minimum))
    (feeArgs : Inputs c (exposed oracle base.nextMemory a p (a*multiplier/10000) v minimum)
      h0 feeX feeY denom basePriority feeMultiplier 10000)
    (caller : Runtime) (frame : Frame) (rest : LocalEnv) (old hoisted sponsor : Nat)
    (afterPending site : Runtime) (suffixTrace prepTrace : Interaction.Transcript)
    (checked : c.checked = true)
    (arguments : Expr.evalRefArgList c caller [.var "_ic_arg_0",.var "_ic_arg_1",.var "_ic_arg_2"] =
      pure ([.word p,.word a,.word bounty],caller))
    (enter : internalCallEnter? fn [.word p,.word a,.word bounty] caller =
      some (entry base p a bounty,saved frame rest p a bounty old hoisted))
    (sponsorRead : (declared (quoteOut base oracle p a multiplier v minimum basePriority feeMultiplier) frame rest base.nextMemory).lookupLocal? "sponsor" = some (.word sponsor))
    (suffixRun : ExecutesOK (Stmt.evalList (n+25) Inv48.Source.model.core.table c
      (aliased (quoteOut base oracle p a multiplier v minimum basePriority feeMultiplier) frame rest base.nextMemory)
      ((Inv48.RequestQuote.actual.drop 7).take 5)) suffixTrace (.normal afterPending))
    (prepRun : ExecutesOK (Stmt.evalList (n+24) Inv48.Source.model.core.table c
      afterPending.pushScope actualPrep) prepTrace (.normal site)) :
    let out := quoteOut base oracle p a multiplier v minimum basePriority feeMultiplier
    ExecutesOK (Stmt.evalList (n+24) Inv48.Source.model.core.table c caller bridgeCode >>=
      fun result => pure (result.mapRuntime Runtime.popScope)) (minimumTrace++oracleTrace)
      (.normal (aliased out frame rest base.nextMemory)) ∧
    (captured out frame rest p a bounty base.nextMemory hoisted).loadMemory? base.nextMemory =
      some (Inv48.QuoteMemory.tuple a (Inv48.QuoteExec.repAmount a p)
        (max (a*multiplier/10000) v) ((a-minimum)*100) (basePriority*feeMultiplier/10000)) ∧
    site.lookupLocal? "quote" = some (.memoryRef base.nextMemory) ∧
    site.loadMemory? base.nextMemory = some (Inv48.QuoteMemory.tuple a (Inv48.QuoteExec.repAmount a p)
      (max (a*multiplier/10000) v) ((a-minimum)*100) (basePriority*feeMultiplier/10000)) ∧
    HasFunding site base.nextMemory a p := by
  let out := quoteOut base oracle p a multiplier v minimum basePriority feeMultiplier
  have whole := generatedWholeQuote n c base oracle minMid p a bounty multiplier v minimum
    basePriority feeMultiplier minimumRequired minimumTrace oracleTrace fn
    (saved frame rest p a bounty old hoisted) [ret] inner outer linked returns frames hp ha hbounty hrep
    hmul hbase hfee hh hmin minle exposureFits settlementFits minimumFits minimumEnough
    minimumHelper minimumScope minimumCollateral minimumResult haltArgs oracleObs exposureRead bountyRead minimumRead feeArgs
  have ctx : {c with checked := true} = c := by cases c; simp_all
  have bodyRun : ExecutesOK (Stmt.eval (n+22) Inv48.Source.model.core.table {c with checked := true}
      (entry base p a bounty) fn.body) (minimumTrace++oracleTrace) (.normal out) := by
    simpa only [ctx] using whole.1
  have capture := normalCapture (n+22) Inv48.Source.model.core.table c caller (entry base p a bounty)
    out fn frame rest p a bounty old hoisted base.nextMemory (minimumTrace++oracleTrace)
    arguments linked enter bodyRun whole.2.2
  have first : Reached (Stmt.evalList (n+24) Inv48.Source.model.core.table c caller
      [Inv48.RequestQuote.quoteCaptureP.value]) (minimumTrace++oracleTrace)
      (captured out frame rest p a bounty base.nextMemory hoisted) := by
    rw [singleList]
    exact capture
  have second : Reached (Stmt.evalList (n+24) Inv48.Source.model.core.table c
      (captured out frame rest p a bounty base.nextMemory hoisted) [aliasP.value]) []
      {out with locals := saved frame rest p a bounty base.nextMemory base.nextMemory} := by
    rw [singleList]
    change Reached (Stmt.eval (n+23+1) Inv48.Source.model.core.table c
      (captured out frame rest p a bounty base.nextMemory hoisted) (.assign (.var hoist) (.var ret))) [] _
    rw [aliasStep]
    exact .done _
  have both := reachedAppend (n+24) Inv48.Source.model.core.table c caller _ _
    [Inv48.RequestQuote.quoteCaptureP.value] [aliasP.value] (minimumTrace++oracleTrace) [] first second
  have bridge : ExecutesOK (Stmt.evalList (n+24) Inv48.Source.model.core.table c caller bridgeCode >>=
      fun result => pure (result.mapRuntime Runtime.popScope)) (minimumTrace++oracleTrace)
      (.normal (aliased out frame rest base.nextMemory)) := by
    have pop : ExecutesOK (pure ((Result.normal {out with locals := saved frame rest p a bounty base.nextMemory base.nextMemory}).mapRuntime Runtime.popScope) : SolI Result)
        [] (.normal (aliased out frame rest base.nextMemory)) := .done _
    simpa only [List.append_nil] using Interaction.Executes.bind_ok (next := fun result : Result => pure (result.mapRuntime Runtime.popScope)) both pop
  have memory : out.loadMemory? base.nextMemory = some (Inv48.QuoteMemory.tuple a (Inv48.QuoteExec.repAmount a p)
      (max (a*multiplier/10000) v) ((a-minimum)*100) (basePriority*feeMultiplier/10000)) :=
    returnMemory oracle base.nextMemory a p (a*multiplier/10000) v minimum _
  have recovered := recoverSite (n+24) (n+23) Inv48.Source.model.core.table c out afterPending site frame rest
    base.nextMemory a p (max (a*multiplier/10000) v) ((a-minimum)*100) (basePriority*feeMultiplier/10000)
    sponsor suffixTrace prepTrace memory sponsorRead exposureFits settlementFits suffixRun prepRun
  exact ⟨bridge,memory,recovered.2.2.1,recovered.2.2.2.1,recovered.2.2.2.2⟩

end Inv48.QuoteTransport
