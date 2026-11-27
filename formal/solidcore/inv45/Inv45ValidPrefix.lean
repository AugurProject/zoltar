import Inv45SumSource
import Inv45ValidPrefixRules
open SolidCore.Solidity SolidCore.Solidity.Source Inv32Shapes
namespace Inv45.Public
set_option maxHeartbeats 400000
set_option maxRecDepth 8192
set_option linter.unusedSimpArgs false

def validPrefix : List Source.Stmt :=
  match firstDecision getterShape.value with
  | some (_, .block xs, _) => xs.take 13
  | _ => []

def validPrefixTail : List Source.Stmt :=
  match firstDecision getterShape.value with
  | some (_, .block xs, _) => xs.drop 13
  | _ => []

theorem generatedValidPrefixShape :
    ∃ no, firstDecision getter.body = some (scalarCheck, .block (validPrefix ++ validPrefixTail), no) ∧
      validPrefixTail.head? = some (.varDecl .uint256 "sum" (some tickSum)) := by
  rw [getterSource]
  exact ⟨_, rfl, rfl⟩

def validPrefixState (r : Runtime) (n k f s rf rs : Nat) : Runtime :=
  (((((((r.pushScope.declareLocal "invalid" (.word 0)).declareLocal "firstPart" (.word f)).declareLocal "secondPart" (.word s)).declareLocal "_ic_arg_0" (.word (Answer.encode n k))).declareLocal "_ret_splitUint256IntoTwoWithInvalid_0" (.word 0)).declareLocal "_ret_splitUint256IntoTwoWithInvalid_1" (.word rf)).declareLocal "_ret_splitUint256IntoTwoWithInvalid_2" (.word rs))

-- The branch block has already pushed its scope when this sequence starts.
def validPrefixRuntime (r : Runtime) (n k : Nat) : Runtime :=
  validPrefixState r n k (n-k) k (n-k) k

def prefixReserved : Source.Stmt := .block [
  .varDecl .bool "_sol_hoist_0" none,
  .block [.varDecl .uint256 "_ic_arg_0" (some (.castOp .uintCleanup 256 (.var "answer"))),
    .varDecl .bool "_ret_hasNonZeroScalarReservedBits_0" none,
    .captureReturn ["_ret_hasNonZeroScalarReservedBits_0"] (.internalCall ["_ret_hasNonZeroScalarReservedBits_0"] reservedKey [.var "_ic_arg_0"]),
    .assign (.var "_sol_hoist_0") (.var "_ret_hasNonZeroScalarReservedBits_0")],
  .varDecl .bool "#view1593" (some (.var "_sol_hoist_0")),
  .ifElse (.var "#view1593") (.returnValues [.byteArray [77,97,108,102,111,114,109,101,100]]) .skip]

def prefixInvalidBody : Source.Stmt :=
  match (validPrefix[12]? : Option Source.Stmt) with
  | some (.ifElse _ yes _) => yes
  | _ => .skip

theorem prefixReservedExecution (fuel : Nat) (c : Context) (r : Runtime) (n k : Nat)
    (N : n<Answer.radix) (valid : k≤n)
    (input : r.lookupLocal? "answer"=some (.word (Answer.encode n k))) :
    Stmt.eval (fuel+32) model.core.table c r prefixReserved=pure (.normal r) := by
  let s := r.pushScope.declareLocal "_sol_hoist_0" (.word 0)
  let a := s.pushScope.declareLocal "_ic_arg_0" (.word (Answer.encode n k))
  let b := a.declareLocal "_ret_hasNonZeroScalarReservedBits_0" (.word 0)
  let d := s.declareLocal "#view1593" (.word 0)
  have A := Answer.fit n k N valid
  have arg : Stmt.eval (fuel+30) model.core.table c s.pushScope (.varDecl .uint256 "_ic_arg_0" (some (.castOp .uintCleanup 256 (.var "answer"))))=pure (.normal a) := by
    apply Inv32Hoist.declEval (fuel+29)
    · apply prefixCleanRead
      · simpa [s,Runtime.lookupLocal?,Runtime.pushScope,Runtime.declareLocal,LocalEnv.declare,LocalEnv.lookup?,Frame.lookup?] using input
      · exact A
    · rfl
  have call : Stmt.eval (fuel+30) model.core.table c b (.captureReturn ["_ret_hasNonZeroScalarReservedBits_0"] (.internalCall ["_ret_hasNonZeroScalarReservedBits_0"] reservedKey [.var "_ic_arg_0"]))=pure (.normal b) := by
    apply prefixReservedCall (fuel+24) _ _ _ n k _ _ N valid
    · simp [b,a,s,Runtime.pushScope,Runtime.lookupLocal?,Runtime.declareLocal,LocalEnv.declare,LocalEnv.lookup?,Frame.lookup?]
    · simp [b,a,s,Runtime.assignNamedValuesRef?,Runtime.assignLocalRefAware?,Runtime.assignLocal?,Runtime.assignLocalRaw?,Runtime.lookupLocal?,Runtime.declareLocal,Runtime.pushScope,LocalEnv.declare,LocalEnv.lookup?,LocalEnv.assign?,Frame.lookup?,Frame.assign?,Value.coerceLike?]
  have copy : Stmt.eval (fuel+30) model.core.table c b (.assign (.var "_sol_hoist_0") (.var "_ret_hasNonZeroScalarReservedBits_0"))=pure (.normal b) := by
    apply prefixAssign (fuel+29) _ _ _ _ _ _ 0 0
    all_goals simp [b,a,s,Runtime.assignLocal?,Runtime.lookupLocal?,Runtime.declareLocal,Runtime.pushScope,LocalEnv.declare,LocalEnv.lookup?,LocalEnv.assign?,Frame.lookup?,Frame.assign?,Value.coerceLike?]
  have inner : Stmt.eval (fuel+31) model.core.table c s (.block [.varDecl .uint256 "_ic_arg_0" (some (.castOp .uintCleanup 256 (.var "answer"))),
    .varDecl .bool "_ret_hasNonZeroScalarReservedBits_0" none,
    .captureReturn ["_ret_hasNonZeroScalarReservedBits_0"] (.internalCall ["_ret_hasNonZeroScalarReservedBits_0"] reservedKey [.var "_ic_arg_0"]),
    .assign (.var "_sol_hoist_0") (.var "_ret_hasNonZeroScalarReservedBits_0")])=pure (.normal s) := by
    have z := Inv32Hoist.zeroBool (fuel+29) model.core.table c a "_ret_hasNonZeroScalarReservedBits_0"
    have run := (Inv32FloorStart.seqStep _ _ _ _ _ _ _ arg).trans
      ((Inv32FloorStart.seqStep _ _ _ _ _ _ _ z).trans
      ((Inv32FloorStart.seqStep _ _ _ _ _ _ _ call).trans
      ((Inv32FloorStart.seqStep _ _ _ _ _ _ [] copy).trans (by rw [Stmt.evalList]))))
    exact Inv32Hoist.block (fuel+30) model.core.table c s b _ run
  have view : Stmt.eval (fuel+31) model.core.table c s (.varDecl .bool "#view1593" (some (.var "_sol_hoist_0")))=pure (.normal d) := by
    apply Inv32Hoist.declEval (fuel+30)
    · apply prefixVar
      rfl
    · rfl
  have guard := prefixFalse (fuel+29) model.core.table c d "#view1593" (.returnValues [.byteArray [77,97,108,102,111,114,109,101,100]]) rfl
  have z := Inv32Hoist.zeroBool (fuel+30) model.core.table c r.pushScope "_sol_hoist_0"
  have run := (Inv32FloorStart.seqStep _ _ _ _ _ _ _ z).trans
    ((Inv32FloorStart.seqStep _ _ _ _ _ _ _ inner).trans
    ((Inv32FloorStart.seqStep _ _ _ _ _ _ _ view).trans
    ((Inv32FloorStart.seqStep _ _ _ _ _ _ [] guard).trans (by rw [Stmt.evalList]))))
  exact Inv32Hoist.block (fuel+31) model.core.table c r d _ run

theorem validPrefixContinue (fuel : Nat) (tail : List Source.Stmt) (c : Context) (r : Runtime) (n k : Nat)
    (N : n < Answer.radix) (valid : k ≤ n)
    (input : r.lookupLocal? "answer" = some (.word (Answer.encode n k))) :
    Stmt.evalList (fuel+32) model.core.table c r.pushScope (validPrefix++tail) =
      Stmt.evalList (fuel+32) model.core.table c (validPrefixRuntime r n k) tail := by
  change Stmt.evalList (fuel+32) model.core.table c r.pushScope ([prefixReserved,
    .varDecl .bool "invalid" none, .varDecl .uint256 "firstPart" none, .varDecl .uint256 "secondPart" none,
    .varDecl .uint256 "_ic_arg_0" (some (.castOp .uintCleanup 256 (.var "answer"))),
    .varDecl .bool "_ret_splitUint256IntoTwoWithInvalid_0" none,
    .varDecl .uint256 "_ret_splitUint256IntoTwoWithInvalid_1" none,
    .varDecl .uint256 "_ret_splitUint256IntoTwoWithInvalid_2" none,
    .captureReturn ["_ret_splitUint256IntoTwoWithInvalid_0","_ret_splitUint256IntoTwoWithInvalid_1","_ret_splitUint256IntoTwoWithInvalid_2"]
      (.internalCall ["_ret_splitUint256IntoTwoWithInvalid_0","_ret_splitUint256IntoTwoWithInvalid_1","_ret_splitUint256IntoTwoWithInvalid_2"] splitKey [.var "_ic_arg_0"]),
    .assign (.var "invalid") (.var "_ret_splitUint256IntoTwoWithInvalid_0"),
    .assign (.var "firstPart") (.var "_ret_splitUint256IntoTwoWithInvalid_1"),
    .assign (.var "secondPart") (.var "_ret_splitUint256IntoTwoWithInvalid_2"),
    .ifElse (.var "invalid") prefixInvalidBody .skip]++tail) = _
  simp only [List.cons_append,List.nil_append]
  have A := Answer.fit n k N valid
  have F : n-k<Inv32Division.R := lt_trans (lt_of_le_of_lt (Nat.sub_le _ _) N) (by decide)
  have K : k<Inv32Division.R := lt_trans (lt_of_le_of_lt valid N) (by decide)
  refine prefixSeq (next := r.pushScope) (prefixReservedExecution fuel c r.pushScope n k N valid ?_) ?_
  · simpa [Runtime.lookupLocal?,Runtime.pushScope,LocalEnv.lookup?] using input
  · let a0 := r.pushScope.declareLocal "invalid" (.word 0)
    let a1 := a0.declareLocal "firstPart" (.word 0)
    let a2 := a1.declareLocal "secondPart" (.word 0)
    let a3 := a2.declareLocal "_ic_arg_0" (.word (Answer.encode n k))
    let a4 := a3.declareLocal "_ret_splitUint256IntoTwoWithInvalid_0" (.word 0)
    let a5 := a4.declareLocal "_ret_splitUint256IntoTwoWithInvalid_1" (.word 0)
    let a6 := a5.declareLocal "_ret_splitUint256IntoTwoWithInvalid_2" (.word 0)
    let b := validPrefixState r n k 0 0 (n-k) k
    let d := validPrefixState r n k (n-k) 0 (n-k) k
    have call : Stmt.eval (fuel+32) model.core.table c a6 (.captureReturn ["_ret_splitUint256IntoTwoWithInvalid_0","_ret_splitUint256IntoTwoWithInvalid_1","_ret_splitUint256IntoTwoWithInvalid_2"]
      (.internalCall ["_ret_splitUint256IntoTwoWithInvalid_0","_ret_splitUint256IntoTwoWithInvalid_1","_ret_splitUint256IntoTwoWithInvalid_2"] splitKey [.var "_ic_arg_0"]))=pure (.normal b) := by
      apply prefixSplitCall (fuel+26) _ _ _ n k N valid
      · rfl
      · simp [a6,a5,a4,a3,a2,a1,a0,b,validPrefixState,Runtime.assignNamedValuesRef?,Runtime.assignLocalRefAware?,Runtime.assignLocal?,Runtime.assignLocalRaw?,Runtime.lookupLocal?,Runtime.declareLocal,Runtime.pushScope,LocalEnv.declare,LocalEnv.lookup?,LocalEnv.assign?,Frame.lookup?,Frame.assign?,Value.coerceLike?, Shared.norm,Nat.mod_eq_of_lt F,Nat.mod_eq_of_lt K]
    have ci : Stmt.eval (fuel+32) model.core.table c b (.assign (.var "invalid") (.var "_ret_splitUint256IntoTwoWithInvalid_0"))=pure (.normal b) := by
      apply prefixAssign (fuel+31) _ _ _ _ _ _ 0 0
      all_goals simp [b,validPrefixState,Runtime.assignLocal?,Runtime.lookupLocal?,Runtime.declareLocal,Runtime.pushScope,LocalEnv.declare,LocalEnv.lookup?,LocalEnv.assign?,Frame.lookup?,Frame.assign?,Value.coerceLike?]
    have cf : Stmt.eval (fuel+32) model.core.table c b (.assign (.var "firstPart") (.var "_ret_splitUint256IntoTwoWithInvalid_1"))=pure (.normal d) := by
      apply prefixAssign (fuel+31) _ _ _ _ _ _ 0 (n-k)
      all_goals simp [b,d,validPrefixState,Runtime.assignLocal?,Runtime.lookupLocal?,Runtime.declareLocal,Runtime.pushScope,LocalEnv.declare,LocalEnv.lookup?,LocalEnv.assign?,Frame.lookup?,Frame.assign?,Value.coerceLike?,Shared.norm,Nat.mod_eq_of_lt F]
    have cs : Stmt.eval (fuel+32) model.core.table c d (.assign (.var "secondPart") (.var "_ret_splitUint256IntoTwoWithInvalid_2"))=pure (.normal (validPrefixRuntime r n k)) := by
      apply prefixAssign (fuel+31) _ _ _ _ _ _ 0 k
      all_goals simp [d,validPrefixRuntime,validPrefixState,Runtime.assignLocal?,Runtime.lookupLocal?,Runtime.declareLocal,Runtime.pushScope,LocalEnv.declare,LocalEnv.lookup?,LocalEnv.assign?,Frame.lookup?,Frame.assign?,Value.coerceLike?,Shared.norm,Nat.mod_eq_of_lt K]
    have arg : Stmt.eval (fuel+32) model.core.table c a2 (.varDecl .uint256 "_ic_arg_0" (some (.castOp .uintCleanup 256 (.var "answer"))))=pure (.normal a3) := by
      apply Inv32Hoist.declEval (fuel+31)
      · apply prefixCleanRead
        · simpa [a2,a1,a0,Runtime.lookupLocal?,Runtime.pushScope,Runtime.declareLocal,LocalEnv.declare,LocalEnv.lookup?,Frame.lookup?] using input
        · exact A
      · rfl
    have guard := prefixFalse (fuel+30) model.core.table c (validPrefixRuntime r n k) "invalid" prefixInvalidBody (by rfl)
    rw [Inv32FloorStart.seqStep _ _ _ _ _ _ _ (Inv32Hoist.zeroBool (fuel+31) model.core.table c r.pushScope "invalid"),
      Inv32FloorStart.seqStep _ _ _ _ _ _ _ (Inv32FloorStart.zero (fuel+31) model.core.table c a0 "firstPart"),
      Inv32FloorStart.seqStep _ _ _ _ _ _ _ (Inv32FloorStart.zero (fuel+31) model.core.table c a1 "secondPart"),
      Inv32FloorStart.seqStep _ _ _ _ _ _ _ arg,
      Inv32FloorStart.seqStep _ _ _ _ _ _ _ (Inv32Hoist.zeroBool (fuel+31) model.core.table c a3 "_ret_splitUint256IntoTwoWithInvalid_0"),
      Inv32FloorStart.seqStep _ _ _ _ _ _ _ (Inv32FloorStart.zero (fuel+31) model.core.table c a4 "_ret_splitUint256IntoTwoWithInvalid_1"),
      Inv32FloorStart.seqStep _ _ _ _ _ _ _ (Inv32FloorStart.zero (fuel+31) model.core.table c a5 "_ret_splitUint256IntoTwoWithInvalid_2"),
      Inv32FloorStart.seqStep _ _ _ _ _ _ _ call,
      Inv32FloorStart.seqStep _ _ _ _ _ _ _ ci,
      Inv32FloorStart.seqStep _ _ _ _ _ _ _ cf,
      Inv32FloorStart.seqStep _ _ _ _ _ _ _ cs,
      Inv32FloorStart.seqStep _ _ _ _ _ _ _ guard]


theorem validPrefixExecution (fuel : Nat) (c : Context) (r : Runtime) (n k : Nat)
    (N : n<Answer.radix) (valid : k≤n)
    (input : r.lookupLocal? "answer"=some (.word (Answer.encode n k))) :
    Stmt.evalList (fuel+32) model.core.table c r.pushScope validPrefix=
      pure (.normal (validPrefixRuntime r n k)) := by
  simpa only [List.append_nil,Stmt.evalList] using validPrefixContinue fuel [] c r n k N valid input

theorem validPrefixRuntimeFacts (r : Runtime) (n k q : Nat)
    (question : r.lookupLocal? "questionId"=some (.word q)) :
    (validPrefixRuntime r n k).lookupLocal? "invalid"=some (.word 0) ∧
    (validPrefixRuntime r n k).lookupLocal? "firstPart"=some (.word (n-k)) ∧
    (validPrefixRuntime r n k).lookupLocal? "secondPart"=some (.word k) ∧
    (validPrefixRuntime r n k).lookupLocal? "questionId"=some (.word q) ∧
    (validPrefixRuntime r n k).state=r.state := by
  refine ⟨rfl,rfl,rfl,?_,rfl⟩
  simpa [validPrefixRuntime,validPrefixState,Runtime.lookupLocal?,Runtime.pushScope,
    Runtime.declareLocal,LocalEnv.declare,LocalEnv.lookup?,Frame.lookup?] using question

theorem generatedValidPrefix (fuel : Nat) (c : Context) (r : Runtime) (n k q : Nat)
    (N : n<Answer.radix) (valid : k≤n)
    (input : r.lookupLocal? "answer"=some (.word (Answer.encode n k)))
    (question : r.lookupLocal? "questionId"=some (.word q)) :
    ∃ no,
      firstDecision getter.body=some (scalarCheck,.block (validPrefix++validPrefixTail),no) ∧
      validPrefixTail.head?=some (.varDecl .uint256 "sum" (some tickSum)) ∧
      Stmt.evalList (fuel+32) model.core.table c r.pushScope validPrefix=
        pure (.normal (validPrefixRuntime r n k)) ∧
      (validPrefixRuntime r n k).lookupLocal? "invalid"=some (.word 0) ∧
      (validPrefixRuntime r n k).lookupLocal? "firstPart"=some (.word (n-k)) ∧
      (validPrefixRuntime r n k).lookupLocal? "secondPart"=some (.word k) ∧
      (validPrefixRuntime r n k).lookupLocal? "questionId"=some (.word q) ∧
      (validPrefixRuntime r n k).state=r.state := by
  obtain ⟨no,shape,tail⟩ := generatedValidPrefixShape
  exact ⟨no,shape,tail,validPrefixExecution fuel c r n k N valid input,
    validPrefixRuntimeFacts r n k q question⟩

theorem generatedValidPrefixResume (fuel : Nat) (c : Context) (r : Runtime) (n k q : Nat)
    (N : n<Answer.radix) (valid : k≤n)
    (input : r.lookupLocal? "answer"=some (.word (Answer.encode n k)))
    (fields : c.storageFields=model.core.storageFields)
    (question : r.lookupLocal? "questionId"=some (.word q))
    (scalar : r.state.loadSlot (labelsSlot q)=0) :
    ∃ no, firstDecision getter.body=some (scalarCheck,.block (validPrefix++validPrefixTail),no) ∧
      Stmt.eval (fuel+34) model.core.table c r
        (.ifElse scalarCheck (.block (validPrefix++validPrefixTail)) no)=
      (do let result ← Stmt.evalList (fuel+32) model.core.table c (validPrefixRuntime r n k) validPrefixTail
          pure (result.mapRuntime Runtime.popScope)) := by
  obtain ⟨no,shape,_⟩ := generatedValidPrefixShape
  refine ⟨no,shape,?_⟩
  rw [selectScalar (fuel+33) model.core.table c r q _ _ fields question scalar]
  rw [Stmt.eval]
  dsimp only
  rw [validPrefixContinue fuel validPrefixTail c r n k N valid input]

#print axioms generatedValidPrefixResume
#print axioms validPrefixContinue
#print axioms generatedValidPrefix
#print axioms validPrefixExecution
#print axioms prefixReservedExecution
end Inv45.Public
