import Inv39AuthSeq
open SolidCore.Solidity SolidCore.Solidity.Source Inv32Division
namespace Inv39.Auth
theorem frameSelf (f : Frame) (k : String) (v : Source.Value) (ref : f.lookup? k=some v) : f.assign? k v=some f := by
  induction f with
  | nil=>contradiction
  | cons p f ih=>
    rcases p with ⟨n,w⟩
    by_cases eq:n=k
    · subst n; simp [Frame.lookup?] at ref; subst w; simp [Frame.assign?]
    · simp [Frame.lookup?,eq] at ref; simp [Frame.assign?,eq,ih ref]
theorem envSelf (ls : LocalEnv) (k : String) (v : Source.Value) (ref : ls.lookup? k=some v) : ls.assign? k v=some ls := by
  induction ls with
  | nil=>contradiction
  | cons f tail ih=>
    rw [LocalEnv.lookup?] at ref; rw [LocalEnv.assign?]
    cases known:f.lookup? k with
    | some val=>simp [known] at ref; subst val; rw [frameSelf f k v known]
    | none=>
      have absent : f.assign? k v=none := by
        clear ref ih
        induction f with
        | nil=>rfl
        | cons p rest hi=>
          rcases p with ⟨n,x⟩
          by_cases eq:n=k
          · simp [Frame.lookup?,eq] at known
          · simp [Frame.lookup?,eq] at known; simp [Frame.assign?,eq,hi known]
      simp [absent,ih (by simpa [known] using ref)]
theorem sameParam (r : Runtime) (k : String) (v : Nat) (ref : r.lookupLocal? k=some (.word v)) : r.assignLocal? k (.word v)=some r := by
  have self := envSelf r.locals k (.word v) ref
  simp [Runtime.assignLocal?,ref,Value.coerceLike?,self]
def clean (bits : Nat) (k : String) := Stmt.assign (.var k) (.castOp .uintCleanup bits (.var k))
def narrowOK (bits : Nat) := bits=8 ∨ bits=256
theorem cleanAt (n bits v : Nat) (c : Context) (r : Runtime) (t : FunctionTable) (k : String)
    (supported : narrowOK bits) (valid : v<2^bits) (look : r.lookupLocal? k=some (.word v)) :
    Stmt.eval (n+1) t c r (clean bits k)=pure (.normal r) := by
  rcases supported with rfl|rfl
  · have fit : v<R := lt_trans valid (by decide)
    have value : uintCleanup? c.checked 8 (.word v)=.ok (.word v) := by
      have norm : Shared.norm v=v := Nat.mod_eq_of_lt fit
      norm_num at valid
      simp [uintCleanup?,uintCast?,Value.forceAbiLazy,Value.asStorageWord?,norm,Nat.not_le_of_gt valid,Nat.mod_eq_of_lt valid,Bind.bind,Except.bind]
    apply Inv32Assign.scalarCast _ _ _ _ _ _ _ _ _ _ _ look _ (sameParam r k v look)
    change Expr.evalFuel 3 c r (.castOp .uintCleanup 8 (.var k))=_
    rw [Expr.evalFuel,Inv32Guards.readWord _ _ _ _ _ look]; change (liftM (uintCleanup? c.checked 8 (.word v)) : SolI Source.Value) >>= _ = _
    rw [value]; rfl
  · exact Inv32FloorFastPath.cleanParamExec _ _ _ _ _ _ valid look (sameParam r k v look)
end Inv39.Auth
