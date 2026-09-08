// 機能フラグの判定。admin は明示的に false にされた機能以外は使える。一般ユーザーはフラグ ON のときだけ使える。
// （rails-backend の User#can_use? と同じルール）
export type FeatureFlagOwner = { admin?: boolean; feature_flags?: Record<string, boolean> }

export function canUseFeature(owner: FeatureFlagOwner | null | undefined, featureKey: string): boolean {
  if (!owner) return false
  if (owner.admin) return owner.feature_flags?.[featureKey] !== false
  return !!owner.feature_flags?.[featureKey]
}
