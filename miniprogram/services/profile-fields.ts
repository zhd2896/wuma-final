/** Versioned built-in avatars, never external image URLs. */
export const PROFILE_AVATARS = [
  { id: 'piece_v1_shi', text: '士' }, { id: 'piece_v1_ma', text: '馬' }, { id: 'piece_v1_pao', text: '炮' },
] as const;
export type ProfileAvatar = typeof PROFILE_AVATARS[number]['id'];
export function isProfileAvatar(value: unknown): value is ProfileAvatar {
  return PROFILE_AVATARS.some(avatar => avatar.id === value);
}
export function validNickname(value: unknown): value is string {
  return typeof value === 'string' && value === value.trim() &&
    Array.from(value).length >= 1 && Array.from(value).length <= 24 && !/[\p{Cc}\p{Cf}\p{Cs}]/u.test(value);
}
