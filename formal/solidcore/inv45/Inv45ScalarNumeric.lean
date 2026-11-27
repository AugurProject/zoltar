import Inv45SignedHoist
open SolidCore.Solidity SolidCore.Solidity.Source Inv32Division Inv32Shapes Inv03.Bodies
namespace Inv45.Scalar
open Bytes
def entry (r : Runtime) (pid uid n : Nat) (lo hi : Int) (ret : Value) := r.withFrame [
  ("payoutNumerators",.memoryRef pid),("unit",.memoryRef uid),("numTicks",.word n),("minValue",.int (Signed.word lo)),
  ("maxValue",.int (Signed.word hi)),("_ret0",ret)]
theorem setDiff (fuel : Nat) (t : FunctionTable) (c : Context) (r : Runtime) (lo hi : Int)
    (L : Signed.inRange lo) (H : Signed.inRange hi) (rise : lo<hi)
    (low : r.lookupLocal? "minValue"=some (.int (Signed.word lo))) (high : r.lookupLocal? "maxValue"=some (.int (Signed.word hi))) :
    Stmt.eval (fuel+3) t c (r.declareLocal "diffU" (.word 0)) diff.value=
      pure (.normal (r.declareLocal "diffU" (.word (hi-lo).toNat))) := by
  let s := r.declareLocal "diffU" (.word 0)
  let dst := r.declareLocal "diffU" (.word (hi-lo).toNat)
  let ctx := {c with checked:=false}
  have ev : Expr.eval ctx s.pushScope rawDiff.value=pure (.word (hi-lo).toNat,s.pushScope) :=
    deltaRead c s.pushScope lo hi L H rise (by simpa [s,pushLookup,declLookup] using low)
      (by simpa [s,pushLookup,declLookup] using high) _ (by decide)
  have ptr : s.pushScope.lookupLocal? "diffU"=some (.word 0) := lookupHere _ _ _
  have notMem : (LValue.var "diffU").wantsMemoryRefRhs s.pushScope=false := by simp [LValue.wantsMemoryRefRhs,Runtime.lookupMemoryRef?,ptr]
  have write : (ResolvedLValue.local "diffU").write ctx s.pushScope (.word (hi-lo).toNat)=.ok dst.pushScope := by
    cases F : r.locals <;> simp [ResolvedLValue.write,s,dst,Runtime.assignLocal?,Runtime.declareLocal,Runtime.pushScope,Runtime.lookupLocal?,
      LocalEnv.declare,LocalEnv.assign?,LocalEnv.lookup?,Frame.lookup?,Frame.assign?,Value.coerceLike?,F]
  have body : Stmt.eval (fuel+1) t ctx s.pushScope (Inv03.Bodies.assign "diffU" rawDiff).value=pure (.normal dst.pushScope) := by
    change Stmt.eval _ _ _ _ (.assign (.var "diffU") (.castOp .uintCleanup 256 _))=_
    rw [Stmt.eval];dsimp only;rw [notMem];simp only [Bool.false_eq_true,if_false]
    change (do match ← (Expr.eval ctx s.pushScope rawDiff.value).caught with
      | .ok (v,s')=>do match ← ((LValue.var "diffU").resolveWithRuntime ctx s').caught with
                        | .ok (dst,u)=>match dst.write ctx u v with | .ok z=>pure (Result.normal z) | .error e=>pure (Result.reverted s.pushScope e)
                        | .error e=>pure (Result.reverted s.pushScope e)
      | .error e=>pure (Result.reverted s.pushScope e))=_
    rw [ev];change (do match ← ((LValue.var "diffU").resolveWithRuntime ctx s.pushScope).caught with
      | .ok (dst,u)=>match dst.write ctx u (.word (hi-lo).toNat) with | .ok z=>pure (Result.normal z) | .error e=>pure (Result.reverted s.pushScope e)
      | .error e=>pure (Result.reverted s.pushScope e))=_
    rw [Inv32Writes.resolve _ _ _ _ ptr]
    change (match (ResolvedLValue.local "diffU").write ctx s.pushScope (.word (hi-lo).toNat) with
      | .ok z=>(pure (.normal z) : SolI Result) | .error e=>pure (.reverted s.pushScope e))=_
    rw [write]
  change Stmt.eval _ _ _ _ (.unchecked (.block [_]))=_;rw [Stmt.eval]
  exact Inv32Blocks.one _ _ _ s dst.pushScope _ body
theorem runData (fuel : Nat) (c : Context) (r : Runtime) (pid uid retId n k : Nat) (lo hi : Int) (unit : List Nat)
    (L : Signed.inRange lo) (H : Signed.inRange hi) (rise : lo<hi) (N : n<R) (pos : 0<n) (valid : k≤n)
    (array : r.loadMemory? pid=some (.fixedArray [.word (n-k),.word k])) (str : r.loadMemory? uid=some (.bytes unit))
    (bound : uid<r.nextMemory) (len : unit.length<R) (sane : ∀ch∈unit,ch<256) (cap : c.memoryAllocationLimit?=none) :
    let d := (hi-lo).toNat
    ∃after id, Retains r after ∧ id<after.nextMemory ∧ after.loadMemory? id=some (.bytes (Text.label (Scale.display lo d n k) unit n (Scale.tag d n k))) ∧
      Stmt.evalList (fuel+100) model.core.table c (entry r pid uid n lo hi (.memoryRef retId)).pushScope.pushScope
        ((numericSteps++textSteps).map Pattern.value)=pure (.returned after [.memoryRef id]) := by
  let t := model.core.table
  let s := (entry r pid uid n lo hi (.memoryRef retId)).pushScope.pushScope
  let d := (hi-lo).toNat
  let value := Scale.display lo d n k
  let q := k*d/n
  let a := s.declareLocal "payout" (.word k)
  let b := a.declareLocal "diffU" (.word d)
  let m := b.declareLocal Format.temp0 (.word q)
  let u := m.declareLocal "scalarValueU" (.word q)
  let z := u.declareLocal Format.temp0 (.int (Signed.word value))
  let f := z.declareLocal "scalarValue" (.int (Signed.word value))
  have K : k<R := lt_of_le_of_lt valid N
  have D : d<R := (Scale.distance lo hi L H rise).2.1
  obtain ⟨Q,V⟩ := Scale.bounds lo hi n k L H rise pos valid
  have tickTest := MulDiv.gtRead (x:=wvar "numTicks") (y:=num 0) (MulDiv.wordVar c s "numTicks" n N rfl) (Inv08.Authority.literal c s 0 (by decide)) N (by decide) pos
  have checkT := MulDiv.guardYes (fuel+99) t (test:=Expr_binary BinaryOp_gt (wvar "numTicks") (num 0)) (msg:="Scalar question numTicks must be positive") tickTest
  have checkR := MulDiv.guardYes (fuel+99) t (test:=Expr_binary BinaryOp_gt (sVar "maxValue") (sVar "minValue"))
    (msg:="Scalar question display max must be greater than display min") (greater c s lo hi L H rise rfl rfl)
  have get := payoutDecl (fuel+99) t c s pid (n-k) k rfl array K
  have initD := Inv32FloorStart.zero (fuel+99) t c a "diffU"
  have sub := setDiff (fuel+97) t c a lo hi L H rise rfl rfl
  have initM := Inv32FloorStart.zero (fuel+99) t c b Format.temp0
  have mult := mulHoist (fuel+89) c b k d n K D N pos Q rfl rfl rfl
  have quotient := Add.declareWord (fuel+99) t "scalarValueU" (MulDiv.wordVar c m Format.temp0 q Q rfl)
  have initS : Stmt.eval (fuel+100) t c u (sint Format.temp0 Option_none).value=pure (.normal (u.declareLocal Format.temp0 (.int 0))) := by
    change Stmt.eval _ _ _ _ (.varDecl .int256 Format.temp0 none)=_;rw [Stmt.eval];simp [Ty.defaultValue]
  have sum := addHoist (fuel+85) c u lo q L Q V rfl rfl
  have decl := Add.declareSigned (fuel+99) t "scalarValue" (e:=sVar Format.temp0) (intClean (readSignedLocal c z Format.temp0 _ rfl) V)
  obtain ⟨after,id,keep,bound,cell,run⟩ := textRun fuel c f value k d n uid unit V K D N pos len sane ⟨rfl,str⟩ bound rfl rfl rfl rfl cap
  refine ⟨after,id,⟨keep.state,keep.next,keep.memory⟩,bound,cell,?_⟩
  apply (Inv32FloorStart.seqStep _ _ _ _ _ _ _ checkT).trans
  apply (Inv32FloorStart.seqStep _ _ _ _ _ _ _ checkR).trans
  apply (Inv32FloorStart.seqStep _ _ _ _ _ _ _ get).trans
  apply (Inv32FloorStart.seqStep _ _ _ _ _ _ _ initD).trans
  apply (Inv32FloorStart.seqStep _ _ _ _ _ _ _ sub).trans
  apply (Inv32FloorStart.seqStep _ _ _ _ _ _ _ initM).trans
  apply (Inv32FloorStart.seqStep _ _ _ _ _ _ _ mult).trans
  apply (Inv32FloorStart.seqStep _ _ _ _ _ _ _ quotient).trans
  apply (Inv32FloorStart.seqStep _ _ _ _ _ _ _ initS).trans
  apply (Inv32FloorStart.seqStep _ _ _ _ _ _ _ sum).trans
  apply (Inv32FloorStart.seqStep _ _ _ _ _ _ _ decl).trans
  exact run
end Inv45.Scalar
