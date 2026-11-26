import Inv45GetterCheckedArgs
open SolidCore.Solidity SolidCore.Solidity.Source Inv32Division
namespace Inv45.Public
set_option maxHeartbeats 4000000
set_option maxRecDepth 4096

def payoutArgument : Source.Expr := .fixedArray
  [.castOp .uintCleanup 120 (.var "firstPart"),.castOp .uintCleanup 120 (.var "secondPart")]

theorem clean120 (c : Context) (x : Nat) (X : x<2^120) :
    uintCleanup? c.checked 120 (.word x)=.ok (.word x) := by
  have W : x<R := lt_trans X (by decide)
  simp [uintCleanup?,uintCast?,Value.forceAbiLazy,Value.asStorageWord?,Shared.norm,show Shared.wordModulus=R from rfl,Nat.mod_eq_of_lt W,
    Nat.mod_eq_of_lt X,Bind.bind,Except.bind]
  all_goals norm_num at X; simp [Nat.not_le_of_lt X,Nat.mod_eq_of_lt X]

theorem payoutEval (c : Context) (r : Runtime) (n k : Nat) (N : n<2^120) (valid : k≤n)
    (first : r.lookupLocal? "firstPart"=some (.word (n-k)))
    (second : r.lookupLocal? "secondPart"=some (.word k)) :
    Expr.eval c r payoutArgument=pure (.fixedArray [.word (n-k),.word k],r) := by
  have F := clean120 c (n-k) (lt_of_le_of_lt (Nat.sub_le _ _) N)
  have K := clean120 c k (lt_of_le_of_lt valid N)
  have part (fuel : Nat) (name : String) (x : Nat) (localV : r.lookupLocal? name=some (.word x))
      (clean : uintCleanup? c.checked 120 (.word x)=.ok (.word x)) :
      Expr.evalFuel (fuel+3) c r (.castOp .uintCleanup 120 (.var name))=pure (.word x,r) := by
    rw [Expr.evalFuel,Inv32Guards.readWord _ _ _ _ _ localV]
    simp only [Inv08.Authority.bindPure,Inv08.Authority.liftPure,clean]
    all_goals intros;rename_i impossible;cases impossible
  change Expr.evalFuel 9 c r (.fixedArray _)=_
  rw [Expr.evalFuel,Expr.evalListFuel,part _ _ _ first F]
  simp only [Inv08.Authority.bindPure]
  rw [Expr.evalListFuel,part _ _ _ second K]
  rfl
theorem unitHoist (fuel : Nat) (t : FunctionTable) (c : Context) (r : Runtime) (q : Nat) (unit : List Nat)
    (look : r.lookupLocal? "questionId"=some (.word q))
    (load : r.loadStorageBasePath c (.field "questions") [.word q,.word 7]=.ok (.bytes unit)) :
    Stmt.eval (fuel+1) t c r (.memoryVarDecl .bytesCalldata "_ic_arg_1" (some unitArgument))=
      pure (.normal ((r.allocMemory (.bytes unit)).1.declareLocal "_ic_arg_1" (.memoryRef r.nextMemory))) := by
  have ev := unitEval c r q unit look load
  have ref : Expr.memoryRefOrValue c r unitArgument=pure (none,some (.bytes unit),r) := by
    change Expr.memoryRefOrValueFuel 6 c r (.storageRead .load "questions" [.var "questionId",.word 7])=_
    rw [Expr.memoryRefOrValueFuel.eq_def]
    change (do let (value,next) ← Expr.eval c r unitArgument;pure (none,some value,next))=_
    rw [ev];rfl
  rw [Stmt.eval];dsimp only;rw [ref]
  change (match r.declareMemoryLocal .bytesCalldata "_ic_arg_1" (.bytes unit) with
    | some updated => (pure (.normal updated) : SolI Result)
    | none => pure (.reverted r RevertData.typeMismatch))=_
  rw [unitDeclaration]
theorem payoutHoist (fuel : Nat) (t : FunctionTable) (c : Context) (r : Runtime) (n k : Nat)
    (N : n<2^120) (valid : k≤n)
    (first : r.lookupLocal? "firstPart"=some (.word (n-k)))
    (second : r.lookupLocal? "secondPart"=some (.word k)) :
    Stmt.eval (fuel+1) t c r (.memoryVarDecl (.fixedArray 2 .uint256) "_ic_arg_0" (some payoutArgument))=
      pure (.normal ((payoutAllocated r n k).declareLocal "_ic_arg_0" (.memoryRef r.nextMemory))) := by
  have ev := payoutEval c r n k N valid first second
  have ref : Expr.memoryRefOrValue c r payoutArgument=pure (none,some (.fixedArray [.word (n-k),.word k]),r) := by
    change Expr.memoryRefOrValueFuel 10 c r (.fixedArray _)=_
    rw [Expr.memoryRefOrValueFuel.eq_def]
    change (do let (value,next) ← Expr.eval c r payoutArgument;pure (none,some value,next))=_
    rw [ev];rfl
  rw [Stmt.eval];dsimp only;rw [ref]
  change (match r.declareMemoryLocal (.fixedArray 2 .uint256) "_ic_arg_0" (.fixedArray [.word (n-k),.word k]) with
    | some updated => (pure (.normal updated) : SolI Result)
    | none => pure (.reverted r RevertData.typeMismatch))=_
  rw [payoutDeclaration]
#print axioms payoutHoist
#print axioms unitHoist
#print axioms payoutEval
end Inv45.Public
