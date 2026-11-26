import Inv45ShiftValue
open SolidCore.Solidity SolidCore.Solidity.Source Inv32Division Inv32Shapes Inv03.Bodies
namespace Inv45.Public
set_option maxHeartbeats 4000000
set_option linter.unusedSimpArgs false
abbrev splitKey := "__internal_splitUint256IntoTwoWithInvalid(uint256)#[SolidCore.Solidity.Ty.uint 256]"
def splitFn? := model.core.table.lookup? splitKey
theorem splitPresent : splitFn?.isSome := by native_decide
def splitFn := splitFn?.get splitPresent
def shr := Expr_binary (⟨.shr,(fun | .shr=>true | _=>false),by intro v h;cases v <;> simp_all⟩)
def cast120 (e : Pattern Source.Expr) := Expr_castOp CastKind_uintCast (lit 120) e
def flag := Expr_binary BinaryOp_eq (clean (shr (varP "value") (num 255))) (num 0)
def lowBits (shift : Bool) := cast120 (clean (twice (band
  (clean (if shift then shr (varP "value") (num 120) else varP "value")) (twice (num (2^120-1))))))
def splitBody := block [param "value",Stmt_skip,Stmt_skip,Stmt_skip,block [
  Inv03.Bodies.assign "invalid" flag,Inv03.Bodies.assign "firstPart" (lowBits true),Inv03.Bodies.assign "secondPart" (lowBits false)]]
theorem splitSource : splitFn.body=splitBody.value := splitBody.sound _ (by native_decide)
theorem shrRead {c r e x b} (E : Inv40.Reads c r (e : Pattern Source.Expr).value x) (X : x<R) (B : b<256) :
    Inv40.Reads c r (shr e (num b)).value (x >>> b) := by
  apply Inv08.ReleaseQuote.binary E (Inv08.Authority.literal c r b (lt_trans B (by decide))) .shr
    (by intro h;cases h) (by intro h;cases h)
  exact shrValue c.checked x b X (lt_trans B (by decide)) B
theorem flagRead (c : Context) (r : Runtime) (n k : Nat) (N : n<Answer.radix) (valid : k≤n)
    (V : r.lookupLocal? "value"=some (.word (Answer.encode n k))) : Inv40.Reads c r flag.value 0 := by
  have A := Answer.fit n k N valid
  have read := shrRead (c:=c) (e:=varP "value") (Inv08.localReads _ _ _ _ V) A (by decide : 255<256)
  rw [Answer.high n k N valid] at read
  exact Inv08.ReleaseQuote.binary (Inv08.ReleaseQuote.readClean read (by decide)) (Inv08.Authority.literal c r 0 (by decide)) .eq
    (by intro h;cases h) (by intro h;cases h) rfl
theorem castSmall {c r e x} (E : Inv40.Reads c r (e : Pattern Source.Expr).value x) (X : x<2^120) :
    Inv40.Reads c r (cast120 e).value x := by
  have fit : x<R := lt_trans X (by decide)
  have op : uintCast? 120 (.word x)=.ok (.word x) := by
    simp [uintCast?,Value.forceAbiLazy,Value.asStorageWord?,Shared.norm,show Shared.wordModulus=R from rfl,Nat.mod_eq_of_lt fit,Nat.mod_eq_of_lt X,Bind.bind,Except.bind]
    exact X
  intro fuel enough
  change e.value.orderFuel+1≤fuel at enough
  cases fuel with
  | zero=>omega
  | succ fuel=>
    change Expr.evalFuel (fuel+1) c r (.castOp .uintCast 120 e.value)=_
    rw [Expr.evalFuel,E fuel (by omega)];simp only [Inv08.Authority.bindPure,Inv08.Authority.liftPure,op]
theorem partsRead (c : Context) (r : Runtime) (n k : Nat) (N : n<Answer.radix) (valid : k≤n)
    (V : r.lookupLocal? "value"=some (.word (Answer.encode n k))) (shift : Bool) :
    Inv40.Reads c r (lowBits shift).value (if shift then n-k else k) := by
  have A := Answer.fit n k N valid
  have M : 2^120-1<R := by decide
  have K : k<2^120 := lt_of_le_of_lt valid N
  have F : n-k<2^120 := lt_of_le_of_lt (Nat.sub_le _ _) N
  apply castSmall
  · apply Inv08.ReleaseQuote.readClean
    · apply MulDiv.twiceReads
      · cases shift
        · have rd := Inv08.ReleaseQuote.binary (MulDiv.wordVar c r "value" _ A V)
            (MulDiv.twiceReads (e:=num (2^120-1)) (Inv08.Authority.literal c r (2^120-1) M) M) .bitAnd
            (by intro h;cases h) (by intro h;cases h) (andValue c.checked _ _ A M)
          change Inv40.Reads c r (band (clean (varP "value")) (twice (num (2^120-1)))).value (Answer.encode n k &&& (2^120-1)) at rd
          rw [Answer.low n k N valid] at rd
          exact rd
        · have S : Answer.encode n k >>> 120<R := lt_of_le_of_lt (Nat.shiftRight_le _ _) A
          have rd := Inv08.ReleaseQuote.binary (Inv08.ReleaseQuote.readClean (shrRead (c:=c) (e:=varP "value") (Inv08.localReads _ _ _ _ V) A (by decide : 120<256)) S)
            (MulDiv.twiceReads (e:=num (2^120-1)) (Inv08.Authority.literal c r (2^120-1) M) M) .bitAnd
            (by intro h;cases h) (by intro h;cases h) (andValue c.checked _ _ S M)
          change Inv40.Reads c r (band (clean (shr (varP "value") (num 120))) (twice (num (2^120-1)))).value ((Answer.encode n k >>> 120) &&& (2^120-1)) at rd
          rw [Answer.midpoint n k N valid] at rd
          exact rd
      · cases shift <;> simp only [Bool.false_eq_true,if_false,if_true] <;> exact lt_trans (by assumption) (by decide)
    · cases shift <;> simp only [Bool.false_eq_true,if_false,if_true] <;> exact lt_trans (by assumption) (by decide)
  · cases shift <;> assumption
theorem assignBinary (fuel : Nat) (t : FunctionTable) (c : Context) (r next : Runtime)
    (name : String) (old v : Nat) (op : Source.BinaryOp) (lhs rhsExpr : Source.Expr)
    (bound : r.lookupLocal? name = some (.word old))
    (rhs : Expr.eval c r (.binary op lhs rhsExpr) = pure (.word v,r))
    (store : r.assignLocal? name (.word v) = some next) :
    Stmt.eval (fuel+1) t c r (.assign (.var name) (.binary op lhs rhsExpr)) = pure (.normal next) := by
  have notMem : (LValue.var name).wantsMemoryRefRhs r = false := by
    simp [LValue.wantsMemoryRefRhs, Runtime.lookupMemoryRef?, bound]
  rw [Stmt.eval]
  dsimp only
  rw [notMem]
  simp only [Bool.false_eq_true, if_false, rhs]
  change (do
    match ← ((LValue.var name).resolveWithRuntime c r).caught with
    | .ok (target,r') => match target.write c r' (.word v) with
      | .ok updated => pure (Result.normal updated)
      | .error err => pure (Result.reverted r err)
    | .error err => pure (Result.reverted r err)) = _
  rw [Inv32Writes.resolve c r name old bound]
  have stored : (ResolvedLValue.local name).write c r (.word v) = .ok next := by simp [ResolvedLValue.write,store]
  change (match (ResolvedLValue.local name).write c r (.word v) with
    | .ok updated => (pure (Result.normal updated) : SolI Result)
    | .error err => pure (Result.reverted r err)) = _
  rw [stored]

def splitEntry (r : Runtime) (a f s : Nat) := r.withFrame [("value",.word a),("invalid",.word 0),("firstPart",.word f),("secondPart",.word s)]
theorem splitExecution (fuel : Nat) (c : Context) (r : Runtime) (n k : Nat) (N : n<Answer.radix) (valid : k≤n) :
    Stmt.eval (fuel+4) model.core.table c (splitEntry r (Answer.encode n k) 0 0) splitFn.body=
      pure (.normal (splitEntry r (Answer.encode n k) (n-k) k)) := by
  let t := model.core.table
  let a := splitEntry r (Answer.encode n k) 0 0
  let b := splitEntry r (Answer.encode n k) (n-k) 0
  let z := splitEntry r (Answer.encode n k) (n-k) k
  have fit : k<R := lt_trans (lt_of_le_of_lt valid N) (by decide)
  have firstFit : n-k<R := lt_trans (lt_of_le_of_lt (Nat.sub_le _ _) N) (by decide)
  have cleanup := Inv32FloorFastPath.cleanParamExec (fuel+2) t c a.pushScope "value" _ (Answer.fit n k N valid) rfl
    (by simp [a,splitEntry,Runtime.assignLocal?,Runtime.lookupLocal?,Runtime.withFrame,Runtime.pushScope,
      LocalEnv.assign?,LocalEnv.lookup?,Frame.lookup?,Frame.assign?,Value.coerceLike?])
  have si : Stmt.eval (fuel+2) t c a.pushScope.pushScope (Inv03.Bodies.assign "invalid" flag).value=pure (.normal a.pushScope.pushScope) :=
    assignBinary _ _ _ _ _ "invalid" 0 0 .eq (clean (shr (varP "value") (num 255))).value (num 0).value rfl (flagRead c a.pushScope.pushScope n k N valid rfl _ (Nat.le_succ _))
      (by simp [a,splitEntry,Runtime.assignLocal?,Runtime.lookupLocal?,Runtime.withFrame,Runtime.pushScope,
        LocalEnv.assign?,LocalEnv.lookup?,Frame.lookup?,Frame.assign?,Value.coerceLike?])
  have sf : Stmt.eval (fuel+2) t c a.pushScope.pushScope (Inv03.Bodies.assign "firstPart" (lowBits true)).value=pure (.normal b.pushScope.pushScope) :=
    Inv32Assign.scalarCast _ _ _ _ _ "firstPart" 0 (n-k) .uintCast 120 _ rfl (partsRead c a.pushScope.pushScope n k N valid rfl true _ (Nat.le_succ _))
      (by simp [a,b,splitEntry,Runtime.assignLocal?,Runtime.lookupLocal?,Runtime.withFrame,Runtime.pushScope,
        LocalEnv.assign?,LocalEnv.lookup?,Frame.lookup?,Frame.assign?,Value.coerceLike?,Nat.mod_eq_of_lt firstFit])
  have ss : Stmt.eval (fuel+2) t c b.pushScope.pushScope (Inv03.Bodies.assign "secondPart" (lowBits false)).value=pure (.normal z.pushScope.pushScope) :=
    Inv32Assign.scalarCast _ _ _ _ _ "secondPart" 0 k .uintCast 120 _ rfl (partsRead c b.pushScope.pushScope n k N valid rfl false _ (Nat.le_succ _))
      (by simp [b,z,splitEntry,Runtime.assignLocal?,Runtime.lookupLocal?,Runtime.withFrame,Runtime.pushScope,
        LocalEnv.assign?,LocalEnv.lookup?,Frame.lookup?,Frame.assign?,Value.coerceLike?,Nat.mod_eq_of_lt fit])
  have inner : Stmt.eval (fuel+3) t c a.pushScope (block [Inv03.Bodies.assign "invalid" flag,
      Inv03.Bodies.assign "firstPart" (lowBits true),Inv03.Bodies.assign "secondPart" (lowBits false)]).value=pure (.normal z.pushScope) := by
    change Stmt.eval _ _ _ _ (.block [_,_,_])=_
    rw [Stmt.eval];dsimp only
    rw [Inv32FloorStart.seqStep _ _ _ _ _ _ _ si,Inv32FloorStart.seqStep _ _ _ _ _ _ _ sf,
      Inv32FloorStart.seqStep _ _ _ _ _ _ _ ss,Stmt.evalList]
    rfl
  have skip : Stmt.eval (fuel+3) t c a.pushScope Stmt_skip.value=pure (.normal a.pushScope) := by change Stmt.eval _ _ _ _ .skip=_;rw [Stmt.eval]
  have clean' : Stmt.eval (fuel+3) t c a.pushScope (param "value").value=pure (.normal a.pushScope) := cleanup
  rw [splitSource]
  change Stmt.eval _ _ _ _ (.block [_,_,_,_,_])=_
  rw [Stmt.eval];dsimp only
  rw [Inv32FloorStart.seqStep _ _ _ _ _ _ _ clean',Inv32FloorStart.seqStep _ _ _ _ _ _ _ skip,
    Inv32FloorStart.seqStep _ _ _ _ _ _ _ skip,Inv32FloorStart.seqStep _ _ _ _ _ _ _ skip,
    Inv32FloorStart.seqStep _ _ _ _ _ _ _ inner,Stmt.evalList]
  rfl
private def splitSig : List BindingDecl→List BindingDecl→Bool
  | [⟨"value",.uint256,false⟩],[⟨"invalid",.bool,false⟩,⟨"firstPart",.uint256,false⟩,⟨"secondPart",.uint256,false⟩]=>true
  | _,_=>false
theorem splitSignature : splitFn.params=[⟨"value",.uint256,false⟩] ∧
    splitFn.returns=[⟨"invalid",.bool,false⟩,⟨"firstPart",.uint256,false⟩,⟨"secondPart",.uint256,false⟩] := by
  have h : splitSig splitFn.params splitFn.returns := by native_decide
  generalize splitFn.params=ps at *;generalize splitFn.returns=rs at *
  unfold splitSig at h;split at h <;> simp_all
theorem splitCall (fuel : Nat) (c : Context) (r : Runtime) (n k : Nat) (name : String) (targets : List String)
    (N : n<Answer.radix) (valid : k≤n) (input : r.lookupLocal? name=some (.word (Answer.encode n k))) :
    Stmt.eval (fuel+5) model.core.table c r (.internalCall targets splitKey [.var name])=
      internalCallAssign r targets [.word 0,.word (n-k),.word k] := by
  let empty := {r with locals:=[]}
  have found : model.core.table.lookup? splitKey=some splitFn := (Option.some_get splitPresent).symm
  have args : Expr.evalRefArgList c r [.var name]=pure ([.word (Answer.encode n k)],r) := by
    change Expr.evalRefArgListFuel (_+1) c r [.var name]=_
    simp only [Expr.orderFuel,Expr.listEvalFuel,Nat.reduceAdd,Expr.evalRefArgListFuel,
      Inv32ProductCall.wordArg _ _ _ _ input,Inv08.Authority.bindPure]
  obtain ⟨ps,rs⟩ := splitSignature
  have enter : internalCallEnter? splitFn [.word (Answer.encode n k)] r=some (splitEntry empty (Answer.encode n k) 0 0,r.locals) := by
    unfold internalCallEnter? InternalFunction.initialFrame? InternalFunction.returnDefaultBindings
    rw [ps,rs];simp [BindingDecl.bindArgsRef?,BindingDecl.bindArgRef?,BindingDecl.bindArg?,BindingDecl.defaultBinding,
      Ty.coerceValue?,Ty.defaultValue,splitEntry,empty,Runtime.withFrame]
  have ev := splitExecution fuel {c with checked:=true} empty n k N valid
  rw [Inv32Internal.call _ _ _ _ _ _ _ _ _ _ _ _ _ args found enter ev]
  simp [internalCallFinish,rs,collectReturnBindingsRef,collectReturnBindingsRef.collect,Runtime.derefMemoryValueDeep,
    Runtime.derefMemoryValueWithFuel,Ty.coerceValue?,Bind.bind,Except.bind,splitEntry,empty,Runtime.withFrame,
    Runtime.lookupLocal?,LocalEnv.lookup?,Frame.lookup?]
  all_goals rfl
#print axioms splitCall
end Inv45.Public
