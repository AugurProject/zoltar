import Inv39FrameNumeric
open SolidCore.Solidity.Source
namespace Inv39.Frame
def bareContainer : Value → Prop | .word _ | .bytes _ => True | _ => False
def indexTarget (r : Runtime) (name : String) (place : ResolvedLValue) : Prop :=
  (∃ id i, place=.valueIndex (.memoryCell id) i) ∨
  (∃ v i, r.lookupLocal? name=some v ∧ bareContainer v ∧ place=.valueIndex (.local name) i)
theorem resolveIndex (n : Nat) (c : Context) (r : Runtime) (k : String) (idx : Expr) (good : plainEnv r.locals) (reads : ReadOnly idx) :
    Ensures (Expr.resolveLValueFuel n c r (.index (.var k) idx)) (fun q => q.2=r ∧ indexTarget r k q.1) := by
  cases n with
  | zero => rw [Expr.resolveLValueFuel]; exact failure _
  | succ n =>
    rw [Expr.resolveLValueFuel]
    apply bind (resolveLocal n c r k good)
    intro pair eq; subst pair
    apply bind (reads n c r)
    rintro ⟨v,mid⟩ eq; change mid=r at eq; subst mid
    dsimp only
    apply liftExcept; intro i
    apply lifted; intro raw seen
    simp only [ResolvedLValue.readRaw] at seen
    cases known:r.lookupLocal? k with
    | none => simp [known] at seen
    | some w =>
      simp [known] at seen; subst raw
      have safe := envLookup _ _ _ good known
      cases w <;> first | contradiction | skip
      all_goals apply pureValue (P:=fun q : ResolvedLValue × Runtime => q.2=r ∧ indexTarget r k q.1)
      all_goals exact ⟨rfl,by first | left; exact ⟨_,_,rfl⟩ | right; exact ⟨_,_,known,trivial,rfl⟩⟩
theorem bytesResult (bs : List Byte) (i : Nat) (v w : Value) (ok : (Value.bytes bs).setIndex? i v=.ok w) : ∃ bs', w=.bytes bs' := by
  simp only [Value.setIndex?] at ok
  split at ok <;> try contradiction
  split at ok <;> first | cases ok; exact ⟨_,rfl⟩ | contradiction
theorem indexFixedWrite (b : State) (r next : Runtime) (name : String) (target : ResolvedLValue) (width word : Nat)
    (place : indexTarget r name target) (before : region b r) (c : Context)
    (write : target.write c r (.fixedBytes width word)=.ok next) : region b next := by
  rcases place with ⟨id,i,rfl⟩|⟨v,i,lookup,kind,rfl⟩
  · simp only [ResolvedLValue.write] at write
    cases raw:(ResolvedLValue.memoryCell id).read c r <;> simp [raw,Bind.bind,Except.bind] at write
    rename_i v
    cases val:r.derefMemoryValue v <;> simp [val] at write
    rename_i a
    cases put:a.setIndex? i (.fixedBytes width word) <;> simp [Runtime.memoryStoreValue,Value.isMemoryObject,put] at write
    rename_i x
    simp only [ResolvedLValue.writeContainer] at write
    split at write
    · rename_i mid stored; cases write; exact memoryCell _ _ _ _ _ before stored
    · contradiction
  · have simple : r.lookupMemoryRef? name=none := by
      cases v <;> first | contradiction | simp [Runtime.lookupMemoryRef?,lookup]
    cases v <;> first | contradiction | skip
    all_goals
      simp [ResolvedLValue.write,ResolvedLValue.read,ResolvedLValue.readRaw,lookup,Runtime.derefMemoryValue,
        Runtime.memoryStoreValue,Value.isMemoryObject,Bind.bind,Except.bind] at write
    case word => contradiction
    case bytes bs =>
      cases got:(Value.bytes bs).setIndex? i (.fixedBytes width word) with
      | error e => simp [got] at write
      | ok updated =>
        obtain ⟨bs',eq⟩ := bytesResult _ _ _ _ got; subst updated
        simp only [got,ResolvedLValue.writeContainer,simple] at write
        split at write
        · rename_i mid stored; cases write; exact localAssigned b r _ name (.bytes bs') trivial before stored
        · contradiction
end Inv39.Frame
