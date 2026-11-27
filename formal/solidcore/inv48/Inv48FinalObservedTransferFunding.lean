import Inv48FinalObservedTransferTrace
import Inv48RawEscrowScheduleInvocation
import Inv48CanonicalEscrowDispatchFold
open SolidCore.Solidity.Source EvmCompiler.Simulation Inv32Division
open Inv48.RequestClassify Inv48.GuardArgsFrame
namespace Inv48.FinalObservedTransfer
open Inv48.CanonicalEscrowDispatch Inv48.RawEscrowSchedule
open Inv48.CapturedEscrowArgs Inv48.ObservedEscrowResponder
open Inv48.QuoteContinuationIdentity Inv48.ObservedQuoteJoin
open Inv48.RequestGuards Inv48.QuoteMemory Inv48.WholeQuote Inv48.FundingMathTail Inv48.QuoteOperandReads
set_option maxRecDepth 1000000
set_option maxHeartbeats 20000000
def Funding {root : SolI Result} {trace : Interaction.Transcript} {out : Result}
    (n helperFuel : Nat) (schedule : Schedule) (parentBudget : Nat)
    (initial : Context)
    (raw : SolI ABI.AbiCallResult) (observed : Inv48.NestedResponder.Observation raw)
    (expected : List Value) (targets : List String) (expressions : List Expr)
    (callSite : Site root Inv48.Source.model.core.table
      (.internalCall targets Inv48.RequestQuote.requestKey expressions) trace out)
    (final : Runtime) (during _tail : Interaction.Transcript) (quoteFn : InternalFunction) : Prop :=
    Inv48.ObservedEscrowResponder.observe parentBudget
      (policy schedule) raw = some observed →
    ∃ values mid argumentTrace remaining,
      values = expected ∧
      during = argumentTrace ++ remaining ∧
      Interaction.Executes (Expr.evalRefArgList callSite.context callSite.runtime expressions).caught argumentTrace (.ok (.ok (values,mid))) ∧
      ∀ s p a b g, values = args s p a b g →
        p < 2^256 → a < 2^256 → b < 2^256 → g < 2^32 →
        ∃ q : Site (Stmt.eval ((n+helperFuel+67)+6) Inv48.Source.model.core.table callSite.context callSite.runtime
            (.internalCall targets Inv48.RequestQuote.requestKey expressions))
            Inv48.Source.model.core.table Inv48.RequestQuote.quoteCaptureP.value during (.normal final),
          q.context.self = initial.self ∧ q.context.sender = initial.sender ∧
          q.context.selfDispatch? = none ∧
          wordToAddress q.context.self = wordToAddress schedule.environment.self ∧
          schedule.environment.sender = q.context.sender ∧ ∃ _cut : Inv48.QuoteContinuationIdentity.Cut q (n+helperFuel+67) p a b,
            Inv48.ObservedQuoteJoin.Site.Joined q (n+helperFuel+67) p a b quoteFn ∧
            ∀ (_deployment : Inv48.PublicObservedQuote.DeploymentAtCut q (n+helperFuel+12) p a b quoteFn)
              (_payerFits : initial.sender<2^160) (_sponsorFits : s<2^160),
            ∃ funded : Inv48.MinimumGuardSiteJoin.FundingTrace q (n+helperFuel+12) p a b quoteFn schedule.parentRows,
    ∀
    (dC : Inv48.CollateralCloneStage.Deployment (Inv48.WrapperFundedReturn.bodyAt funded).observed.collateral.joined.context (Inv48.WrapperFundedReturn.bodyAt funded).observed.collateral.joined.caller)
    (_base : Inv48.CollateralReturnedMinimum.BaseDeployment (Inv48.WrapperFundedReturn.bodyAt funded).observed.collateral.joined)
    (_envC : Inv48.MinimumSuccessWords.CanonicalOracle (Inv48.WrapperFundedReturn.bodyAt funded).observed.collateral.joined.context (Inv48.WrapperFundedReturn.bodyAt funded).observed.collateral.joined.start dC.root
      (Inv48.CollateralCloneStage.bytes dC) (Inv48.WrapperFundedReturn.bodyAt funded).observed.collateral.joined.during)
    (dR : Inv48.RepReturnedMinimum.Deployment (Inv48.WrapperFundedReturn.bodyAt funded).observed.rep.joined.context (Inv48.WrapperFundedReturn.bodyAt funded).observed.rep.joined.caller)
    (_envR : Inv48.MinimumSuccessWords.CanonicalOracle (Inv48.WrapperFundedReturn.bodyAt funded).observed.rep.joined.context (Inv48.WrapperFundedReturn.bodyAt funded).observed.rep.joined.start dR.root
      (Inv48.RepReturnedMinimum.bytes dR) (Inv48.WrapperFundedReturn.bodyAt funded).observed.rep.joined.during)
    (multiplier minimum priority feeMul : Nat)
    (_haltWord : PhysicalWord {q.context with checked := true} funded.recovery.cut.minimumFinal
      "escalationHaltMultiplierBps" multiplier)
    (_minimumWord : PhysicalWord {q.context with checked := true} funded.recovery.cut.minimumFinal
      "minimumReportCollateral" minimum)
    (_priorityWord : PhysicalWord {q.context with checked := true} funded.recovery.cut.minimumFinal
      "initialReportPriorityFeeAttoEthPerGas" priority)
    (_feeWord : PhysicalWord {q.context with checked := true} funded.recovery.cut.minimumFinal
      "maxSettlementBaseFeeMultiplierBps" feeMul)
    (oracle : OracleInputs {q.context with checked := true}
      (Inv48.FundingMathTail.halted (Inv48.ObservedFundedCell.funded funded.recovery.cut.minimumFinal (Inv48.RequestPrologue.base q.runtime).nextMemory a p)
        (Inv48.RequestPrologue.base q.runtime).nextMemory a (Inv48.QuoteExec.repAmount a p) multiplier 0 0) schedule.parentRows)
,
    ∃ site preTrace callTrace next,
      trace = callSite.before ++ q.before ++ preTrace ++ callTrace ∧
      site.lookupLocal? "quote" = some (.memoryRef (Inv48.RequestPrologue.base q.runtime).nextMemory) ∧
      Expr.eval q.context site (Inv48.RequestQuote.calldataExpr 2391489481) =
        pure (.bytes (Inv48.RequestQuote.calldata 2391489481 q.context.sender s a
          (Inv48.QuoteExec.repAmount a p)
          (max (a*multiplier/10000) (Inv03.ceilQuot oracle.exposure 100)) b g),site) ∧
      Interaction.Executes
        ((selfDispatchCall q.context site.state .call q.context.self
          (Inv48.RequestQuote.calldata 2391489481 q.context.sender s a
            (Inv48.QuoteExec.repAmount a p)
            (max (a*multiplier/10000) (Inv03.ceilQuot oracle.exposure 100)) b g) 0 none >>=
          Inv48.RequestQuote.reply (n+helperFuel+68) Inv48.Source.model.core.table q.context site
            Inv48.RequestQuote.returns Inv48.RequestQuote.cleanups Inv48.RequestQuote.successBody) >>= next)
        callTrace (.ok out) ∧
      (∃ child, serve schedule (snapshotWorld q.context site.state)
          (buildCallRequest q.context .call q.context.self (Inv48.RequestQuote.calldata 2391489481 q.context.sender s a
          (Inv48.QuoteExec.repAmount a p)
          (max (a*multiplier/10000) (Inv03.ceilQuot oracle.exposure 100)) b g) 0 none) = some child ∧
          child.result.success = true ∧
          (∃ rest, callTrace = ⟨query q.context site.state (Inv48.RequestQuote.calldata 2391489481 q.context.sender s a
          (Inv48.QuoteExec.repAmount a p)
          (max (a*multiplier/10000) (Inv03.ceilQuot oracle.exposure 100)) b g),
            Inv48.NestedResponder.response schedule.environment
              (inputState schedule (snapshotWorld q.context site.state)) child.result⟩ :: rest) ∧
          ∃ canonical : Inv48.NestedResponder.Served schedule.environment
            (inputState schedule (snapshotWorld q.context site.state))
            (Inv48.RequestQuote.calldata 2391489481 schedule.environment.sender s a
              (Inv48.QuoteExec.repAmount a p)
              (max (a*multiplier/10000) (Inv03.ceilQuot oracle.exposure 100)) b g)
            schedule.fuel schedule.childBudget schedule.childRows,
            canonical.result = child.result ∧
            canonical.nested.observed.trace = child.nested.observed.trace ∧
            Inv48.SingleTransferClosed.Transfer canonical ∧
            Inv48.PublicTokenDelta.TransferBoundary canonical ∧
            ActualTransfer schedule.fuel schedule.environment
              (inputState schedule (snapshotWorld q.context site.state)) s a p
              (max (a*multiplier/10000) (Inv03.ceilQuot oracle.exposure 100)) b g child.nested.observed.trace ∧
            ActualTokenBoundary schedule.fuel schedule.environment
              (inputState schedule (snapshotWorld q.context site.state)) s a p
              (max (a*multiplier/10000) (Inv03.ceilQuot oracle.exposure 100)) b g child.nested.observed.trace)

theorem fundingOfRecovered {root : SolI Result} {trace : Interaction.Transcript} {out : Result}
    (n helperFuel : Nat) (schedule : Schedule) (parentBudget : Nat)
    (initial : Context)
    (raw : SolI ABI.AbiCallResult) (observed : Inv48.NestedResponder.Observation raw)
    (sameTrace : observed.trace = trace)
    (expected : List Value) (targets : List String) (expressions : List Expr)
    (callSite : Site root Inv48.Source.model.core.table
      (.internalCall targets Inv48.RequestQuote.requestKey expressions) trace out)
    (evaluated : Expr.evalRefArgList callSite.context callSite.runtime expressions = pure (expected,callSite.runtime))
    (final : Runtime) (during tail : Interaction.Transcript)
    (split : callSite.after = during ++ tail)
    (first : Interaction.Executes (Stmt.eval ((n+helperFuel+67)+6) Inv48.Source.model.core.table
      callSite.context callSite.runtime (.internalCall targets Inv48.RequestQuote.requestKey expressions)) during (.ok (.normal final)))
    (last : Interaction.Executes (callSite.continuation (.normal final)) tail (.ok out))
    (fn quoteFn : InternalFunction)
    (registered : Inv48.Source.model.core.table.lookup? Inv48.RequestQuote.requestKey = some fn)
    (linked : Inv48.Source.model.core.table.lookup? Inv48.QuoteMemory.quoteKey = some quoteFn)
    (selfEq : callSite.context.self = initial.self)
    (senderEq : callSite.context.sender = initial.sender)
    (dispatchEq : callSite.context.selfDispatch? = initial.selfDispatch?)
    (constructionEq : callSite.context.construction = initial.construction)
    (initialConstruction : initial.construction = false)
    (environmentEq : schedule.environment = initial)
    (initialSelfFits : initial.self<2^256)
    (initialOpen : initial.selfDispatch? = none) :
    Funding n helperFuel schedule parentBudget initial raw observed expected targets expressions callSite final during tail quoteFn := by
  intro observationComputed
  obtain ⟨values,mid,bt,aft,splitArgs,arguments,recover⟩ :=
    Inv48.RawEscrowSchedule.invocationFrame (n+helperFuel+67) callSite.context callSite.runtime final
      targets expressions during fn quoteFn registered linked first
  have valuesEq : values = expected := by
    rw [evaluated] at arguments
    cases arguments
    rfl
  refine ⟨values,mid,bt,aft,valuesEq,splitArgs,arguments,?_⟩
  intro s p a b g eq hp ha hb hg
  obtain ⟨q,contextEq,joined,cut,frame,reject⟩ := recover s p a b g eq hp ha hb hg
  have qs : q.context.self = initial.self := by rw [contextEq]; exact selfEq
  have qp : q.context.sender = initial.sender := by rw [contextEq]; exact senderEq
  have qo : q.context.selfDispatch? = none := by rw [contextEq]; exact dispatchEq.trans initialOpen
  have qc : q.context.construction = false := by rw [contextEq]; exact constructionEq.trans initialConstruction
  have address : wordToAddress q.context.self = wordToAddress schedule.environment.self := by rw [environmentEq,qs]
  have payer : schedule.environment.sender = q.context.sender := by rw [environmentEq,qp]
  refine ⟨q,qs,qp,qo,address,payer,cut,joined,?_⟩
  intro deployment payerFits sponsorFits
  have outerSplit : observed.trace = callSite.before ++ during ++ tail := by
    exact sameTrace.trans (callSite.split.trans ((congrArg (fun t => callSite.before ++ t) split).trans
      (List.append_assoc _ _ _).symm))
  have quoteAligned := foldFromEnvironment q (n+helperFuel+12) p a b quoteFn linked cut joined
    reject hp ha hb
    schedule parentBudget raw observed observationComputed
    callSite.before tail outerSplit deployment
  have selfFits : q.context.self<2^256 := by
    rw [qs]
    exact initialSelfFits
  obtain ⟨funded,close⟩ := atSharedInvocation q n helperFuel p a b quoteFn schedule.parentRows linked hp ha hb
    s g cut joined frame reject (by rw [qp]; exact payerFits) sponsorFits hg selfFits qc quoteAligned
  refine ⟨funded,?_⟩
  intro dC base envC dR envR multiplier minimum priority feeMul
    haltWord minimumWord priorityWord feeWord oracle
  obtain ⟨site,preTrace,ct,next,traceSplit,ref,encoding,call,rejectNext⟩ := close
    dC base envC dR envR multiplier minimum priority feeMul haltWord minimumWord priorityWord feeWord oracle
  refine ⟨site,preTrace,ct++tail,(fun v => next v >>= callSite.continuation),?_,ref,encoding,?_,?_⟩
  · simp only [callSite.split,split,traceSplit,List.append_assoc]
  · have lifted := Interaction.Executes.bind_ok call last
    change Interaction.Executes
      (((selfDispatchCall q.context site.state .call q.context.self
        (Inv48.RequestQuote.calldata 2391489481 q.context.sender s a (Inv48.QuoteExec.repAmount a p)
          (max (a*multiplier/10000) (Inv03.ceilQuot oracle.exposure 100)) b g) 0 none >>=
        Inv48.RequestQuote.reply (n+helperFuel+68) Inv48.Source.model.core.table q.context site
          Inv48.RequestQuote.returns Inv48.RequestQuote.cleanups Inv48.RequestQuote.successBody) >>= next) >>=
        callSite.continuation) (ct++tail) (.ok out) at lifted
    simpa only [Inv48.RequestGuards.assoc] using lifted
  · have openWorld := qo
    have localAligned : Matches (policy schedule) ct := by
      have aligned := observedMatches parentBudget _ raw observed observationComputed
      intro event member
      apply aligned event
      rw [sameTrace,callSite.split,split,traceSplit]
      simp only [List.mem_append]
      exact Or.inr (Or.inl (Or.inr member))
    obtain ⟨child,computed,success,⟨rest,event⟩,canonical⟩ := successfulCanonicalCut schedule q.context site
      s a p (max (a*multiplier/10000) (Inv03.ceilQuot oracle.exposure 100)) b g
      (n+helperFuel+68) next ct (.normal final) address payer sponsorFits openWorld call localAligned rejectNext
    obtain ⟨typed,resultEq,traceEq,transfer,boundary⟩ := canonical
    have actual := actualChildTransfer typed child.nested.observed.trace traceEq transfer boundary
    exact ⟨child,computed,success,⟨rest++tail,by rw [event]; rfl⟩,
      typed,resultEq,traceEq,transfer,boundary,actual⟩

#print axioms fundingOfRecovered
end Inv48.FinalObservedTransfer
