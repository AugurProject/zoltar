import Inv39SignedTerms
import Inv39Grant
open SolidCore.Solidity SolidCore.Solidity.Source Inv32Division Inv32FloorStart
namespace Inv39.Auth
theorem signedParameters (n : Nat) (c : Context) (t : FunctionTable) (rt : Runtime) (p : Payment) (tail : List Source.Stmt)
    (widths : Widths p) (seen : Seen p rt) : Stmt.evalList (n+1) t c rt (signedPrologue++tail)=Stmt.evalList (n+1) t c rt tail := by
  have sk : Stmt.eval (n+1) t c rt .skip=pure (.normal rt) := by rw [Stmt.eval]
  have value := cleanAt n 256 p.value c rt t "value" (.inr rfl) widths.value seen.value
  have early := cleanAt n 256 p.validAfter c rt t "validAfter" (.inr rfl) widths.after_ seen.after_
  have late := cleanAt n 256 p.validBefore c rt t "validBefore" (.inr rfl) widths.before_ seen.before_
  have sig := cleanAt n 8 p.v c rt t "v" (.inl rfl) widths.v seen.v
  unfold signedPrologue; simp only [List.cons_append,List.nil_append]
  rw [seqStep _ _ _ _ _ _ _ sk,seqStep _ _ _ _ _ _ _ sk,seqStep _ _ _ _ _ _ _ value,seqStep _ _ _ _ _ _ _ early,
    seqStep _ _ _ _ _ _ _ late,seqStep _ _ _ _ _ _ _ sk,seqStep _ _ _ _ _ _ _ sig,seqStep _ _ _ _ _ _ _ sk,seqStep _ _ _ _ _ _ _ sk]
theorem seenPush {p rt} (s : Seen p rt) : Seen p rt.pushScope := ⟨s.from_,s.to_,s.value,s.after_,s.before_,s.nonce,s.v,s.r,s.s⟩
theorem signedExecution (n : Nat) (c : Context) (r : Runtime) (A : Nat→Prop) (b : Balances) (p : Payment) (early late : Source.Expr) (hash sig : Source.Stmt)
    (w : Widths p) (looks : Seen p r) (safe : safeEnv r.locals) (wf : StorageMap.WF r.state.storage) (tf : StorageMap.WF r.state.transient)
    (fresh : r.state.envWorld?=none ∨ r.state.worldMutatedSinceAdoption=true)
    (S : A p.from_) (D : A p.to_) (sep : SlotSeparation A) (disjoint : Separate A (flagSlot p.from_ p.nonce)) (book : Books A r.state b) (fit : total b<R)
    (checkedEarly : pureExpr early) (checkedLate : pureExpr late) (hashOK : sigTerms (watchFlag "from") hash) (sigOK : sigTerms (watchFlag "from") sig)
    (fields : c.storageFields=model.core.context.storageFields) (events : c.eventDecls=model.core.context.eventDecls) :
    Fold.Ensures (Stmt.eval (n+17) model.core.table c r (signedInner early late hash sig))
      (normal fun q=>Moved A b p.from_ p.to_ p.value (r.state.loadSlot theoretical.slot) q.state) := by
  let t := model.core.table
  let out := r.pushScope
  let inn := out.pushScope
  let init := boundRoot inn
  let P := fun q : Runtime=>Moved A b p.from_ p.to_ p.value (r.state.loadSlot theoretical.slot) q.state
  have sk : Stmt.eval (n+16) t c out .skip=pure (.normal out) := by rw [Stmt.eval]
  unfold signedInner; apply inBlock (P:=P)
  · rw [seqStep _ _ _ _ _ _ _ sk,signedParameters (n+15) c t out p _ w (seenPush looks)]
    apply endWith; apply inBlock (P:=P)
    · apply pass (requireOnly (n+14) c t inn early _ (readSound _ checkedEarly))
      intro a eq; subst a
      apply pass (requireOnly (n+14) c t inn late _ (readSound _ checkedLate))
      intro a eq; subst a
      rw [bindThen (n+10) c inn]
      have keep (k : String) (tn : target≠k) (rn : result≠k) : init.lookupLocal? k=r.lookupLocal? k := by
        unfold init boundRoot; rw [otherDeclared _ _ _ _ tn,otherDeclared _ _ _ _ rn]; rfl
      have safety := boundSafety inn (safeCons _ _ (safeCons _ _ safe (by simp)) (by simp)) (by simp [inn,out,Runtime.pushScope])
      have check : ∀ s∈[hash,sig],guards false (watchFlag "from") t c s := by
        intro s mem; rcases List.mem_cons.mp mem with rfl|h
        · exact sigGuard _ _ _ _ hashOK
        · obtain rfl := List.mem_singleton.mp h; exact sigGuard _ _ _ _ sigOK
      apply usedFlag (P:=P) (n+14) p.from_ p.nonce c init r.state (watchFlag "from") "from" "AuthorizationUsed" [hash,sig] [motionTail.value]
        (by decide) (by decide) (by decide) check safety.1 safety.2 (justDeclared _ _ _)
        ((keep _ (by decide) (by decide)).trans looks.from_) ((keep _ (by decide) (by decide)).trans looks.nonce) (.inl rfl) fresh wf tf
      intro q flag
      have look (k : String) (wk : (watchFlag "from") k=true) (tn : target≠k) (rn : result≠k) : q.lookupLocal? k=r.lookupLocal? k :=
        (readVisible _ _ _ wk).symm.trans ((congrArg (fun ls : LocalEnv=>ls.lookup? k) flag.vars).trans ((readVisible _ _ _ wk).trans (keep _ tn rn)))
      have ⟨stored,cap⟩ := outside r.state A b _ 1 disjoint book
      have before := booksEqual flag.word stored
      have cq := (flag.word theoretical.slot).trans cap
      apply endWith; apply Fold.weaken (moved n c q A b _ _ _ ((look _ (by decide) (by decide) (by decide)).trans looks.from_)
        ((look _ (by decide) (by decide) (by decide)).trans looks.to_) ((look _ (by decide) (by decide) (by decide)).trans looks.value)
          w.from_ w.to_ w.value S D sep before fit fields events)
      intro res h; cases res with
      | normal fin=>exact ⟨h.funded,h.books,h.cap.trans cq⟩
      | _=>first | exact h | contradiction
    · exact fun _ h=>h
  · exact fun _ h=>h
end Inv39.Auth
