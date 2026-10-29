import type { Profile } from "../profile/schema";
import { Letter } from "./ProfileView";
import type { StageProps, Tab } from "./types";

/**
 * What a booklet shows when the host gives it no stage (a custom `stages` map without it): the printed version, starting at that
 * booklet's section. Every object and card in it opens the same lightbox a stage would.
 */
export function StagePlaceholder({ tab, profile, onPickItem, onPickCard }: { tab: Tab; profile: Profile } & Pick<StageProps, "onPickItem" | "onPickCard">) {
  return <Letter profile={profile} focus={tab} compact onOpenItem={onPickItem} onOpenCard={onPickCard} />;
}
