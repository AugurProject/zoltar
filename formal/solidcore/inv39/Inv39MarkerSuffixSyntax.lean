import Inv39MarkerSuffixCertificate
open SolidCore.Solidity SolidCore.Solidity.Source
namespace Inv39.Init.Marker.ActualSuffix
/-- The suffix is extracted after the actual generated REP store. -/
theorem source : ∃ f a b c d,
    model.core.findFunctionByName? "initialize"=some f ∧
    f.body=Repeat.body (a::repGuard::b::c::d::repStore::value) := by
  obtain ⟨f,a,b,c,d,ss,found,_,_,body⟩ := sites
  have cert := tested
  rw [found] at cert
  have extracted : Repeat.extract f.body=some (a::repGuard::b::c::d::repStore::ss) := by
    rw [body]; rfl
  simp only [Option.bind_some] at cert
  rw [extracted] at cert
  simp only [Option.bind_some,extractSites,repGuard,repStore,repValue,Option.map_some,Option.some.injEq] at cert
  have eq := matchesSound ss cert
  exact ⟨f,a,b,c,d,found,eq ▸ body⟩
end Inv39.Init.Marker.ActualSuffix
