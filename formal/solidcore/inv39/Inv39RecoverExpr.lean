import Inv39AuthReads
import Inv39Fold
open SolidCore.Solidity SolidCore.Solidity.Source
namespace Inv39.Auth
def digest (a b r s : String) : Source.Expr := .ecrecover (.var a) (.var b) (.var r) (.var s)
theorem lifted (e : Except RevertData α) (k : α → SolI β) (P : β → Prop) (h : ∀ x,Fold.Ensures (k x) P) :
    Fold.Ensures ((liftM e : SolI α) >>= k) P := by cases e with | error err=>exact Fold.reject _ _ | ok x=>exact h x
theorem recoverRead (a b l s : String) (n : Nat) (c : Context) (r : Runtime) :
    Fold.Ensures ((digest a b l s).evalFuel n c r)
      (fun q => q.2.locals=r.locals ∧ Fold.echo c r.state q.2.state ∧ ∃ w,q.1=.word w) := by
  cases n with
  | zero => rw [Expr.evalFuel]; exact Fold.reject _ _
  | succ n =>
    unfold digest; rw [Expr.evalFuel]
    let es := [Source.Expr.var a,.var b,.var l,.var s]
    have reads : ∀ e∈es,Frame.ReadOnly e := by intro e mem; simp only [es,List.mem_cons,List.not_mem_nil,or_false] at mem; rcases mem with h|h|h|h <;> subst e <;> apply Frame.localRead
    apply Fold.bind (Q:=fun q : Source.Value × Runtime=>q.2.locals=r.locals ∧ Fold.echo c r.state q.2.state ∧ ∃ w,q.1=.word w) (Fold.fromFrame (Frame.inputs es reads n c r))
    rintro ⟨vs,mid⟩ eq; change mid=r at eq; subst mid
    dsimp only; split
    · apply lifted; intro d; apply lifted; intro v; apply lifted; intro l'; apply lifted; intro s'
      let data := Shared.Precompile.ecrecoverInput d v l' s'
      have echo : Fold.Ensures (emitPrecompileWord c r.state .ecrecover data) (fun pair=>Fold.echo c r.state pair.2) := by
        unfold Fold.Ensures; rintro ⟨o,t⟩ run; exact .inr (PrecompileEcho.resultState _ _ _ _ _ _ run)
      apply Fold.bind (Q:=fun q : Source.Value × Runtime=> q.2.locals=r.locals ∧ Fold.echo c r.state q.2.state ∧ ∃ w,q.1=.word w) echo
      rintro ⟨o,t⟩ ok; exact Fold.pureValue (Source.Value.word (o.getD 0),{r with state:=t}) (fun q : Source.Value × Runtime=>q.2.locals=r.locals ∧ Fold.echo c r.state q.2.state ∧ ∃ w,q.1=.word w) ⟨rfl,ok,_,rfl⟩
    · exact Fold.reject _ _
end Inv39.Auth
