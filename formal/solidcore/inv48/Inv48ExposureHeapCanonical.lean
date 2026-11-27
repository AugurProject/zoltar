import Inv48ExposureHeapBytes
import Inv48MinimaCanonical
open SolidCore.Solidity.Source
namespace Inv48.ExposureHeap
open Inv48.CloneRead Inv48.CloneGetters Inv48.CollateralMinimum
set_option maxRecDepth 65536
set_option maxHeartbeats 5000000
set_option linter.unusedSimpArgs false

theorem canonical_decoded (world : EvmCompiler.Simulation.OpenWorld) (v : Nat)
    (fit : v < Inv32Division.R) :
    abiDecodeValuesExcept? [.uint256]
      ((byteArrayToBytes (Inv48.Minima.wordResponse world v).returnData).map normByte) = .ok [.word v] := by
  simpa only [Inv48.Minima.wordResponse,bytes_roundtrip,Inv12.bytesClean] using
    Inv48.Minima.canonicalDecode v fit

/-- Canonical successful oracle response; all execution and preservation facts are derived. -/
theorem quote_stage (n : Nat) (c : Context) (r : Runtime) (rows : ScriptedResponder)
    (implementation universeBytes token : List Nat) (root exposure id a b : Nat)
    (world : EvmCompiler.Simulation.OpenWorld)
    (hi : implementation.length=20) (hu : universeBytes.length=31) (ht : token.length=20)
    (cu : ∀ x ∈ universeBytes, x<256) (ct : ∀ x ∈ token, x<256)
    (selfWord : c.self<Inv48.SymbolicClone.R)
    (boundary : r.state.envAccountCode {c with checked := true} c.self=runtimeCode implementation universeBytes token)
    (rootValue : (Expr.immutable "securityPool").evalWithRuntimeByContext {c with checked := true}
      (oracleStage (oracleEntry r) (runtimeCode implementation universeBytes token) (decode universeBytes)) =
      .ok (.word root,oracleStage (oracleEntry r) (runtimeCode implementation universeBytes token) (decode universeBytes)))
    (exposureFits : exposure<Inv32Division.R) (rootFits : root<Inv32Division.R)
    (away : wordEq root c.self=false)
    (answer : rows.answerCall? (snapshotWorld {c with checked := true}
      (oracleStage (oracleEntry r) (runtimeCode implementation universeBytes token) (decode universeBytes)).state)
      (buildCallRequest {c with checked := true} .staticcall root
        (Inv12.wireBytes 2603245787 [decode universeBytes]) 0 none)=
          some (Inv48.Minima.wordResponse world exposure))
    (earlier : id < r.nextMemory) (before : Inv48.QuoteTailPreserve.Keeps r id a b) :
    let final := continued {c with checked := true} r (runtimeCode implementation universeBytes token)
      (decode universeBytes) root exposure (Inv48.Minima.wordResponse world exposure)
    (Stmt.eval (n+52) table c (r.declareLocal tmp (.word 0))
      (hoist aggregateRet aggregateKey)).runWith rows = .ok (.normal final) ∧
    final.loadMemory? id = r.loadMemory? id ∧
    Inv48.QuoteTailPreserve.Keeps final id a b ∧
    final.nextMemory = r.nextMemory+1 ∧ final.nextMemoryByte = r.nextMemoryByte+128 := by
  have h : OracleResponseAssumptions {c with checked := true} (oracleEntry r) rows
      implementation universeBytes token root exposure (Inv48.Minima.wordResponse world exposure) :=
    ⟨hi,hu,ht,cu,ct,selfWord,boundary,rootValue,exposureFits,rootFits,away,rfl,answer,
      canonical_decoded world exposure exposureFits⟩
  refine ⟨quote_hoist n c r rows implementation universeBytes token root exposure _ h,
    continued_memory _ r _ _ root exposure id _ earlier,
    continued_keeps _ r _ _ root exposure id a b _ earlier before,?_,?_⟩
  · exact (caller_allocation {c with checked := true} r (runtimeCode implementation universeBytes token) (decode universeBytes) root exposure (Inv48.Minima.wordResponse world exposure)).1
  · change (post r (runtimeCode implementation universeBytes token)).nextMemoryByte = _
    exact canonical_memory_bytes r implementation universeBytes token hi hu ht
end Inv48.ExposureHeap
