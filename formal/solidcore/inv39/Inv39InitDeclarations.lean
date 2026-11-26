import Inv39InitLocal
import Inv39InitStores
import Inv39InitLayout
open SolidCore.Solidity.Source
namespace Inv39.Init
theorem memNone (b : State) (t : FunctionTable) (c : Context) (ty : Ty) (k : String) :
    Frame.StmtPreserves (region b) t c (.memoryVarDecl ty k none) := by
  intro n r hr; cases n with
  | zero => rw [Stmt.eval]; exact Frame.failure _
  | succ n =>
    rw [Stmt.eval]; dsimp only
    cases w:r.declareMemoryLocal ty k ty.defaultValue with
    | none => exact Frame.pureValue (P:=fun res : Result => region b res.runtime) _ hr
    | some next => exact Frame.pureValue (P:=fun res : Result => region b res.runtime) (.normal next) (memoryDecl _ _ _ _ _ _ hr w)
theorem memVar (b : State) (t : FunctionTable) (c : Context) (ty : Ty) (dst src : String) :
    Frame.StmtPreserves (region b) t c (.memoryVarDecl ty dst (some (.var src))) := by
  intro n r hr; cases n with
  | zero => rw [Stmt.eval]; exact Frame.failure _
  | succ n =>
    rw [Stmt.eval]; apply Frame.bind (Frame.caught (variableRef c r src))
    rintro (err|⟨id,val,post⟩) eq
    · exact Frame.pureValue (P:=fun res : Result => region b res.runtime) _ hr
    · change post=r at eq; subst post; cases id with
      | some i => exact Frame.pureValue (P:=fun res : Result => region b res.runtime) _ (declared _ _ _ (.memoryRef i) trivial hr)
      | none =>
        cases val with
        | some v =>
          dsimp only; cases w:r.declareMemoryLocal ty dst v <;> first
            | exact Frame.pureValue (P:=fun res : Result => region b res.runtime) (.reverted r _) hr
            | exact Frame.pureValue (P:=fun res : Result => region b res.runtime) (.normal _) (memoryDecl b r _ dst v ty hr w)
        | none =>
          dsimp only; apply Frame.bind (Frame.caught (Frame.localRead src _ c r)); rintro (err|⟨v,post⟩) eq
          · exact Frame.pureValue (P:=fun res : Result => region b res.runtime) _ hr
          · change post=r at eq; subst post; dsimp only; cases w:r.declareMemoryLocal ty dst v <;> first
              | exact Frame.pureValue (P:=fun res : Result => region b res.runtime) (.reverted r _) hr
              | exact Frame.pureValue (P:=fun res : Result => region b res.runtime) (.normal _) (memoryDecl b r _ dst v ty hr w)
theorem wordDecl (b : State) (t : FunctionTable) (c : Context) (name : String) (e : Expr) (typed : Frame.TypedRead e Frame.isWord) :
    Frame.StmtPreserves (region b) t c (.varDecl .uint256 name (some e)) := by
  intro n r hr; cases n with
  | zero => rw [Stmt.eval]; exact Frame.failure _
  | succ n =>
    rw [Stmt.eval]; apply Frame.bind (Frame.caught (typed _ c r))
    rintro (err|⟨v,mid⟩) valid
    · exact Frame.pureValue (P:=fun out : Result => region b out.runtime) _ hr
    · change mid=r ∧ Frame.isWord v at valid
      obtain ⟨rfl,w,rfl⟩ := valid
      exact Frame.pureValue (P:=fun out : Result => region b out.runtime) _ (declared _ _ name (.word w) trivial hr)
theorem scalarAssign (b : State) (t : FunctionTable) (c : Context) (k : Key) (bits : Nat) (e : Expr) (valid : Frame.ReadOnly e)
    (lookup : c.storageField? (name k)=some (field k)) : Frame.StmtPreserves (region b) t c (.assign (.storage (name k)) (.castOp .uintCleanup bits e)) := by
  apply Frame.castSet _ _ _ _ _ _ _ Frame.isWord (fun _ loc=>loc=.storageField (name k)) (Frame.cleaned valid bits)
  · intro r hr
    change Frame.Ensures (Expr.resolveLValueFuel ((Expr.storage (name k)).orderFuel+1) c r (.storage (name k))) _
    simp only [Expr.storage,Expr.resolveLValueFuel]
    exact Frame.pureValue (P:=fun q : ResolvedLValue × Runtime => q.2=r ∧ q.1=.storageField (name k)) _ ⟨rfl,rfl⟩
  · rintro r loc v next hr hv rfl ok; exact deepPut _ _ _ _ _ _ hr lookup ok
theorem packedAssign (b : State) (t : FunctionTable) (c : Context) (k : Key) (widths : List Nat) (tys : List Ty) (es : List Expr) (reads : ∀ e∈es,Frame.ReadOnly e)
    (lookup : c.storageField? (name k)=some (field k)) : Frame.StmtPreserves (region b) t c (.assign (.storage (name k)) (.encode .packed none widths tys es)) := by
  intro n r hr; cases n with
  | zero => rw [Stmt.eval]; exact Frame.failure _
  | succ n =>
    rw [Stmt.eval]; dsimp only [LValue.wantsMemoryRefRhs]
    apply Frame.bind (Frame.caught (Frame.packed _ _ _ reads _ c r))
    rintro (err|⟨v,post⟩) eq
    · exact Frame.pureValue (P:=fun out : Result => region b out.runtime) _ hr
    · change post=r at eq; subst post
      have target : (LValue.storage (name k)).resolveWithRuntime c r=pure (.storageField (name k),r) := by
        change Expr.resolveLValueFuel ((Expr.storage (name k)).orderFuel+1) c r (.storage (name k))=_
        simp only [Expr.storage,Expr.resolveLValueFuel]
      simp only [target]
      change Frame.Ensures (match (ResolvedLValue.storageField (name k)).write c r v with
        | .ok next => pure (Result.normal next) | .error err => pure (Result.reverted r err)) _
      split
      · rename_i next ok; exact Frame.pureValue (P:=fun out : Result => region b out.runtime) (.normal next) (deepPut _ _ _ _ _ _ hr lookup ok)
      · exact Frame.pureValue (P:=fun out : Result => region b out.runtime) _ hr
end Inv39.Init
