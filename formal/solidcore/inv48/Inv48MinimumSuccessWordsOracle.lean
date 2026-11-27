import Inv48MinimumSuccessWordsCore
open SolidCore.Solidity SolidCore.Solidity.Source EvmCompiler.Simulation
namespace Inv48.MinimumSuccessWords
open Inv48.Minima Inv48.RequestDispatch
set_option maxRecDepth 65536
set_option maxHeartbeats 20000000
set_option linter.unusedSimpArgs false

/-- A concrete read retains the exact suspension world, request and response.
This predicate is intentionally independent of scripted responders. -/
def OracleEvent (c : Context) (r : Runtime) (root : Nat) (bytes : List Source.Byte)
    (trace : Interaction.Transcript) (out : CallResponse) : Prop :=
  ∃ rest, trace = {query := (.external (snapshotWorld c r.state)
    (.call (buildCallRequest c .staticcall root bytes 0 none))), answer := out} :: rest

/-- Environmental canonicality is about oracle response data, never helper
return values or arithmetic budgets. The request/world remain explicitly indexed. -/
def CanonicalOracle (c : Context) (r : Runtime) (root : Nat) (bytes : List Source.Byte)
    (trace : Interaction.Transcript) : Prop :=
  ∀ out, OracleEvent c r root bytes trace out →
    ∃ x, x < Inv32Division.R ∧
      abiDecodeValuesExcept? [.uint256] ((byteArrayToBytes out.returnData).map normByte) = .ok [.word x]

theorem readEvent (n : Nat) (t : FunctionTable) (c : Context) (r final : Runtime)
    (root : Nat) (data : Source.Expr) (bytes : List Source.Byte) (trace : Interaction.Transcript)
    (E : data.evalWithRuntimeByContext c r = .ok (.bytes bytes,r))
    (clean : bytes.map normByte = bytes)
    (read : (Source.Expr.immutable "securityPool").evalWithRuntimeByContext c r = .ok (.word root,r))
    (size : root < Inv32Division.R) (away : wordEq root c.self = false)
    (run : Interaction.Executes (Stmt.eval (n+2) t c r (readWord data)) trace (.ok (.normal final))) :
    ∃ out, OracleEvent c r root bytes trace out := by
  have Z := Inv12.wordFromRead c r _ _ (Inv08.Authority.literal _ _ 0 (by decide))
  unfold readWord at run
  rw [Stmt.eval] at run
  simp only [read,Z,E,Value.expectWord,Value.asBytes?,show Shared.norm root=root from Nat.mod_eq_of_lt size,
    clean,show Shared.norm 0=0 by rfl,selfDispatchKindOk,away,Bool.true_and,Bool.false_and,
    Bool.not_false,Bool.not_true,Bool.and_false,Bool.false_or,Bool.false_eq_true,if_false] at run
  unfold selfDispatchCall at run
  simp only [selfDispatchKindOk,away,Bool.and_false,Bool.false_eq_true,if_false] at run
  unfold emitLowLevelCall at run
  cases run with
  | request out tail => exact ⟨out,_,rfl⟩

theorem readSuccessfulEvent (n : Nat) (t : FunctionTable) (c : Context) (r final : Runtime)
    (root : Nat) (data : Source.Expr) (bytes : List Source.Byte) (trace : Interaction.Transcript)
    (E : data.evalWithRuntimeByContext c r = .ok (.bytes bytes,r))
    (clean : bytes.map normByte = bytes)
    (read : (Source.Expr.immutable "securityPool").evalWithRuntimeByContext c r = .ok (.word root,r))
    (size : root < Inv32Division.R) (away : wordEq root c.self = false)
    (run : Interaction.Executes (Stmt.eval (n+2) t c r (readWord data)) trace (.ok (.normal final))) :
    ∃ out, OracleEvent c r root bytes trace out ∧ out.success = true := by
  have Z := Inv12.wordFromRead c r _ _ (Inv08.Authority.literal _ _ 0 (by decide))
  unfold readWord at run
  rw [Stmt.eval] at run
  simp only [read,Z,E,Value.expectWord,Value.asBytes?,show Shared.norm root=root from Nat.mod_eq_of_lt size,
    clean,show Shared.norm 0=0 by rfl,selfDispatchKindOk,away,Bool.true_and,Bool.false_and,
    Bool.not_false,Bool.not_true,Bool.and_false,Bool.false_or,Bool.false_eq_true,if_false] at run
  unfold selfDispatchCall at run
  simp only [selfDispatchKindOk,away,Bool.and_false,Bool.false_eq_true,if_false] at run
  unfold emitLowLevelCall at run
  cases run with
  | request out tail =>
    refine ⟨out,⟨_,rfl⟩,?_⟩
    cases ok : out.success with
    | true => rfl
    | false =>
      simp only [decodeCallResponse,ok,Bool.false_eq_true,if_false] at tail
      simp only [Interaction.bind, Bool.false_eq_true, if_false, TryCatchClause.findMatch?] at tail
      cases h : revertClassify ((byteArrayToBytes out.returnData).map normByte) <;>
        simp [h,TryCatchClause.errorClause?, TryCatchClause.panicClause?, TryCatchClause.catchAllClause?] at tail <;>
        cases tail


theorem readWordRecovered (n : Nat) (t : FunctionTable) (c : Context) (r final : Runtime)
    (root : Nat) (data : Source.Expr) (bytes : List Source.Byte) (trace : Interaction.Transcript)
    (E : data.evalWithRuntimeByContext c r = .ok (.bytes bytes,r))
    (clean : bytes.map normByte = bytes)
    (read : (Source.Expr.immutable "securityPool").evalWithRuntimeByContext c r = .ok (.word root,r))
    (size : root < Inv32Division.R) (away : wordEq root c.self = false)
    (env : CanonicalOracle c r root bytes trace)
    (run : Interaction.Executes (Stmt.eval (n+2) t c r (readWord data)) trace (.ok (.normal final))) :
    ∃ out x, OracleEvent c r root bytes trace out ∧ out.success = true ∧ x < Inv32Division.R ∧
      Inv48.ExposureComparison.decoded out x := by
  obtain ⟨out,event,success⟩ := readSuccessfulEvent n t c r final root data bytes trace E clean read size away run
  obtain ⟨x,fit,decoded⟩ := env out event
  exact ⟨out,x,event,success,fit,decoded⟩
end Inv48.MinimumSuccessWords
