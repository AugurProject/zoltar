import Inv39FrameTyped
open SolidCore.Solidity.Source
namespace Inv39.Frame
theorem castSet (P : Runtime → Prop) (table : FunctionTable) (ctx : Context) (dest : LValue) (kind : CastKind) (bits : Nat) (e : Expr)
    (V : Value → Prop) (L : Runtime → ResolvedLValue → Prop)
    (rhs : TypedRead (.castOp kind bits e) V)
    (lhs : ∀ r, P r → Ensures (dest.resolveWithRuntime ctx r) (fun pair => pair.2=r ∧ L r pair.1))
    (store : ∀ r loc v out, P r → V v → L r loc → loc.write ctx r v=.ok out → P out) :
    StmtPreserves (P) table ctx (.assign dest (.castOp kind bits e)) := by
  intro n r ready
  cases n with
  | zero => rw [Stmt.eval]; exact failure _
  | succ n =>
    rw [Stmt.eval]
    dsimp only
    have evaluate : Ensures (if dest.wantsMemoryRefRhs r then (Expr.castOp kind bits e).evalMemoryRefPreserving ctx r else
          (Expr.castOp kind bits e).eval ctx r) (fun q => q.2=r ∧ V q.1) := by
      split <;> first | exact castRef rhs ctx r | exact rhs _ ctx r
    split <;> try contradiction
    apply bind (caught evaluate)
    rintro (err|⟨v,mid⟩) pred
    · exact pureValue (P:=fun out : Result => P out.runtime) _ ready
    · change mid=r ∧ V v at pred
      obtain ⟨rfl,vok⟩ := pred
      apply bind (caught (lhs _ ready))
      rintro (err|⟨loc,final⟩) pred
      · exact pureValue (P:=fun out : Result => P out.runtime) _ ready
      · change final=mid ∧ L mid loc at pred
        obtain ⟨rfl,place⟩ := pred
        dsimp only
        cases write:loc.write ctx final v with
        | error err => exact pureValue (P:=fun out : Result => P out.runtime) _ ready
        | ok out => exact pureValue (P:=fun out : Result => P out.runtime) _ (store _ _ _ _ ready vok place write)
    all_goals simp
theorem cleanSet (b : State) (t : FunctionTable) (c : Context) (name : String) (v : Expr) (bits : Nat) (h : ReadOnly v) :
    StmtPreserves (region b) t c (.assign (.var name) (.castOp .uintCleanup bits v)) := by
  apply castSet _ _ _ _ _ _ _ isWord (fun _ loc => loc=.local name) (cleaned h bits)
  · intro r ready
    apply weaken (resolveLocal _ c r name ready.2)
    intro q eq; subst q; exact ⟨rfl,rfl⟩
  · rintro r loc value out hr ⟨w,rfl⟩ rfl store
    exact storeLocal b r name (.word w) (by trivial) hr c out store
theorem indexedSet (b : State) (t : FunctionTable) (c : Context) (name : String) (idx v : Expr) (fromWidth bits : Nat)
    (key : ReadOnly idx) (h : ReadOnly v) :
    StmtPreserves (region b) t c (.assign (.index (.var name) idx) (.castOp (.fixedBytes fromWidth) bits v)) := by
  apply castSet _ _ _ _ _ _ _ (fixed bits) (fun r loc => indexTarget r name loc) (asFixed h _ _)
  · intro r hr; exact resolveIndex _ _ _ _ _ hr.2 key
  · rintro r loc value out hr ⟨w,rfl⟩ place write
    exact indexFixedWrite _ _ _ _ _ _ _ place hr c write
end Inv39.Frame
