import Inv39ReadDomain
open SolidCore.Solidity.Source
namespace Inv39.ReadDomainEvidence
open Init (safeTemplate safeFrame safeEnv)
open Frame (StmtPreserves Ensures)
theorem boundPlain (d : BindingDecl) (v : Value) (p : String × Value) (scalarTy : Auth.scalar d.ty)
    (eq : d.bindArg? v=some p) : Init.safeTemplate p.2 := by
  unfold BindingDecl.bindArg? at eq
  cases co:d.ty.coerceValue? v with
  | some q=>simp [co] at eq; subst p; exact (Auth.coerced _ _ _ scalarTy co)
  | none=>simp [co] at eq
theorem bound (d : BindingDecl) (v : Value) (p : String × Value) (scalarTy : Auth.scalar d.ty)
    (value : Init.safeTemplate v) (eq : d.bindArgRef? v=some p) : Init.safeTemplate p.2 := by
  unfold BindingDecl.bindArgRef? at eq; split at eq
  · cases eq; exact trivial
  · contradiction
  · contradiction
  · exact boundPlain _ _ _ scalarTy eq
theorem boundAll (ds : List BindingDecl) (vs : List Value) (f : Frame) (tys : ds.all fun d=>Auth.scalar d.ty)
    (safe : ∀ v∈vs, Init.safeTemplate v) (eq : BindingDecl.bindArgsRef? ds vs=some f) : ∀ p∈f,Init.safeTemplate p.2 := by
  induction ds generalizing f vs with
  | nil=> cases vs <;> first | cases eq; simp | contradiction
  | cons d ds ih=>
    cases vs with
    | nil=>contradiction
    | cons v vs=>
      simp only [List.all_cons,Bool.and_eq_true] at tys
      rw [BindingDecl.bindArgsRef?] at eq
      cases head:d.bindArgRef? v with
      | none=>simp [head] at eq
      | some p=>
        cases tail:BindingDecl.bindArgsRef? ds vs with
        | none=>simp [head,tail] at eq
        | some f'=>
          simp [head,tail] at eq; subst f; intro x mem
          rcases List.mem_cons.mp mem with rfl|h
          · exact bound _ _ _ tys.1 (safe _ List.mem_cons_self) head
          · exact ih vs f' tys.2 (fun z hz=>safe _ (List.mem_cons_of_mem _ hz)) tail _ h

def signature (f : InternalFunction) := f.params.all (fun d => Auth.scalar d.ty) && f.returns.all Auth.returnOk
 theorem defaultSafe (d : BindingDecl) (h : Auth.returnOk d) : Init.safeTemplate d.defaultBinding.2 := by
  simp only [Auth.returnOk,Bool.and_eq_true,Bool.not_eq_true',Bool.or_eq_true] at h
  simp only [BindingDecl.defaultBinding,h.1,Bool.false_eq_true,if_false]
  rcases h.2 with scalar|bytes
  · exact Auth.defaultSafe _ scalar
  · split at bytes
    · rename_i eq; simp [eq,Ty.defaultValue,Init.safeTemplate]
    · contradiction
 theorem enterRegion (f : InternalFunction) (vs : List Value) (r start : Runtime) (saved : LocalEnv)
    (sig : signature f) (values : ∀ v∈vs,Init.safeTemplate v) (eq : internalCallEnter? f vs r=some (start,saved)) :
    region r.state start ∧ saved=r.locals := by
  simp only [signature,Bool.and_eq_true] at sig
  unfold internalCallEnter? InternalFunction.initialFrame? at eq
  cases args:BindingDecl.bindArgsRef? f.params vs with
  | none => simp [args] at eq
  | some fr =>
    simp [args] at eq; obtain ⟨rfl,rfl⟩ := eq
    refine ⟨⟨rfl,?_⟩,rfl⟩
    intro g hg; have same := List.mem_singleton.mp hg; subst g
    intro p hp; rcases List.mem_append.mp hp with hp|hp
    · exact boundAll _ _ _ sig.1 values args _ hp
    · obtain ⟨d,hd,rfl⟩ := List.mem_map.mp hp
      exact defaultSafe d (List.all_eq_true.mp sig.2 d hd)
 theorem targetsRegion (b : State) (r : Runtime) (ks : List String) (vs : List Value) (hr : region b r) :
    Ensures (internalCallAssign r ks vs) (fun res => region b res.runtime) := by
  unfold internalCallAssign; split
  · exact Frame.pureValue (P:=fun res : Result => region b res.runtime) _ hr
  · split
    · rename_i q eq; exact Frame.pureValue (P:=fun res : Result => region b res.runtime) (.normal q) (namedRef _ _ _ _ _ hr eq)
    · exact Frame.pureValue (P:=fun res : Result => region b res.runtime) _ hr
 theorem finishRegion (b : State) (r : Runtime) (f : InternalFunction) (ks : List String) (res : Result)
    (caller : Init.safeEnv r.locals) (hr : region b res.runtime) :
    Ensures (internalCallFinish f ks r.locals res) (fun out => region b out.runtime) := by
  cases res <;> simp only [internalCallFinish]
  all_goals first | exact Frame.pureValue (P:=fun res : Result => region b res.runtime) _ hr | skip
  all_goals split <;> first
    | exact targetsRegion _ _ _ _ ⟨hr.1,caller⟩
    | exact Frame.pureValue (P:=fun res : Result => region b res.runtime) _ hr
 theorem callRegion (b : State) (c : Context) (targets : List String) (key : String) (args : List Expr) (f : InternalFunction)
    (found : model.core.table.lookup? key=some f) (sig : signature f) (vars : args.all Auth.ordinaryVar)
    (body : ∀ b c,StmtPreserves (region b) model.core.table c f.body) :
    StmtPreserves (region b) model.core.table c (.internalCall targets key args) := by
  intro n r hr; cases n with
  | zero => rw [Stmt.eval]; exact Frame.failure _
  | succ n =>
    have safe : Auth.safeEnv r.locals := by
      intro fr hf p hp; exact Or.inr (hr.2 fr hf p hp)
    rw [Stmt.eval]
    apply Frame.bind (Frame.caught (Auth.refArguments _ c r args safe vars))
    rintro (err|⟨vs,q⟩) good
    · exact Frame.pureValue (P:=fun res : Result => region b res.runtime) _ hr
    · change q=r ∧ _ at good; obtain ⟨rfl,values⟩ := good
      dsimp only; rw [found]; dsimp only
      cases eq:internalCallEnter? f vs q with
      | none => exact Frame.pureValue (P:=fun res : Result => region b res.runtime) _ hr
      | some pair =>
        rcases pair with ⟨start,saved⟩
        obtain ⟨initial,rfl⟩ := enterRegion f vs q start saved sig values eq
        apply Frame.bind (body b _ n start ⟨initial.1.trans hr.1,initial.2⟩)
        intro res good; exact finishRegion b q f targets res hr.2 good
end Inv39.ReadDomainEvidence
