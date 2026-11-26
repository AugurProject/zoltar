import Inv45ScalarNumeric
import Inv45Labels
open SolidCore.Solidity SolidCore.Solidity.Source Inv32Division Inv32Shapes Inv03.Bodies
namespace Inv45.Scalar
open Bytes
private def sig : List BindingDecl→List BindingDecl→Bool
  | [⟨"payoutNumerators",.fixedArray 2 .uint256,false⟩,⟨"unit",.bytesCalldata,false⟩,⟨"numTicks",.uint256,false⟩,⟨"minValue",.int256,false⟩,⟨"maxValue",.int256,false⟩],[⟨"_ret0",.bytesCalldata,false⟩]=>true
  | _,_=>false
theorem cleanSigned (fuel : Nat) (t : FunctionTable) (c : Context) (r : Runtime)
    (name : String) (v : Int) (valid : Signed.inRange v) (localV : r.lookupLocal? name=some (.int (Signed.word v)))
    (store : r.assignLocal? name (.int (Signed.word v))=some r) :
    Stmt.eval (fuel+1) t c r (.assign (.var name) (Shapes.signedCast (varP name)).value) = pure (.normal r) := by
  have notMem : (LValue.var name).wantsMemoryRefRhs r=false := by
    simp [LValue.wantsMemoryRefRhs,Runtime.lookupMemoryRef?,localV]
  have ev : Expr.eval c r (Shapes.signedCast (varP name)).value=pure (.int (Signed.word v),r) :=
    intClean (readSignedLocal _ _ _ _ localV) valid _ (by change 2≤3;decide)
  have resolved : (LValue.var name).resolveWithRuntime c r = pure (.local name,r) := by
    have noRef : r.lookupStorageBase? name=none := by simp [Runtime.lookupStorageBase?,localV]
    change Expr.resolveLValueFuel ((Expr.var name).orderFuel+1) c r (.var name) = _
    rw [Expr.resolveLValueFuel,noRef,localV]
  rw [Stmt.eval];dsimp only;rw [notMem]
  simp only [Bool.false_eq_true,if_false,ev]
  change (do
    match ← ((LValue.var name).resolveWithRuntime c r).caught with
    | .ok (target,r') => match target.write c r' (.int (Signed.word v)) with
      | .ok updated => pure (Result.normal updated)
      | .error err => pure (Result.reverted r err)
    | .error err => pure (Result.reverted r err)) = _
  rw [resolved]
  change (match (ResolvedLValue.local name).write c r (.int (Signed.word v)) with
    | .ok updated => (pure (Result.normal updated) : SolI Result)
    | .error err => pure (Result.reverted r err))=_
  have ok : (ResolvedLValue.local name).write c r (.int (Signed.word v))=.ok r := by simp [ResolvedLValue.write,store]
  rw [ok]

theorem signature : fn.params=[⟨"payoutNumerators",.fixedArray 2 .uint256,false⟩,⟨"unit",.bytesCalldata,false⟩,⟨"numTicks",.uint256,false⟩,⟨"minValue",.int256,false⟩,⟨"maxValue",.int256,false⟩] ∧ fn.returns=[⟨"_ret0",.bytesCalldata,false⟩] := by
  have h : sig fn.params fn.returns := by native_decide
  generalize fn.params=ps at *;generalize fn.returns=rs at *
  unfold sig at h;split at h <;> simp_all
theorem execution (fuel : Nat) (c : Context) (r : Runtime) (pid uid n k : Nat) (lo hi : Int) (unit : List Nat)
    (L : Signed.inRange lo) (H : Signed.inRange hi) (rise : lo<hi) (N : n<R) (pos : 0<n) (valid : k≤n)
    (array : r.loadMemory? pid=some (.fixedArray [.word (n-k),.word k])) (str : r.loadMemory? uid=some (.bytes unit))
    (pbound : pid<r.nextMemory) (bound : uid<r.nextMemory) (len : unit.length<R) (sane : ∀ch∈unit,ch<256) (cap : c.memoryAllocationLimit?=none) :
    ∃after out, Retains r after ∧ Decimal.Holds after (Text.label (Scale.display lo (hi-lo).toNat n k) unit n (Scale.tag (hi-lo).toNat n k)) out ∧
      Stmt.eval (fuel+103) model.core.table c (entry r pid uid n lo hi (.bytes [])) fn.body=pure (.returned after [out]) := by
  let t := model.core.table
  let s := entry r pid uid n lo hi (.bytes [])
  let a := allocate r []
  let prepared := entry a pid uid n lo hi (.memoryRef r.nextMemory)
  have lp : Stmt.eval (fuel+102) t c s.pushScope locPayout.value=pure (.normal s.pushScope) := by
    change Stmt.eval _ _ _ _ (.memoryLocalize _ _)=_;rw [Stmt.eval];rfl
  have lu : Stmt.eval (fuel+102) t c s.pushScope (localize "unit").value=pure (.normal s.pushScope) := by
    change Stmt.eval _ _ _ _ (.memoryLocalize _ _)=_;rw [Stmt.eval];rfl
  have cn := Inv32FloorFastPath.cleanParamExec (fuel+101) t c s.pushScope "numTicks" n N rfl
    (by simp [s,entry,Runtime.assignLocal?,Runtime.lookupLocal?,Runtime.withFrame,Runtime.pushScope,
      LocalEnv.assign?,LocalEnv.lookup?,Frame.lookup?,Frame.assign?,Value.coerceLike?])
  have cl := cleanSigned (fuel+101) t c s.pushScope "minValue" lo L rfl
    (by simp [s,entry,Runtime.assignLocal?,Runtime.assignLocalRaw?,Runtime.lookupLocal?,Runtime.withFrame,Runtime.pushScope,
      LocalEnv.assign?,LocalEnv.lookup?,Frame.lookup?,Frame.assign?,Value.coerceLike?,Nat.mod_eq_of_lt (Signed.wordFit lo L)])
  have ch : Stmt.eval (fuel+102) t c s.pushScope (Inv03.Bodies.assign "maxValue" (sVar "maxValue")).value=pure (.normal s.pushScope) := by
    exact cleanSigned (fuel+101) t c s.pushScope "maxValue" hi H rfl
      (by simp [s,entry,Runtime.assignLocal?,Runtime.assignLocalRaw?,Runtime.lookupLocal?,Runtime.withFrame,Runtime.pushScope,
        LocalEnv.assign?,LocalEnv.lookup?,Frame.lookup?,Frame.assign?,Value.coerceLike?,Nat.mod_eq_of_lt (Signed.wordFit hi H)])
  have loc : Stmt.eval (fuel+102) t c s.pushScope Decimal.initRet.value=pure (.normal prepared.pushScope) := by
    change Stmt.eval _ _ _ _ (.memoryLocalize .bytesCalldata "_ret0")=_;rw [Stmt.eval];rfl
  obtain ⟨after,id,keep,ib,cell,run⟩ := runData (fuel+1) c a pid uid r.nextMemory n k lo hi unit L H rise N pos valid
    (((allocated r []).memory pid pbound).trans array) (((allocated r []).memory uid bound).trans str) (lt_of_lt_of_le bound (allocated r []).next) len sane cap
  have inner := Inv32FloorFastPath.blockReturned (fuel+101) t c prepared.pushScope after _ [.memoryRef id] run
  have stable := Bytes.trans (allocated r []) keep
  refine ⟨after.popScope.popScope,.memoryRef id,⟨stable.state,stable.next,stable.memory⟩,.ref ib cell,?_⟩
  rw [source]
  apply Inv32FloorFastPath.blockReturned (fuel+102) t c s after.popScope _
  apply (Inv32FloorStart.seqStep _ _ _ _ _ _ _ lp).trans
  apply (Inv32FloorStart.seqStep _ _ _ _ _ _ _ lu).trans
  apply (Inv32FloorStart.seqStep _ _ _ _ _ _ _ cn).trans
  apply (Inv32FloorStart.seqStep _ _ _ _ _ _ _ cl).trans
  apply (Inv32FloorStart.seqStep _ _ _ _ _ _ _ ch).trans
  apply (Inv32FloorStart.seqStep _ _ _ _ _ _ _ loc).trans
  exact Inv32FloorFastPath.stop _ _ _ _ _ _ [] _ inner
theorem call (fuel : Nat) (c : Context) (r : Runtime) (pid uid n k : Nat) (lo hi : Int) (unit : List Nat)
    (p u ticks low high : String) (targets : List String)
    (L : Signed.inRange lo) (H : Signed.inRange hi) (rise : lo<hi) (N : n<R) (pos : 0<n) (valid : k≤n)
    (array : r.loadMemory? pid=some (.fixedArray [.word (n-k),.word k])) (str : r.loadMemory? uid=some (.bytes unit))
    (pbound : pid<r.nextMemory) (bound : uid<r.nextMemory) (len : unit.length<R) (sane : ∀ch∈unit,ch<256) (cap : c.memoryAllocationLimit?=none)
    (P : r.lookupLocal? p=some (.memoryRef pid)) (U : r.lookupLocal? u=some (.memoryRef uid))
    (T : r.lookupLocal? ticks=some (.word n)) (Low : r.lookupLocal? low=some (.int (Signed.word lo)))
    (High : r.lookupLocal? high=some (.int (Signed.word hi))) :
    ∃after out, Retains r after ∧ Decimal.Holds after (Text.label (Scale.display lo (hi-lo).toNat n k) unit n (Scale.tag (hi-lo).toNat n k)) out ∧ after.locals=r.locals ∧
      Stmt.eval (fuel+104) model.core.table c r (.internalCall targets key [.var p,.var u,.var ticks,.var low,.var high])=internalCallAssign after targets [out] := by
  let empty := {r with locals:=[]}
  have found : model.core.table.lookup? key=some fn := (Option.some_get present).symm
  have refP : Expr.evalRefArg c r (.var p)=pure (.memoryRef pid,r) := by simp [Expr.evalRefArg,Runtime.lookupMemoryRef?,Runtime.lookupStorageBase?,P]
  have refU : Expr.evalRefArg c r (.var u)=pure (.memoryRef uid,r) := by simp [Expr.evalRefArg,Runtime.lookupMemoryRef?,Runtime.lookupStorageBase?,U]
  have signedArg (name : String) (v : Int) (loc : r.lookupLocal? name=some (.int (Signed.word v))) :
      Expr.evalRefArg c r (.var name)=pure (.int (Signed.word v),r) := by
    simp only [Expr.evalRefArg,Runtime.lookupMemoryRef?,Runtime.lookupStorageBase?,loc]
    exact readSignedLocal _ _ _ _ loc _ (Nat.le_succ _)
  have args : Expr.evalRefArgList c r [.var p,.var u,.var ticks,.var low,.var high]=
      pure ([.memoryRef pid,.memoryRef uid,.word n,.int (Signed.word lo),.int (Signed.word hi)],r) := by
    change Expr.evalRefArgListFuel (_+1) c r [.var p,.var u,.var ticks,.var low,.var high]=_
    simp only [Expr.orderFuel,Expr.listEvalFuel,Nat.reduceAdd,Expr.evalRefArgListFuel,refP,refU,
      Inv32ProductCall.wordArg _ _ _ _ T,signedArg _ _ Low,signedArg _ _ High,Inv08.Authority.bindPure]
  obtain ⟨ps,rs⟩ := signature
  have enter : internalCallEnter? fn [.memoryRef pid,.memoryRef uid,.word n,.int (Signed.word lo),.int (Signed.word hi)] r=
      some (entry empty pid uid n lo hi (.bytes []),r.locals) := by
    unfold internalCallEnter? InternalFunction.initialFrame? InternalFunction.returnDefaultBindings
    rw [ps,rs];simp [BindingDecl.bindArgsRef?,BindingDecl.bindArgRef?,BindingDecl.bindArg?,BindingDecl.defaultBinding,
      Ty.coerceValue?,Ty.defaultValue,entry,empty,Runtime.withFrame]
  obtain ⟨done,out,keep,holds,ev⟩ := execution fuel {c with checked:=true} empty pid uid n k lo hi unit L H rise N pos valid array str pbound bound len sane cap
  let after := {done with locals:=r.locals}
  refine ⟨after,out,⟨keep.state,keep.next,keep.memory⟩,?_,rfl,?_⟩
  · cases holds with | direct=>exact .direct | ref b h=>exact .ref b h
  · rw [Inv32Internal.call _ _ _ _ _ _ _ _ _ _ _ _ _ args found enter ev]
    cases holds with
    | direct => simp [internalCallFinish,rs,coerceReturnBindingsRef,coerceReturnBindingsRef.coerce,Runtime.derefMemoryValueDeep,
        Runtime.derefMemoryValueWithFuel,Ty.coerceValue?,Bind.bind,Except.bind,after]
    | ref b h => simp [internalCallFinish,rs,coerceReturnBindingsRef,coerceReturnBindingsRef.coerce,Bind.bind,Except.bind,after]
end Inv45.Scalar
