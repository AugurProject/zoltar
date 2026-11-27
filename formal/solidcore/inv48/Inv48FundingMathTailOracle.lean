import Inv48FundingMathTailMath
import Inv48PositiveRuns
open SolidCore.Solidity.Source Inv32Division EvmCompiler.Simulation
namespace Inv48.FundingMathTail
open Inv48.ExposureHeap Inv48.CloneRead Inv48.CloneGetters Inv48.CollateralMinimum
set_option maxRecDepth 65536
set_option maxHeartbeats 6000000
set_option linter.unusedSimpArgs false

/-- External boundary only: bytecode, immutable root and canonical responder.
No heap frame or suffix result is assumed. -/
structure OracleInputs (c : Context) (r : Runtime) (rows : ScriptedResponder) where
  implementation : List Nat
  universeBytes : List Nat
  token : List Nat
  root : Nat
  exposure : Nat
  world : OpenWorld
  hi : implementation.length=20
  hu : universeBytes.length=31
  ht : token.length=20
  cu : ∀ x ∈ universeBytes, x<256
  ct : ∀ x ∈ token, x<256
  selfWord : c.self<Inv48.SymbolicClone.R
  boundary : r.state.envAccountCode {c with checked := true} c.self=runtimeCode implementation universeBytes token
  rootValue : (Expr.immutable "securityPool").evalWithRuntimeByContext {c with checked := true}
    (oracleStage (oracleEntry r) (runtimeCode implementation universeBytes token) (decode universeBytes)) =
    .ok (.word root,oracleStage (oracleEntry r) (runtimeCode implementation universeBytes token) (decode universeBytes))
  exposureFits : exposure<R
  rootFits : root<R
  away : wordEq root c.self=false
  answer : rows.answerCall? (snapshotWorld {c with checked := true}
    (oracleStage (oracleEntry r) (runtimeCode implementation universeBytes token) (decode universeBytes)).state)
    (buildCallRequest {c with checked := true} .staticcall root
      (Inv12.wireBytes 2603245787 [decode universeBytes]) 0 none)=
        some (Inv48.Minima.wordResponse world exposure)

def aggregateOut {c r rows} (h : OracleInputs c r rows) :=
  continued {c with checked := true} r (runtimeCode h.implementation h.universeBytes h.token)
    (decode h.universeBytes) h.root h.exposure (Inv48.Minima.wordResponse h.world h.exposure)

def oracleOut {c r rows} (h : OracleInputs c r rows) :=
  Inv32OneArg.store ((aggregateOut h).declareLocal "#view48072" (.word h.exposure))
    Inv03.Bodies.tmp (Inv03.ceilQuot h.exposure 100) |>.declareLocal
      "exposureEscalationHaltAttoEth" (.word (Inv03.ceilQuot h.exposure 100))

theorem aggregateStage (n c r rows id a b) (h : OracleInputs c r rows)
    (earlier : id<r.nextMemory) (before : Inv48.QuoteTailPreserve.Keeps r id a b) :
    (Stmt.eval (n+52) table c (r.declareLocal tmp (.word 0))
      (hoist aggregateRet aggregateKey)).runWith rows = .ok (.normal (aggregateOut h)) ∧
    (aggregateOut h).loadMemory? id = r.loadMemory? id ∧
    Inv48.QuoteTailPreserve.Keeps (aggregateOut h) id a b := by
  have stage := quote_stage n c r rows h.implementation h.universeBytes h.token h.root h.exposure
    id a b h.world h.hi h.hu h.ht h.cu h.ct h.selfWord h.boundary h.rootValue
    h.exposureFits h.rootFits h.away h.answer earlier before
  exact ⟨stage.1,stage.2.1,stage.2.2.1⟩

theorem oracleStageRun (n c r rows id a b) (h : OracleInputs c r rows)
    (earlier : id<r.nextMemory) (before : Inv48.QuoteTailPreserve.Keeps r id a b) :
    (Stmt.evalList (n+52) table c r (Inv48.WholeQuote.oracleP.map (·.value))).runWith rows =
      .ok (.normal (oracleOut h)) ∧
    (oracleOut h).loadMemory? id = r.loadMemory? id ∧
    Inv48.QuoteTailPreserve.Keeps (oracleOut h) id a b := by
  have stage := aggregateStage n c r rows id a b h earlier before
  let agg := aggregateOut h
  let view := agg.declareLocal "#view48072" (.word h.exposure)
  have read := continued_value {c with checked := true} r
    (runtimeCode h.implementation h.universeBytes h.token) (decode h.universeBytes)
    h.root h.exposure (Inv48.Minima.wordResponse h.world h.exposure)
  have decl := Inv32Temps.temp (n+51) table c agg "#view48072" tmp h.exposure h.exposureFits read
  have ceil := ceilCaller (n+36) c view "#view48072" h.exposure h.exposureFits
    (by cases H : agg.locals <;> simp [view,Inv32FloorHoist.start,Inv32OneArg.store,
        Runtime.declareLocal,Runtime.pushScope,LocalEnv.declare,Runtime.lookupLocal?,LocalEnv.lookup?,Frame.lookup?,H,
        Inv03.Bodies.tmp,Inv32CeilFlags.h0])
  have ceilFit : Inv03.ceilQuot h.exposure 100<R := by
    by_cases z : h.exposure=0
    · simp [z,Inv03.ceilQuot]
    · have f := Inv48.MinimaCeil.scaledFactor h.exposure h.exposureFits
      dsimp only at f
      simp only [if_neg z,Nat.one_mul] at f
      exact f.2 ▸ f.1
  have last := Inv32Hoist.declEval (n+51) table c
    (Inv32OneArg.store view tmp (Inv03.ceilQuot h.exposure 100))
    "exposureEscalationHaltAttoEth" .uint256
    (.castOp .uintCleanup 256 (.castOp .uintCast 256 (.var tmp)))
    (Inv03.ceilQuot h.exposure 100)
    (Inv48.QuoteMemory.readHoist c _ _ ceilFit (by
      cases H : view.locals <;> simp [Inv32OneArg.store,Runtime.declareLocal,LocalEnv.declare,
        Runtime.lookupLocal?,LocalEnv.lookup?,Frame.lookup?,H])) (by rfl)
  simp only [Nat.add_assoc] at decl ceil last
  refine ⟨?_,stage.2.1,?_,?_⟩
  · change (Stmt.evalList (n+52) table c r
      [.varDecl .uint256 tmp none,hoist aggregateRet aggregateKey,
       .varDecl .uint256 "#view48072" (some (.castOp .uintCleanup 256 (.var tmp))),
       .varDecl .uint256 tmp none,(Inv48.MinimaCeil.code "#view48072").value,
       .varDecl .uint256 "exposureEscalationHaltAttoEth" (some (.castOp .uintCleanup 256 (.castOp .uintCast 256 (.var tmp))))]).runWith rows = _
    rw [Inv48.PositiveRuns.seq _ _ _ _ _ rows _ _ (by
      exact congrArg (SolI.runWith rows) (Inv32FloorStart.zero (n+51) table c r tmp))]
    rw [Inv48.PositiveRuns.seq _ _ _ _ _ rows _ _ stage.1]
    rw [Inv48.PositiveRuns.seq _ _ _ _ _ rows _ _ (by rw [decl]; rfl)]
    rw [Inv48.PositiveRuns.seq _ _ _ _ _ rows _ _ (by
      exact congrArg (SolI.runWith rows) (Inv32FloorStart.zero (n+51) table c view tmp))]
    rw [Inv48.PositiveRuns.seq _ _ _ _ _ rows _ _ (by exact congrArg (SolI.runWith rows) ceil)]
    rw [Inv48.PositiveRuns.seq _ _ _ _ _ rows _ _ (by rw [last]; rfl)]
    rw [Stmt.evalList]
    rfl
  · cases H : (aggregateOut h).locals <;>
      simpa [oracleOut,Inv03.Bodies.tmp,Inv32OneArg.store,Runtime.declareLocal,LocalEnv.declare,
        Runtime.lookupLocal?,LocalEnv.lookup?,Frame.lookup?,H] using stage.2.2.1
  · exact stage.2.2.2
end Inv48.FundingMathTail
