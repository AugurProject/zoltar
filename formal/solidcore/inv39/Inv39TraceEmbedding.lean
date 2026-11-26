import Inv39FullPublicHistory
import Inv39Coverage
open SolidCore.Solidity SolidCore.Solidity.Source Inv32Division
namespace Inv39.TraceEmbedding
/-- Physical EVM words, stronger than HashMap well-formedness alone. No claim
that lookup normalizes an arbitrary untouched stored Nat is made. -/
structure Physical (s : State) : Prop where
  storageWF : StorageMap.WF s.storage
  transientWF : StorageMap.WF s.transient
  words : ∀ (k v : Nat), s.storage[k]? = some v → v < R

theorem Physical.loadBound {s : State} (h : Physical s) (k : Nat) : s.loadSlot k < R := by
  unfold State.loadSlot StorageMap.lookup?
  change (match s.storage[Shared.norm k]? with | some v => v | none => 0) < R
  cases eq : s.storage[Shared.norm k]? with
  | none => decide
  | some v => exact h.words _ _ eq

/-- A physical storage image has 256-bit keys and values. This is a
representation certificate, not an accounting or allowance-specific premise. -/
structure WordImage (s : State) where
  read : Fin R → Option (Fin R)
  storageWF : StorageMap.WF s.storage
  transientWF : StorageMap.WF s.transient
  represents : ∀ k : Fin R, s.storage[k.val]? = (read k).map Fin.val

theorem WordImage.physical {s : State} (image : WordImage s)
    (keys : ∀ k v : Nat, s.storage[k]?=some v → k<R) : Physical s := by
  refine ⟨image.storageWF,image.transientWF,?_⟩
  intro k v found
  have eq := image.represents ⟨k,keys k v found⟩
  rw [found] at eq
  cases h : image.read ⟨k,keys k v found⟩ with
  | none => simp [h] at eq
  | some word =>
    simp only [h,Option.map_some,Option.some.injEq] at eq
    rw [eq]; exact word.isLt

/-- Coverage is checked against the generated contract, rather than a separate
list of assumed events. Canonical Entry supplies the decoded typed shape for
mutations; no additional public mutator may be silently projected away. -/
theorem checkedCoverage (n : String) (h : n∈Coverage.publicNames) :
    n∈Coverage.mutations ∨ n∈Coverage.views := Coverage.classified n h

/-- Typed source-model entry data, without an execution result or postcondition.
Deployment supplies immutable identity; ABI/context fidelity is explicit here. -/
inductive Entry (s : State) : String → Context → List Source.Value → Type where
  | mint (caller self addr v owner : Nat) (cf : caller<R) (of : owner<R)
      (stored : s.immutable? "zoltar"=some (.word owner)) (af : addr<2^160) (vf : v<R) :
      Entry s "mint" (Child.callContext caller self) [.word addr,.word v]
  | burn (caller self addr v owner : Nat) (cf : caller<R) (of : owner<R)
      (stored : s.immutable? "zoltar"=some (.word owner)) (af : addr<2^160) (vf : v<R) :
      Entry s "burn" (Child.callContext caller self) [.word addr,.word v]
  | transfer (src dst v self : Nat) (sf : src<2^160) (df : dst<2^160) (vf : v<R) :
      Entry s "transfer" (Child.callContext src self) [.word dst,.word v]
  | transferFrom (src dst caller self v : Nat) (sf : src<2^160) (df : dst<2^160)
      (cf : caller<2^160) (vf : v<R) :
      Entry s "transferFrom" (Child.callContext caller self) [.word src,.word dst,.word v]
  | approve (caller self sp v : Nat) (cf : caller<2^160) (sf : sp<2^160) (vf : v<R) :
      Entry s "approve" (Child.callContext caller self) [.word sp,.word v]
  | cancel (c : Context) (o n v r t : Nat) (nv : c.value=0) :
      Entry s "cancelAuthorization" c (Auth.cancelArgs o n v r t)
  | permit (c : Context) (o sp v d vv r t : Nat) (ow : o<2^160) (sw : sp<2^160)
      (vf : v<R) (df : d<R) (byte : vv<256) (nv : c.value=0)
      (fields : c.storageFields=model.core.context.storageFields)
      (events : c.eventDecls=model.core.context.eventDecls) :
      Entry s "permit" c (Auth.permitArgs o sp v d vv r t)
  | signed (receive_ : Bool) (c : Context) (p : Auth.Payment) (widths : Auth.Widths p)
      (nv : c.value=0) (fields : c.storageFields=model.core.context.storageFields)
      (events : c.eventDecls=model.core.context.eventDecls) :
      Entry s (Auth.publicName receive_) c (Auth.signedArgs p)
  | init (caller self uid cap rep : Nat) :
      Entry s "initialize" (Child.callContext caller self) [.word uid,.word cap,.word rep]
  | view (name : String) (h : name∈Coverage.views) (c : Context) (args : List Source.Value) : Entry s name c args

def endpoints {s n c args} : Entry s n c args → List Nat
  | .mint _ _ a .. => [a]
  | .burn _ _ a .. => [a]
  | .transfer a b .. => [a,b]
  | .transferFrom a b .. => [a,b]
  | .signed _ _ p .. => [p.from_,p.to_]
  | _ => []

def change {s n c args} : Entry s n c args → Change
  | .mint _ _ _ v .. => .mint v
  | .burn _ _ _ v .. => .burn v
  | _ => .unchanged

def ledger {s n c args} (b : Balances) : Entry s n c args → Balances
  | .mint _ _ a v .. => setBalance a (balance a b+v) b
  | .burn _ _ a v .. => setBalance a (balance a b-v) b
  | .transfer a d v .. => move a d v b
  | .transferFrom a d _ _ v .. => move a d v b
  | .signed _ _ p .. => move p.from_ p.to_ p.value b
  | _ => b

/-- Only physical key separation remains: no Books, execution-derived guard,
event correspondence, allowance bound, or postcondition is assumed. The finite
allowance branch alone needs its write footprint separated. -/
def Separate (A : Nat → Prop) {s n c args} : Entry s n c args → Prop
  | .transferFrom a _ caller .. => s.loadSlot (Allowance.slot a caller)<R-1 →
      Allowance.Separate A a caller ∧ Init.MarkerHistory.Apart (Allowance.slot a caller)
  | .approve caller _ sp .. => Allowance.Separate A caller sp ∧ Init.MarkerHistory.Apart (Allowance.slot caller sp)
  | .cancel _ o n .. => Auth.Separate A (Auth.flagSlot o n) ∧ Init.MarkerHistory.Apart (Auth.flagSlot o n)
  | .permit _ o sp .. => Auth.Separate A (Auth.nonceSlot o) ∧ Allowance.Separate A o sp ∧
      Init.MarkerHistory.Apart (Auth.nonceSlot o) ∧ Init.MarkerHistory.Apart (Allowance.slot o sp)
  | .signed _ _ p .. => Auth.Separate A (Auth.flagSlot p.from_ p.nonce) ∧ Init.MarkerHistory.Apart (Auth.flagSlot p.from_ p.nonce)
  | _ => True

theorem successful {s n c args post out A b} (entry : Entry s n c args)
    (physical : Physical s) (seen : ∀ a∈endpoints entry, A a) (apart : Separate A entry)
    (run : TypeCheck.CheckedContract.callTargetWithContext? 50000 model (.name n) c s args = some (.returned post out)) :
    FullPublic.Step A s b (change entry) post (ledger b entry) := by
  cases entry with
  | mint caller self addr v owner cf of stored af vf =>
    exact .mutation (.mint caller self addr v post out cf owner of stored af (seen addr (by simp [endpoints])) vf run)
  | burn caller self addr v owner cf of stored af vf =>
    exact .mutation (.burn caller self addr v post out cf owner of stored af (seen addr (by simp [endpoints])) vf run)
  | transfer src dst v self sf df vf =>
    exact .mutation (.transfer src dst v self post out sf df (seen src (by simp [endpoints])) (seen dst (by simp [endpoints])) vf run)
  | transferFrom src dst caller self v sf df cf vf =>
    exact .mutation (.transferFrom src dst caller self v post out sf df cf vf (seen src (by simp [endpoints])) (seen dst (by simp [endpoints]))
      (physical.loadBound _) (fun h => (apart h).1) run (fun h => (apart h).2))
  | approve caller self sp v cf sf vf =>
    exact .mutation (.approve caller self sp v post out cf sf vf apart.1 run apart.2)
  | cancel c o n v r t nv =>
    exact .mutation (.cancelAuthorization c o n v r t post out physical.storageWF physical.transientWF nv apart.1 run apart.2)
  | permit c o sp v d vv r t ow sw vf df byte nv fields events =>
    exact .mutation (.permit c o sp v d vv r t post out ow sw vf df byte physical.storageWF physical.transientWF nv fields events apart.1 apart.2.1 run apart.2.2.1 apart.2.2.2)
  | signed receive_ c p widths nv fields events =>
    exact .mutation (.signedTransfer receive_ c p post out widths physical.storageWF physical.transientWF nv
      (seen p.from_ (by simp [endpoints])) (seen p.to_ (by simp [endpoints])) apart.1 fields events run apart.2)
  | init caller self uid cap rep => exact .repeatInitialization caller self uid cap rep post out run
  | view => exact .view _ ‹_ ∈ Coverage.views› _ _ post out run

/-- Exact decoded successful mint amount; other entries contribute zero. -/
def minted {s n c args} : Entry s n c args → Nat
  | .mint _ _ _ v .. => v
  | _ => 0

theorem minted_exact {s n c args} (e : Entry s n c args) : (change e).minted = minted e := by
  cases e <;> rfl

/-- Raw returned frames, in exact state-threaded order. No ledger or event
list is supplied by the trace producer. -/
inductive Calls : State → State → Type where
  | nil (s : State) : Calls s s
  | cons {s t u n c args out} (entry : Entry s n c args)
      (run : TypeCheck.CheckedContract.callTargetWithContext? 50000 model (.name n) c s args = some (.returned t out))
      (tail : Calls t u) : Calls s u
  | failed {s t u n c args err} (public_ : n∈Coverage.publicNames)
      (run : TypeCheck.CheckedContract.callTargetWithContext? 50000 model (.name n) c s args = some (.reverted t err))
      (tail : Calls t u) : Calls s u

def participants {s t} : Calls s t → List Nat
  | .nil _ => []
  | .cons e _ rest => endpoints e ++ participants rest
  | .failed _ _ rest => participants rest

def changes {s t} : Calls s t → List Change
  | .nil _ => []
  | .cons e _ rest => change e :: changes rest
  | .failed _ _ rest => .unchanged :: changes rest

def mintAmounts {s t} : Calls s t → List Nat
  | .nil _ => []
  | .cons e _ rest => minted e :: mintAmounts rest
  | .failed _ _ rest => 0 :: mintAmounts rest

def Admissible (A : Nat → Prop) {s t} : Calls s t → Prop
  | .nil _ => True
  | .cons e _ rest => Physical s ∧ Separate A e ∧ Admissible A rest
  | .failed _ _ rest => Admissible A rest

theorem complete {s t} (calls : Calls s t) (A : Nat → Prop)
    (seen : ∀ a∈participants calls, A a) (physical : Admissible A calls) (b : Balances) :
    ∃ fin, FullPublic.History A s b (changes calls) t fin := by
  induction calls generalizing b with
  | nil s => exact ⟨b,.nil s b⟩
  | cons e run rest ih =>
    obtain ⟨fin,hist⟩ := ih (fun a h => seen a (List.mem_append_right _ h)) physical.2.2 (ledger b e)
    exact ⟨fin,.cons (successful e physical.1 (fun a h => seen a (List.mem_append_left _ h)) physical.2.1 run) hist⟩
  | failed public_ run rest ih =>
    obtain ⟨fin,hist⟩ := ih seen physical b
    exact ⟨fin,.cons (.reverted _ public_ _ _ _ _ run) hist⟩

/-- One finite set covers every frame, including future participants. No endpoint
is removed to satisfy separation; the separation certificate uses this whole set. -/
theorem finite_complete {s t} (calls : Calls s t)
    (physical : Admissible (fun a => a ∈ participants calls) calls) (b : Balances) :
    ∃ fin, FullPublic.History (fun a => a ∈ participants calls) s b (changes calls) t fin :=
  complete calls _ (fun _ h => h) physical b

theorem trace_mints_exact {s t} (calls : Calls s t) :
    (changes calls).map Change.minted = mintAmounts calls := by
  induction calls with
  | nil => rfl
  | cons e run rest ih => simp only [changes,mintAmounts,List.map_cons,minted_exact,ih]
  | failed public_ run rest ih => simp only [changes,mintAmounts,List.map_cons,Change.minted,ih]

/-- Raw revert results are admitted, including failed initialization. -/
theorem reverted {s post A b n c args err} (public_ : n∈Coverage.publicNames)
    (run : TypeCheck.CheckedContract.callTargetWithContext? 50000 model (.name n) c s args = some (.reverted post err)) :
    FullPublic.Step A s b .unchanged post b := .reverted n public_ c args post err run

/-- Keep zero-valued successful mints, and omit every non-mint frame. -/
def mintCall {s n c args} : Entry s n c args → Option Nat
  | .mint _ _ _ v .. => some v
  | _ => none

theorem mintCall_iff {s n c args} (e : Entry s n c args) :
    (mintCall e).isSome = true ↔ n = "mint" := by
  cases e <;> simp only [mintCall,Option.isSome_some,Option.isSome_none] <;> try decide
  case signed =>
    simp [Auth.publicName]
    split <;> decide
  case view h =>
    have absent : "mint" ∉ Coverage.views := by decide
    constructor
    · intro impossible; cases impossible
    · intro eq
      exact False.elim (absent (eq ▸ h))

def successfulMints {s t} : Calls s t → List Nat
  | .nil _ => []
  | .cons e _ rest => (mintCall e).toList ++ successfulMints rest
  | .failed _ _ rest => successfulMints rest

theorem successfulMints_sum {s t} (calls : Calls s t) :
    (successfulMints calls).sum = ((changes calls).map Change.minted).sum := by
  rw [trace_mints_exact]
  induction calls with
  | nil => rfl
  | cons e run rest ih =>
    cases e <;> simp [successfulMints,mintCall,mintAmounts,minted,ih]
  | failed public_ run rest ih => simpa [successfulMints,mintAmounts] using ih

/-- Books at the end is derived from the initial physical books and raw runs.
The accounting sum is the decoded successful-mint list, not extracted events. -/
theorem accounts {s t} (calls : Calls s t) (A : Nat → Prop)
    (seen : ∀ a∈participants calls, A a) (physical : Admissible A calls)
    (sep : SlotSeparation A) (book : Books A s [])
    (fit : s.loadSlot theoretical.slot<R) (marker : BalanceApart A)
    (initialized : Shared.norm (s.loadSlot 7)≠0) :
    (∃ fin, Books A t fin) ∧
    t.loadSlot theoretical.slot-t.loadSlot circulating.slot =
      s.loadSlot theoretical.slot-(successfulMints calls).sum ∧
    (successfulMints calls).sum≤s.loadSlot theoretical.slot ∧ t.loadSlot 7=s.loadSlot 7 := by
  obtain ⟨fin,hist⟩ := complete calls A seen physical []
  have books := (FullPublic.historyAccounts hist sep book (Nat.zero_le _) fit marker initialized).2.1
  obtain ⟨eq,bound,same⟩ := FullPublic.headroom hist sep book fit marker initialized
  rw [← successfulMints_sum calls] at eq bound
  exact ⟨⟨fin,books⟩,eq,bound,same⟩

#print axioms accounts
#print axioms successfulMints_sum
#print axioms WordImage.physical
#print axioms checkedCoverage
#print axioms mintCall_iff
#print axioms complete
#print axioms finite_complete
#print axioms trace_mints_exact
#print axioms successful
#print axioms minted_exact
end Inv39.TraceEmbedding
