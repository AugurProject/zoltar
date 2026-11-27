import Inv48QuoteSegmentEventsOracle
import Inv48MinimumCollateralTraceOracle
open SolidCore.Solidity SolidCore.Solidity.Source EvmCompiler.Simulation
namespace Inv48.QuoteSegmentEvents

open Inv48.CollateralMinimum Inv48.MinimumCollateralTrace Inv48.RequestDispatch
set_option maxRecDepth 65536
set_option maxHeartbeats 20000000

/-- The retained aggregate list includes its clone getter and ABI return.
Deployment and canonicality concern the actual oracle suspension only. -/
theorem aggregateListEvents (n : Nat) (c : Context) (r : Runtime)
    (implementation universeBytes token : List Nat)
    (hi : implementation.length=20) (hu : universeBytes.length=31) (ht : token.length=20)
    (cu : ∀ b ∈ universeBytes, b<256) (ct : ∀ b ∈ token, b<256)
    (selfWord : c.self<Inv32Division.R)
    (boundary : r.state.envAccountCode c c.self=Inv48.CloneRead.runtimeCode implementation universeBytes token)
    (d : Inv48.CollateralReadDecoded.Deployment c
      (oracleStage r (Inv48.CloneRead.runtimeCode implementation universeBytes token)
        (Inv48.CloneRead.decode universeBytes)))
    (tr : Interaction.Transcript) (out : Result) (ordinary : ¬ Inv48.WrapperTraversal.Escapes out)
    (env : Inv48.MinimumSuccessWords.CanonicalOracle c
      (oracleStage r (Inv48.CloneRead.runtimeCode implementation universeBytes token)
        (Inv48.CloneRead.decode universeBytes)) d.root (Inv48.CollateralReadDecoded.bytes d) tr)
    (run : Interaction.Executes (Stmt.evalList (n+46) table c r aggregateList) tr (.ok out)) :
    ∃ response final x,
      tr = [{query := (.external (snapshotWorld c ((oracleStage r (Inv48.CloneRead.runtimeCode implementation universeBytes token)
          (Inv48.CloneRead.decode universeBytes)).state))
        (.call (buildCallRequest c .staticcall d.root (Inv48.CollateralReadDecoded.bytes d) 0 none))),
              answer := response}] ∧ out = .returned final [.word x] := by
  obtain ⟨start,readFinal,a,b,z,split,preRun,read,ret⟩ :=
    aggregateRead (n+46) c r tr out ordinary run
  rw [aggregatePrefix n c r implementation universeBytes token hi hu ht cu ct selfWord boundary] at preRun
  cases preRun
  simp only [List.nil_append] at split
  obtain ⟨response,x,rest,readSplit,nilRest,success,fit,decoded,finalEq,captured⟩ :=
    decodedReadSingleton (n+44) c _ readFinal b d (by
      intro response event
      apply env response
      obtain ⟨rest,eq⟩ := event
      exact ⟨rest++z, by rw [split,eq]; rfl⟩) read
  subst rest
  have returnEq := Inv32CompareValues.retOne (n+45) table c readFinal
    (.castOp .uintCleanup 256 (.var tmp)) x
    (Inv32Guards.clean _ c readFinal (.var tmp) x fit
      (Inv32Guards.readWord _ c readFinal tmp x captured))
  rw [Stmt.evalList,returnEq] at ret
  cases ret
  exact ⟨response,readFinal,x,by simpa using split.trans (by rw [readSplit]; rfl),rfl⟩
theorem aggregateCallEvents (n : Nat) (c : Context) (r inner : Runtime) (saved : LocalEnv) (targets : List String) (final : Runtime)
    (entry : internalCallEnter? aggregateFn [] r = some (inner,saved))
    (implementation universeBytes token : List Nat)
    (hi : implementation.length=20) (hu : universeBytes.length=31) (ht : token.length=20)
    (cu : ∀ b ∈ universeBytes, b<256) (ct : ∀ b ∈ token, b<256)
    (selfWord : c.self<Inv32Division.R)
    (boundary : inner.pushScope.pushScope.pushScope.state.envAccountCode c c.self=Inv48.CloneRead.runtimeCode implementation universeBytes token)
    (d : Inv48.CollateralReadDecoded.Deployment {c with checked := true}
      (oracleStage inner.pushScope.pushScope.pushScope (Inv48.CloneRead.runtimeCode implementation universeBytes token)
        (Inv48.CloneRead.decode universeBytes)))
    (tr : Interaction.Transcript)
    (env : Inv48.MinimumSuccessWords.CanonicalOracle {c with checked := true}
      (oracleStage inner.pushScope.pushScope.pushScope (Inv48.CloneRead.runtimeCode implementation universeBytes token)
        (Inv48.CloneRead.decode universeBytes)) d.root (Inv48.CollateralReadDecoded.bytes d) tr)
    (run : Interaction.Executes (Stmt.eval (n+50) table c r (.internalCall targets aggregateKey [])) tr (.ok (.normal final))) :
    ∃ response,
      tr = [{query := (.external (snapshotWorld {c with checked := true} ((oracleStage inner.pushScope.pushScope.pushScope (Inv48.CloneRead.runtimeCode implementation universeBytes token)
          (Inv48.CloneRead.decode universeBytes)).state))
        (.call (buildCallRequest {c with checked := true} .staticcall d.root (Inv48.CollateralReadDecoded.bytes d) 0 none))),
              answer := response}] := by
  obtain ⟨k,fn,actualInner,actualSaved,value,bt,ft,fuelEq,found,actualEntry,split,body,finish,ordinary⟩ :=
    Inv48.MinimumSuccessWords.enter _ _ _ _ _ _ _ _ run
  have same : fn = aggregateFn := Option.some.inj (found.symm.trans aggregateLookup)
  subst fn
  have pairEq := Option.some.inj (entry.symm.trans actualEntry)
  cases pairEq
  have kEq : k = n+49 := by omega
  subst k
  change Interaction.Executes (Stmt.eval (n+49) table {c with checked := true} inner aggregateBody) bt (.ok value) at body
  obtain ⟨j,v,eq,valueEq,ord,list⟩ := aggregateBodyList _ _ _ _ _ ordinary body
  have jEq : j = n+46 := by omega
  subst j
  obtain ⟨response,retFinal,x,traceEq,outEq⟩ := aggregateListEvents n {c with checked := true}
    inner.pushScope.pushScope.pushScope implementation universeBytes token hi hu ht cu ct selfWord
    boundary d bt v ord (by
      intro response event
      apply env response
      obtain ⟨rest,eq⟩ := event
      exact ⟨rest++ft, by rw [split,eq]; rfl⟩) list
  subst v
  rw [valueEq] at finish
  simp only [Result.mapRuntime] at finish
  simp only [internalCallFinish, aggregateFn, coerceReturnBindingsRef,
    coerceReturnBindingsRef.coerce, Runtime.derefMemoryValueDeep,
    Runtime.derefMemoryValueWithFuel, Ty.coerceValue?, Bind.bind, Except.bind,
    internalCallAssign] at finish
  repeat' split at finish
  all_goals cases finish
  all_goals exact ⟨response, by simpa using split.trans (by rw [traceEq]; rfl)⟩
end Inv48.QuoteSegmentEvents
