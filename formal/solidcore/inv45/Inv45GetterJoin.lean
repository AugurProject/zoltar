import Inv45GetterJoinShape
open SolidCore.Solidity SolidCore.Solidity.Source Inv32Division
namespace Inv45.Public
open Bytes
set_option maxHeartbeats 8000000
set_option maxRecDepth 4096
set_option linter.unusedSimpArgs false

private theorem decl (fuel : Nat) (t : FunctionTable) (c : Context) (r : Runtime)
    (ty : Source.Ty) (name : String) (e : Source.Expr) (v : Value)
    (ev : Expr.eval c r e=pure (v,r)) (co : ty.coerceValue? v=some v) :
    Stmt.eval (fuel+1) t c r (.varDecl ty name (some e))=pure (.normal (r.declareLocal name v)) := by
  rw [Stmt.eval];dsimp only;rw [ev];change (match ty.coerceValue? v with
    | some w => (pure (.normal (r.declareLocal name w)) : SolI Result)
    | none => pure (.reverted r RevertData.typeMismatch))=_
  rw [co]

-- This is the actual generated frame, including the return-buffer binding.
def joinPayout (r : Runtime) (n k : Nat) :=
  (payoutAllocated r n k).declareLocal "_ic_arg_0" (.memoryRef r.nextMemory)
def joinUnit (r : Runtime) (n k : Nat) (unit : List Nat) :=
  ((joinPayout r n k).allocMemory (.bytes unit)).1.declareLocal "_ic_arg_1" (.memoryRef (r.nextMemory+1))
def joinTicks (r : Runtime) (n k : Nat) (unit : List Nat) :=
  (joinUnit r n k unit).declareLocal "_ic_arg_2" (.word n)
def joinLow (r : Runtime) (n k : Nat) (lo : Int) (unit : List Nat) :=
  (joinTicks r n k unit).declareLocal "_ic_arg_3" (.int (Signed.word lo))
def joinArgs (r : Runtime) (n k : Nat) (lo hi : Int) (unit : List Nat) :=
  (joinLow r n k lo unit).declareLocal "_ic_arg_4" (.int (Signed.word hi))

 theorem innerJoin (fuel : Nat) (c : Context) (r base : Runtime) (q n k : Nat) (lo hi : Int) (unit : List Nat)
    (shape : r=base.declareLocal "_sol_hoist_0" (.memoryRef (r.nextMemory-1)))
    (fields : c.storageFields=model.core.storageFields)
    (look : r.lookupLocal? "questionId"=some (.word q))
    (first : r.lookupLocal? "firstPart"=some (.word (n-k)))
    (second : r.lookupLocal? "secondPart"=some (.word k))
    (outer : r.lookupLocal? "_sol_hoist_0"=some (.memoryRef (r.nextMemory-1)))
    (ticks : wordBitRange 96 120 (r.state.loadSlot (questionMemberSlot q 2))=n)
    (low : wordBitRange 0 256 (r.state.loadSlot (questionMemberSlot q 3))=Signed.word lo)
    (high : wordBitRange 0 256 (r.state.loadSlot (questionMemberSlot q 4))=Signed.word hi)
    (bytes : r.state.loadStorageBytesAt (questionMemberSlot q 5)=.ok unit)
    (N : n<2^120) (L : Signed.inRange lo) (H : Signed.inRange hi) (rise : lo<hi)
    (pos : 0<n) (valid : k≤n) (len : unit.length<R) (sane : ∀ch∈unit,ch<256)
    (cap : c.memoryAllocationLimit?=none) :
    ∃a id, id<a.nextMemory ∧ a.loadMemory? id=some (.bytes (Text.label
      (Scale.display lo (hi-lo).toNat n k) unit n (Scale.tag (hi-lo).toNat n k))) ∧
      Stmt.eval (fuel+108) model.core.table c r (.block joinInner)=
        pure (.normal ((localsOf a base).declareLocal "_sol_hoist_0" (.memoryRef id))) := by
  let t := model.core.table
  let s := r.pushScope
  let p := joinPayout s n k
  let u := joinUnit s n k unit
  let ts := joinTicks s n k unit
  let ls := joinLow s n k lo unit
  let args := joinArgs s n k lo hi unit
  let init := (allocate args []).declareLocal scalarRet (.memoryRef args.nextMemory)
  have NR : n<R := lt_trans N (by decide)
  have Q (x : Runtime) (state : x.state=r.state) (loc : x.lookupLocal? "questionId"=some (.word q)) :=
    checkedStorageExpressions c x q n lo hi unit fields loc NR L H
      (by rw [state];exact ticks) (by rw [state];exact low) (by rw [state];exact high) (by rw [state];exact bytes)
  have qU : u.lookupLocal? "questionId"=some (.word q) := by
    simpa [u,p,s,joinUnit,joinPayout,payoutAllocated,Runtime.allocMemory,Runtime.declareLocal,Runtime.pushScope,
      Runtime.lookupLocal?,LocalEnv.declare,LocalEnv.lookup?,Frame.lookup?] using look
  have qT : ts.lookupLocal? "questionId"=some (.word q) := by
    simpa [ts,joinTicks,Runtime.declareLocal,Runtime.lookupLocal?,LocalEnv.declare,LocalEnv.lookup?,Frame.lookup?] using qU
  have qL : ls.lookupLocal? "questionId"=some (.word q) := by
    simpa [ls,joinLow,Runtime.declareLocal,Runtime.lookupLocal?,LocalEnv.declare,LocalEnv.lookup?,Frame.lookup?] using qT
  have pay := payoutHoist (fuel+106) t c s n k N valid first second
  have qP : p.lookupLocal? "questionId"=some (.word q) := by
    simpa [p,s,joinPayout,payoutAllocated,Runtime.allocMemory,Runtime.declareLocal,Runtime.pushScope,
      Runtime.lookupLocal?,LocalEnv.declare,LocalEnv.lookup?,Frame.lookup?] using look
  have load := (readback c p q n lo hi unit fields ticks low high bytes).2.2.2
  have un := unitHoist (fuel+106) t c p q unit qP load
  have dT := decl (fuel+106) t c u .uint256 "_ic_arg_2" _ (.word n) (Q u rfl qU).1 rfl
  have dL := decl (fuel+106) t c ts .int256 "_ic_arg_3" _ (.int (Signed.word lo)) (Q ts rfl qT).2.1 rfl
  have dH := decl (fuel+106) t c ls .int256 "_ic_arg_4" _ (.int (Signed.word hi)) (Q ls rfl qL).2.2.1 rfl
  have blank := Bytes.blank (fuel+106) t c args scalarRet
  obtain ⟨arr,str,pb,ub⟩ := argumentMemory s n k unit
  have arrI : init.loadMemory? s.nextMemory=some (.fixedArray [.word (n-k),.word k]) :=
    ((allocated args []).memory s.nextMemory pb).trans arr
  have strI : init.loadMemory? (s.nextMemory+1)=some (.bytes unit) :=
    ((allocated args []).memory (s.nextMemory+1) ub).trans str
  obtain ⟨returned,out,kept,holds,localEq,call⟩ := Scalar.call (fuel+2) c init s.nextMemory (s.nextMemory+1) n k lo hi unit
    "_ic_arg_0" "_ic_arg_1" "_ic_arg_2" "_ic_arg_3" "_ic_arg_4" [scalarRet]
    L H rise NR pos valid arrI strI (lt_of_lt_of_le pb (allocated args []).next) (lt_of_lt_of_le ub (allocated args []).next)
    len sane cap rfl rfl rfl rfl rfl
  obtain ⟨a,id,stay,bound,cell,assignRes⟩ := captureTop returned args scalarRet args.nextMemory _ out localEq holds
  let mid := (localsOf a args).declareLocal scalarRet (.memoryRef id)
  let dst := (localsOf a base).declareLocal "_sol_hoist_0" (.memoryRef id)
  let done := dst.withFrame [(scalarRet,.memoryRef id),("_ic_arg_4",.int (Signed.word hi)),
    ("_ic_arg_3",.int (Signed.word lo)),("_ic_arg_2",.word n),("_ic_arg_1",.memoryRef (s.nextMemory+1)),("_ic_arg_0",.memoryRef s.nextMemory)]
  have captured := Inv32Internal.capture (fuel+106) t c init mid [scalarRet] _ (call.trans assignRes)
  have raw : mid.assignLocalRaw? "_sol_hoist_0" (.memoryRef id)=some done := by
    have localShape : r.locals=(base.declareLocal "_sol_hoist_0" (.memoryRef (r.nextMemory-1))).locals := congrArg Runtime.locals shape
    cases h : base.locals <;> simp [mid,done,dst,args,ls,ts,u,p,s,joinArgs,joinLow,joinTicks,joinUnit,joinPayout,
      localsOf,payoutAllocated,Runtime.allocMemory,Runtime.assignLocalRaw?,Runtime.withFrame,Runtime.pushScope,
      Runtime.declareLocal,LocalEnv.declare,LocalEnv.assign?,Frame.assign?,localShape,h,scalarRet]
  have target : mid.lookupLocal? "_sol_hoist_0"=some (.memoryRef (r.nextMemory-1)) := by
    simpa [mid,args,ls,ts,u,p,s,joinArgs,joinLow,joinTicks,joinUnit,joinPayout,localsOf,payoutAllocated,
      Runtime.allocMemory,Runtime.pushScope,Runtime.declareLocal,Runtime.lookupLocal?,LocalEnv.declare,LocalEnv.lookup?,Frame.lookup?,scalarRet] using outer
  have copy := copyRef (fuel+106) t c mid done "_sol_hoist_0" scalarRet (r.nextMemory-1) id target (declarePtr _ _ _) raw
  have run : Stmt.evalList (fuel+107) t c s joinInner=pure (.normal done) := by
    apply (Inv32FloorStart.seqStep _ _ _ _ _ _ _ pay).trans
    apply (Inv32FloorStart.seqStep _ _ _ _ _ _ _ un).trans
    apply (Inv32FloorStart.seqStep _ _ _ _ _ _ _ dT).trans
    apply (Inv32FloorStart.seqStep _ _ _ _ _ _ _ dL).trans
    apply (Inv32FloorStart.seqStep _ _ _ _ _ _ _ dH).trans
    apply (Inv32FloorStart.seqStep _ _ _ _ _ _ _ blank).trans
    apply (Inv32FloorStart.seqStep _ _ _ _ _ _ _ captured).trans
    apply (Inv32FloorStart.seqStep _ _ _ _ _ _ _ copy).trans
    rw [Stmt.evalList]
  refine ⟨a,id,bound,cell,?_⟩
  rw [Stmt.eval];dsimp only;rw [run];rfl

 theorem validSumJoin (fuel : Nat) (c : Context) (r : Runtime) (q n k : Nat) (lo hi : Int) (unit : List Nat)
    (fields : c.storageFields=model.core.storageFields)
    (look : r.lookupLocal? "questionId"=some (.word q))
    (first : r.lookupLocal? "firstPart"=some (.word (n-k)))
    (second : r.lookupLocal? "secondPart"=some (.word k))
    (ticks : wordBitRange 96 120 (r.state.loadSlot (questionMemberSlot q 2))=n)
    (low : wordBitRange 0 256 (r.state.loadSlot (questionMemberSlot q 3))=Signed.word lo)
    (high : wordBitRange 0 256 (r.state.loadSlot (questionMemberSlot q 4))=Signed.word hi)
    (bytes : r.state.loadStorageBytesAt (questionMemberSlot q 5)=.ok unit)
    (N : n<2^120) (L : Signed.inRange lo) (H : Signed.inRange hi) (rise : lo<hi)
    (pos : 0<n) (valid : k≤n) (len : unit.length<R) (sane : ∀ch∈unit,ch<256)
    (cap : c.memoryAllocationLimit?=none) :
    validSumBlock? getter.body=some joinBlock ∧
    ∃after out, Decimal.Holds after (Text.label (Scale.display lo (hi-lo).toNat n k) unit n
      (Scale.tag (hi-lo).toNat n k)) out ∧
      Stmt.eval (fuel+110) model.core.table c r joinBlock=pure (.returned after [out]) := by
  let t := model.core.table
  let base := allocate r.pushScope []
  let init := base.declareLocal "_sol_hoist_0" (.memoryRef r.nextMemory)
  have blank := Bytes.blank (fuel+108) t c r.pushScope "_sol_hoist_0"
  obtain ⟨a,id,bound,cell,inner⟩ := innerJoin (fuel+1) c init base q n k lo hi unit rfl fields
    look first second (declarePtr _ _ _) ticks low high bytes N L H rise pos valid len sane cap
  let done := (localsOf a base).declareLocal "_sol_hoist_0" (.memoryRef id)
  have ret := Bytes.retRef (fuel+108) t c done "_sol_hoist_0" id (declarePtr _ _ _)
  have run : Stmt.evalList (fuel+109) t c r.pushScope
      [.memoryVarDecl .bytesCalldata "_sol_hoist_0" none,.block joinInner,.returnValues [.var "_sol_hoist_0"]]=
      pure (.returned done [.memoryRef id]) := by
    apply (Inv32FloorStart.seqStep _ _ _ _ _ _ _ blank).trans
    apply (Inv32FloorStart.seqStep _ _ _ _ _ _ _ inner).trans
    exact Inv32FloorFastPath.stop _ _ _ _ _ _ [] _ ret
  refine ⟨exactJoinSelection,done.popScope,.memoryRef id,.ref bound cell,?_⟩
  change Stmt.eval (fuel+110) t c r (.block _)=_
  rw [Stmt.eval];dsimp only;rw [run];rfl
-- Keep the compiled canonical preparedCall certificate alongside the generated-path
-- certificate. The actual call uses Scalar.call because the generated frame reverses
-- declaration order and adds a return buffer after the two argument allocations.
 theorem preparedAndProductionJoin (fuel : Nat) (c : Context) (r : Runtime) (q n k : Nat) (lo hi : Int) (unit : List Nat)
    (fields : c.storageFields=model.core.storageFields)
    (look : r.lookupLocal? "questionId"=some (.word q))
    (first : r.lookupLocal? "firstPart"=some (.word (n-k)))
    (second : r.lookupLocal? "secondPart"=some (.word k))
    (ticks : wordBitRange 96 120 (r.state.loadSlot (questionMemberSlot q 2))=n)
    (low : wordBitRange 0 256 (r.state.loadSlot (questionMemberSlot q 3))=Signed.word lo)
    (high : wordBitRange 0 256 (r.state.loadSlot (questionMemberSlot q 4))=Signed.word hi)
    (bytes : r.state.loadStorageBytesAt (questionMemberSlot q 5)=.ok unit)
    (N : n<2^120) (L : Signed.inRange lo) (H : Signed.inRange hi) (rise : lo<hi)
    (pos : 0<n) (valid : k≤n) (len : unit.length<R) (sane : ∀ch∈unit,ch<256)
    (cap : c.memoryAllocationLimit?=none) :
    (∃after out, Bytes.Retains (argumentFrame r n k lo hi unit) after ∧
      Decimal.Holds after (Text.label (Scale.display lo (hi-lo).toNat n k) unit n
        (Scale.tag (hi-lo).toNat n k)) out ∧
      after.locals=(argumentFrame r n k lo hi unit).locals ∧
      Stmt.eval (fuel+104) model.core.table c (argumentFrame r n k lo hi unit)
        (.internalCall [scalarRet] Scalar.key scalarArgs)=internalCallAssign after [scalarRet] [out]) ∧
    validSumBlock? getter.body=some joinBlock ∧
    ∃after out, Decimal.Holds after (Text.label (Scale.display lo (hi-lo).toNat n k) unit n
      (Scale.tag (hi-lo).toNat n k)) out ∧
      Stmt.eval (fuel+110) model.core.table c r joinBlock=pure (.returned after [out]) := by
  constructor
  · exact preparedCall fuel c r n k lo hi unit [scalarRet] L H rise
      (lt_trans N (by decide)) pos valid len sane cap
  · exact validSumJoin fuel c r q n k lo hi unit fields look first second ticks low high bytes
      N L H rise pos valid len sane cap
end Inv45.Public
