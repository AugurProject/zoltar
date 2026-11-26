import Inv08PublicHistory
open SolidCore.Solidity.Source
namespace Inv08.FundingHistory

/-- Any two legal subdivisions of a fixed eligible interval release the same cumulative ETH and REP. -/
theorem subdivision (fuel : Nat) (H : Accounts s d fs paid) (sep : Separated fs.length)
    (first : Legal s start a stop) (second : Legal s start b stop)
    (clock : stored s .through ≤ start) (settled : ∀ eth,paid eth=vested d start fs eth) :
    ∃ sa sb eth rep, run fuel s a=some (sa,eth,rep) ∧ run fuel s b=some (sb,eth,rep) ∧
      paid true+eth=vested d stop fs true ∧ paid false+rep=vested d stop fs false := by
  obtain ⟨sa,x,y,ha,xe,yr,_⟩ := publicRun fuel H sep first clock settled
  obtain ⟨sb,u,v,hb,ue,vr,_⟩ := publicRun fuel H sep second clock settled
  have X : x=u := Nat.add_left_cancel (xe.trans ue.symm)
  have Y : y=v := Nat.add_left_cancel (yr.trans vr.symm)
  exact ⟨sa,sb,x,y,ha,X ▸ Y ▸ hb,xe,yr⟩

theorem lastExpiry (fuel : Nat) (H : Accounts s d fs paid) (sep : Separated fs.length)
    (schedule : Legal s start calls stop) (clock : stored s .through ≤ start)
    (settled : ∀ eth,paid eth=vested d start fs eth) (ends : ∀ f∈fs,f.time+d≤stop) :
    ∃ final eth rep, run fuel s calls=some (final,eth,rep) ∧
      paid true+eth=totalRate (streams true fs) ∧ paid false+rep=totalRate (streams false fs) := by
  obtain ⟨final,x,y,runEq,xe,yr,_⟩ := publicRun fuel H sep schedule clock settled
  exact ⟨final,x,y,runEq,xe.trans (finalAmount _ _ _ _ H.positive ends),yr.trans (finalAmount _ _ _ _ H.positive ends)⟩
end Inv08.FundingHistory
