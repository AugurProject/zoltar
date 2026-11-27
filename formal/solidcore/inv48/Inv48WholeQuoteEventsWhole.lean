import Inv48WholeQuoteEventsMinimum
open SolidCore.Solidity SolidCore.Solidity.Source EvmCompiler.Simulation
namespace Inv48.WholeQuoteEvents
open Inv48.MinimumFullTrace Inv48.QuoteSegmentEvents
set_option maxRecDepth 65536
set_option maxHeartbeats 20000000

structure Witness (n : Nat) (c : Context) (physical : Runtime) (p a bounty : Nat)
    (trace : Interaction.Transcript) (final : Runtime) where
  path : Recovery n c physical p a bounty trace final
  minimum : MinimumRecovery (n+53) c (Inv48.WholeQuote.prepared physical p a bounty)
    path.quote.minimumFinal path.quote.minimumTrace
  aggregateInner : Runtime
  aggregateSaved : LocalEnv
  aggregateEntry : internalCallEnter? Inv48.CollateralMinimum.aggregateFn [] path.aggregateCaller =
    some (aggregateInner,aggregateSaved)

theorem witness (n : Nat) (c : Context) (physical : Runtime) (p a bounty : Nat)
    (hp : p<Inv32Division.R) (ha : a<Inv32Division.R) (hb : bounty<Inv32Division.R)
    (trace : Interaction.Transcript) (final : Runtime)
    (run : Interaction.Executes (Stmt.eval (n+55) Inv48.Source.model.core.table c
      (Inv48.WholeQuote.entry physical p a bounty) Inv48.WholeQuote.bodyP.value) trace (.ok (.normal final))) :
    Nonempty (Witness n c physical p a bounty trace final) := by
  obtain ⟨path⟩ := recover n c physical p a bounty hp ha hb trace final run
  obtain ⟨minimum⟩ := recoverMinimum (n+49) c _ _ path.quote.minimumRun
  obtain ⟨k,fn,inner,saved,value,bt,ft,fuelEq,found,entry,split,body,finish,ordinary⟩ :=
    Inv48.MinimumSuccessWords.enter _ _ _ _ _ _ _ _ path.aggregateRun
  have same : fn=Inv48.CollateralMinimum.aggregateFn :=
    Option.some.inj (found.symm.trans Inv48.CollateralMinimum.aggregateLookup)
  subst fn
  exact ⟨⟨path,minimum,inner,saved,entry⟩⟩

/-- Only deployment, bounds and actual-response canonicality at the recovered
suspensions. No trace matching, classification, or independent run is a field. -/
structure Environment (w : Witness n c physical p a bounty trace final) where
  collateral : Inv48.CollateralCloneStage.Deployment w.minimum.body.collateral.context w.minimum.body.collateral.caller
  base : Inv48.CollateralReturnedMinimum.BaseDeployment w.minimum.body.collateral
  collateralOracle : Inv48.MinimumSuccessWords.CanonicalOracle w.minimum.body.collateral.context
    w.minimum.body.collateral.start collateral.root (Inv48.CollateralCloneStage.bytes collateral)
    w.minimum.body.collateral.during
  rep : Inv48.RepReturnedMinimum.Deployment w.minimum.body.rep.context w.minimum.body.rep.caller
  repOracle : Inv48.MinimumSuccessWords.CanonicalOracle w.minimum.body.rep.context
    w.minimum.body.rep.start rep.root (Inv48.RepReturnedMinimum.bytes rep) w.minimum.body.rep.during
  implementation : List Nat
  universeBytes : List Nat
  token : List Nat
  implementationLength : implementation.length=20
  universeLength : universeBytes.length=31
  tokenLength : token.length=20
  universeClean : ∀ b ∈ universeBytes, b<256
  tokenClean : ∀ b ∈ token, b<256
  selfWord : c.self<Inv32Division.R
  boundary : w.aggregateInner.pushScope.pushScope.pushScope.state.envAccountCode c c.self =
    Inv48.CloneRead.runtimeCode implementation universeBytes token
  aggregate : Inv48.CollateralReadDecoded.Deployment {c with checked := true}
    (oracleStage w.aggregateInner.pushScope.pushScope.pushScope
      (Inv48.CloneRead.runtimeCode implementation universeBytes token) (Inv48.CloneRead.decode universeBytes))
  aggregateOracle : Inv48.MinimumSuccessWords.CanonicalOracle {c with checked := true}
    (oracleStage w.aggregateInner.pushScope.pushScope.pushScope
      (Inv48.CloneRead.runtimeCode implementation universeBytes token) (Inv48.CloneRead.decode universeBytes))
    aggregate.root (Inv48.CollateralReadDecoded.bytes aggregate) w.path.aggregateTrace

def aggregateQuery (w : Witness n c physical p a bounty trace final) (e : Environment w) : Query :=
  .external (snapshotWorld {c with checked := true}
    (oracleStage w.aggregateInner.pushScope.pushScope.pushScope
      (Inv48.CloneRead.runtimeCode e.implementation e.universeBytes e.token)
      (Inv48.CloneRead.decode e.universeBytes)).state)
    (.call (buildCallRequest {c with checked := true} .staticcall e.aggregate.root
      (Inv48.CollateralReadDecoded.bytes e.aggregate) 0 none))

/-- The complete successful quote transcript: the two ordered minimum oracle
queries, then the actual aggregate oracle query. All other statements and all
call/scope collectors are structurally silent. -/
theorem events (w : Witness n c physical p a bounty trace final) (e : Environment w) :
    ∃ ac : Answer (collateralQuery w.minimum.body.collateral e.collateral),
    ∃ ar : Answer (repQuery w.minimum.body.rep e.rep),
    ∃ ag : Answer (aggregateQuery w e),
      trace = [{query := collateralQuery w.minimum.body.collateral e.collateral,answer := ac},
        {query := repQuery w.minimum.body.rep e.rep,answer := ar},
        {query := aggregateQuery w e,answer := ag}] := by
  obtain ⟨ac,ar,pair⟩ := bodyPair w.minimum.body e.collateral e.base e.collateralOracle e.rep e.repOracle
  obtain ⟨ag,single⟩ := aggregateCallEvents (n+1) c w.path.aggregateCaller w.aggregateInner w.aggregateSaved
    ["_ret_aggregateExposureAttoEth_0"] w.path.aggregateFinal w.aggregateEntry
    e.implementation e.universeBytes e.token e.implementationLength e.universeLength e.tokenLength
    e.universeClean e.tokenClean e.selfWord e.boundary e.aggregate w.path.aggregateTrace e.aggregateOracle
    w.path.aggregateRun
  exact ⟨ac,ar,ag,w.path.split.trans (congrArg₂ List.append pair single)⟩

theorem classifies (w : Witness n c physical p a bounty trace final) (e : Environment w)
    (ec : Context) (data : List Source.Byte) :
    ∀ event ∈ trace, Inv48.QuoteQueryClass.Class (buildCallRequest ec .call ec.self data 0 none) event.query := by
  obtain ⟨ac,ar,ag,eq⟩ := events w e
  intro event member
  rw [eq] at member
  simp only [List.mem_cons,List.not_mem_nil,or_false] at member
  rcases member with rfl | rfl | rfl
  all_goals apply Inv48.QuoteQueryClass.Class.kind
  all_goals simp [buildCallRequest,lowLevelKindToCallKind]

theorem excludes (w : Witness n c physical p a bounty trace final) (e : Environment w)
    (ec : Context) (state : State) (data : List Source.Byte) :
    ∀ event ∈ trace, event.query ≠ Inv48.ObservedEscrowResponder.query ec state data := by
  intro event member
  exact Inv48.QuoteQueryClass.different ec state data event.query (classifies w e ec data event member)
end Inv48.WholeQuoteEvents
