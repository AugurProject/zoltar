import Inv48PreLoopJoinSource
open SolidCore.Solidity.Source EvmCompiler.Simulation
open Inv48.EscrowJoin Inv48.EscrowPrefix Inv48.BatchInputLoop
namespace Inv48.PreLoopJoin
set_option maxRecDepth 65536
set_option maxHeartbeats 20000000

theorem frameAssignSelf (f : Frame) (name : String) (v : Value)
    (read : f.lookup? name = some v) : f.assign? name v = some f := by
  induction f with
  | nil => simp [Frame.lookup?] at read
  | cons pair tail ih =>
    rcases pair with ⟨key,old⟩
    by_cases eq : key = name
    · simp [Frame.lookup?,eq] at read
      simp [Frame.assign?,eq,read]
    · simp [Frame.lookup?,eq] at read
      simp [Frame.assign?,eq,ih read]

theorem frameAssignMissing (f : Frame) (name : String) (v : Value)
    (missing : f.lookup? name = none) : f.assign? name v = none := by
  induction f with
  | nil => rfl
  | cons pair rest ih =>
    rcases pair with ⟨key,old⟩
    by_cases eq : key = name
    · simp [Frame.lookup?,eq] at missing
    · simp [Frame.lookup?,eq] at missing
      simp [Frame.assign?,eq,ih missing]

theorem envAssignSelf (env : LocalEnv) (name : String) (v : Value)
    (read : env.lookup? name = some v) : env.assign? name v = some env := by
  induction env with
  | nil => simp [LocalEnv.lookup?] at read
  | cons f tail ih =>
    cases head : f.lookup? name with
    | some w =>
      simp [LocalEnv.lookup?,head] at read
      subst w
      simp [LocalEnv.assign?,frameAssignSelf f name v head]
    | none =>
      have missing := frameAssignMissing f name v head
      simp [LocalEnv.lookup?,head] at read
      simp [LocalEnv.assign?,missing,ih read]

theorem scalarAssignSelf (r : Runtime) (name : String) (p : Nat)
    (bound : r.lookupLocal? name = some (.word p)) : r.assignLocal? name (.word p) = some r := by
  have env := envAssignSelf r.locals name (.word p) bound
  simp [Runtime.assignLocal?,bound,Value.coerceLike?,env]

theorem cleanExecution (n : Nat) (c : Context) (r : Runtime) (p a b : Nat) (batch : Value)
    (inputs : Inputs r p a b batch) (hp : p < 2^256) (ha : a < 2^256) (hb : b < 2^256) :
    Stmt.evalList (n+1) Inv48.Source.model.core.table c r cleanPrefix = pure (.normal r) := by
  have one := Inv32FloorFastPath.cleanParamExec n Inv48.Source.model.core.table c r
    "proposedRepPerEthPrice" p hp inputs.1 (scalarAssignSelf r _ p inputs.1)
  have two := Inv32FloorFastPath.cleanParamExec n Inv48.Source.model.core.table c r
    "requestedInitialAttoWeth" a ha inputs.2.1 (scalarAssignSelf r _ a inputs.2.1)
  have three := Inv32FloorFastPath.cleanParamExec n Inv48.Source.model.core.table c r
    "bountyAttoEth" b hb inputs.2.2.1 (scalarAssignSelf r _ b inputs.2.2.1)
  have skip : Stmt.eval (n+1) Inv48.Source.model.core.table c r .skip = pure (.normal r) := by rw [Stmt.eval]
  unfold cleanPrefix
  rw [Inv32FloorStart.seqStep _ _ _ _ _ _ _ one,
    Inv32FloorStart.seqStep _ _ _ _ _ _ _ two,
    Inv32FloorStart.seqStep _ _ _ _ _ _ _ three,
    Inv32FloorStart.seqStep _ _ _ _ _ _ _ skip,
    Inv48.WholeQuote.singleList,skip]

theorem guardsRuntime (n : Nat) (c : Context) (r final : Runtime) (trace : Interaction.Transcript)
    (run : Interaction.Executes (Stmt.evalList n Inv48.Source.model.core.table c r guards) trace (.ok (.normal final))) :
    final = r := by
  obtain ⟨r1,t1,t2,_,one,rest⟩ := sequenceNormal n _ c r final _ _ trace run
  have eq := requireRuntime n _ c first _ firstRead r r1 t1 one
  subst r1
  obtain ⟨r2,t3,t4,_,two,rest⟩ := sequenceNormal n _ c r final _ _ t2 rest
  have eq := requireRuntime n _ c second _ secondRead r r2 t3 two
  subst r2
  obtain ⟨r3,t5,t6,_,three,rest⟩ := sequenceNormal n _ c r final _ _ t4 rest
  have eq := requireRuntime n _ c third _ thirdRead r r3 t5 three
  subst r3
  rw [Stmt.evalList] at rest
  cases rest
  rfl

theorem initialRuntime (n : Nat) (c : Context) (r final : Runtime) (trace : Interaction.Transcript)
    (run : Interaction.Executes (Stmt.evalList n Inv48.Source.model.core.table c r initialPrefix) trace (.ok (.normal final))) :
    final = r.declareLocal "requiredGas" (.word 0) := by
  rw [initialPrefix,Inv48.WholeQuote.listAppend] at run
  obtain ⟨v,before,after,_,first,last⟩ := Inv48.RequestDispatch.bindSuccess _ _ _ _ run
  cases v with
  | normal mid =>
    have eq := guardsRuntime n c r mid before first
    subst mid
    dsimp only at last
    rw [Inv48.WholeQuote.singleList] at last
    cases n with
    | zero => rw [Stmt.eval] at last; cases last
    | succ n =>
      have init : Stmt.eval (n+1) Inv48.Source.model.core.table c r (.varDecl .uint256 "requiredGas" none) =
          pure (.normal (r.declareLocal "requiredGas" (.word 0))) := by simp [Stmt.eval,Ty.defaultValue]
      rw [init] at last
      cases last
      rfl
  | _ => cases last

theorem pushInputs (r : Runtime) (p a b : Nat) (batch : Value) (inputs : Inputs r p a b batch) :
    Inputs r.pushScope p a b batch := inputs

theorem readyInputs (r : Runtime) (p a b : Nat) (batch : Value) (inputs : Inputs r p a b batch) :
    Inputs (r.declareLocal "requiredGas" (.word 0)) p a b batch ∧
    (r.declareLocal "requiredGas" (.word 0)).lookupLocal? "requiredGas" = some (.word 0) := by
  simpa [Inputs] using inputs
end Inv48.PreLoopJoin
