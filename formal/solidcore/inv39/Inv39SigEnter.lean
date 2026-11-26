import Inv39SigArguments
open SolidCore.Solidity.Source
namespace Inv39.Auth
theorem boundPlain (d : BindingDecl) (v : Value) (p : String × Value) (scalarTy : scalar d.ty)
    (eq : d.bindArg? v=some p) : permitted p := by
  unfold BindingDecl.bindArg? at eq
  cases co:d.ty.coerceValue? v with
  | some q=>simp [co] at eq; subst p; exact .inr (coerced _ _ _ scalarTy co)
  | none=>simp [co] at eq
theorem bound (d : BindingDecl) (v : Value) (p : String × Value) (scalarTy : scalar d.ty)
    (value : Init.safeTemplate v) (eq : d.bindArgRef? v=some p) : permitted p := by
  unfold BindingDecl.bindArgRef? at eq; split at eq
  · cases eq; exact .inr trivial
  · contradiction
  · contradiction
  · exact boundPlain _ _ _ scalarTy eq
theorem boundAll (ds : List BindingDecl) (vs : List Value) (f : Frame) (tys : ds.all fun d=>scalar d.ty)
    (safe : ∀ v∈vs, Init.safeTemplate v) (eq : BindingDecl.bindArgsRef? ds vs=some f) : ∀ p∈f,permitted p := by
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

theorem enters (fn : InternalFunction) (vs : List Value) (r first : Runtime) (saved : LocalEnv)
    (params : fn.params.all fun d=>scalar d.ty) (rets : ∀ d∈fn.returns,permitted d.defaultBinding)
    (safe : ∀ v∈vs,Init.safeTemplate v) (eq : internalCallEnter? fn vs r=some (first,saved)) :
    safeEnv first.locals ∧ first.locals≠[] ∧ first.state=r.state ∧ saved=r.locals := by
  unfold internalCallEnter? InternalFunction.initialFrame? at eq
  cases args:BindingDecl.bindArgsRef? fn.params vs with
  | none=>simp [args] at eq
  | some f=>
    simp [args] at eq; obtain ⟨rfl,rfl⟩ := eq
    refine ⟨safeCons [] _ (by simp [safeEnv]) ?_,by simp,rfl,rfl⟩
    intro p mem; rcases List.mem_append.mp mem with h|h
    · exact boundAll _ _ _ params safe args _ h
    · obtain ⟨d,hd,rfl⟩ := List.mem_map.mp h; exact rets _ hd
end Inv39.Auth
